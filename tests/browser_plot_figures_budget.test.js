"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {collect, create, show, LIMIT, MAX_RESPONSE_BYTES} =
  require("../web/plot_figures.js");

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
function response(data, headers = null) {
  return {ok:true, headers:{get:() => headers}, text:async () => JSON.stringify(data)};
}
function node(tag) {
  return {
    tag, children:[], attributes:{},
    append(...children) {this.children.push(...children);},
    replaceChildren(...children) {this.children = children;},
    setAttribute(name, value) {this.attributes[name] = String(value);}
  };
}
function documentForPlots() {
  const host = node("div");
  let tabs = 0;
  const doc = {
    createElement: node,
    getElementById(id) {
      if (id === "plotFigures") return host;
      if (id === "tab-plots") return {click() {tabs++;}};
      return null;
    }
  };
  return {doc, host, tabCount:() => tabs};
}

test("R and Python captures share one retained figure history", async () => {
  const {doc, host, tabCount} = documentForPlots();
  const root = {};
  const previous = global.fetch;
  global.fetch = async url => url === "/api/plot/r"
    ? response({svg:"<svg></svg>"})
    : response({plots:[{number:2,png:PNG}]});
  try {
    assert.equal(await show(root, doc, "r"), true);
    assert.equal(await show(root, doc, "python"), true);
    assert.equal(host.children.length, 2);
    assert.equal(host.children[0].children[0].alt, "R plot 1 (SVG)");
    assert.equal(host.children[1].children[0].alt, "Python figure 2");
    assert.equal(root.__flowstudioPlotPanel.size(), 2);
    assert.equal(tabCount(), 2);
  } finally {
    global.fetch = previous;
  }
});

test("declared oversized HTTP body is rejected before reading", async () => {
  let reads = 0;
  const fetcher = async () => ({
    ok:true,
    headers:{get:() => String(MAX_RESPONSE_BYTES + 1)},
    text:async () => {reads++; throw new Error("must not read");}
  });
  assert.deepEqual(await collect("python", fetcher), []);
  assert.equal(reads, 0);
});

test("streamed oversized body cancels without JSON parsing or unbounded retention", async () => {
  let cancelled = 0, released = 0;
  const fetcher = async () => ({
    ok:true,
    body:{getReader:() => ({
      read:async () => ({done:false,value:new Uint8Array(MAX_RESPONSE_BYTES + 1)}),
      cancel:async () => {cancelled++;},
      releaseLock:() => {released++;}
    })}
  });
  assert.deepEqual(await collect("python", fetcher), []);
  assert.equal(cancelled, 1);
  assert.equal(released, 1);
});

test("streamed UTF-8 plot JSON is decoded across byte boundaries", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({
    plots:[{number:7,svg:"<svg>é</svg>"}]
  }));
  const split = bytes.indexOf(0xc3) + 1;
  let index = 0;
  const parts = [bytes.slice(0,split),bytes.slice(split)];
  const fetcher = async () => ({
    ok:true,
    body:{getReader:() => ({
      read:async () => index < parts.length
        ? {done:false,value:parts[index++]} : {done:true},
      releaseLock() {}
    })}
  });
  assert.deepEqual(await collect("r", fetcher), [{number:7,svg:"<svg>é</svg>"}]);
});

test("seeded 12-figure cross-kernel batch is accepted and a thirteenth fails closed", async () => {
  let seed = 20261102;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const plots = Array.from({length:LIMIT}, () => ({number:next()%1000000,png:PNG}));
  const valid = await collect("python", async () => response({plots}));
  assert.equal(valid.length, LIMIT);
  assert.deepEqual(valid, plots);
  assert.deepEqual(await collect("python", async () =>
    response({plots:[...plots,{number:13,png:PNG}]})), []);
  const {host, doc} = documentForPlots();
  const history = create(doc, host);
  assert.equal(history.append(plots), LIMIT);
  assert.equal(history.append([...plots,{number:13,png:PNG}]), 0);
  assert.equal(history.size(), LIMIT);
  assert.equal(host.children.length, LIMIT);
});

test("fallback text body and malformed stream UTF-8 fail closed", async () => {
  assert.deepEqual(await collect("python", async () => ({
    ok:true, text:async () => "x".repeat(MAX_RESPONSE_BYTES + 1)
  })), []);
  const fetcher = async () => ({
    ok:true,
    body:{getReader:() => ({
      read:(() => {
        let done = false;
        return async () => done ? {done:true} :
          (done = true, {done:false,value:new Uint8Array([0xff])});
      })(),
      releaseLock() {}
    })}
  });
  assert.deepEqual(await collect("r", fetcher), []);
});
