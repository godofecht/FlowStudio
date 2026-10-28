"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const figures = require("../web/plot_figures.js");

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const SVG = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='4' height='4'/></svg>";
const PDF = "255044462d312e350a0a"; // minimal even-length hex starting with %PDF-

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

test("validEntry accepts only bounded svg, pdf and png captures", () => {
  assert.deepEqual(figures.validEntry({number: 1, svg: SVG}), {number: 1, svg: SVG});
  assert.deepEqual(figures.validEntry({number: 2, pdf: PDF}), {number: 2, pdf: PDF});
  assert.deepEqual(figures.validEntry({number: 3, png: PNG}), {number: 3, png: PNG});
  assert.equal(figures.validEntry({number: 4, svg: "not svg"}), null);
  assert.equal(figures.validEntry({number: 5, pdf: "ffff"}), null, "pdf must start with %PDF hex");
  assert.equal(figures.validEntry({number: 6, png: "aGVsbG8="}), null, "png must start with the PNG signature");
  assert.equal(figures.validEntry({svg: SVG}), null, "figure numbers are required");
  assert.equal(figures.validEntry({number: -1, svg: SVG}), null);
  assert.equal(figures.validEntry({number: 7, svg: "x".repeat(60001) +
    "</svg>"}), null, "svg entries are bounded");
});

test("collect fetches and normalizes the server capture", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, init});
    return response(200, JSON.stringify({plots: [
      {number: 0, png: PNG}, {number: 1, svg: SVG}, {number: 2, junk: true}
    ]}));
  };
  const plots = await figures.collect("r", fetcher);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/plot/r");
  assert.equal(calls[0].init.headers["X-FlowStudio-Intent"], "run");
  assert.deepEqual(plots, [{number: 0, png: PNG}, {number: 1, svg: SVG}]);
  assert.deepEqual(await figures.collect("python", fetcher).then(
    list => list.length), 2);
  assert.deepEqual(await figures.collect("flow", fetcher), []);
  assert.deepEqual(await figures.collect("r", async () => response(503, "unavailable")), []);
  assert.deepEqual(await figures.collect("r", async () => { throw new Error("down"); }), []);
  assert.deepEqual(await figures.collect("r", async () => response(200, "not json")), []);
});

function fakeElement(tag) {
  return {
    tag, className: "", textContent: "", children: [],
    style: {}, loading: null,
    setAttribute(key, value) { this["attr:" + key] = value; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; }
  };
}
function fakeDocument() {
  return {createElement: tag => fakeElement(tag)};
}
function host() {
  const element = fakeElement("div");
  return element;
}

test("create renders a bounded figure history with save links", () => {
  const doc = fakeDocument();
  const panel = figures.create(doc, host());
  assert.equal(panel.append(null), 0);
  assert.equal(panel.append([{number: 1, png: PNG}]), 1);
  assert.equal(panel.size(), 1);
  // A duplicate entry is appended again as a new history item.
  assert.equal(panel.append([{number: 1, png: PNG}, {number: 2, svg: SVG}]), 2);
  assert.equal(panel.size(), 3);
  panel.clear();
  assert.equal(panel.size(), 0);
});

test("show collects, renders, and opens the Plots tab", async () => {
  const doc = fakeDocument();
  const hostElement = host();
  const tab = {clicked: 0};
  const clicks = {yes: () => { tab.clicked++; }};
  doc.getElementById = id =>
    id === "plotFigures" ? hostElement : id === "tab-plots" ? tab : null;
  doc.createElement = tag => fakeElement(tag);
  tab.click = clicks.yes;
  const statuses = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    response(200, JSON.stringify({plots: [{number: 9, pdf: PDF}]}));
  try {
    const shown = await figures.show(globalThis, doc, "r",
      (message, kind) => statuses.push([message, kind]));
    assert.equal(shown, true);
    assert.equal(tab.clicked, 1);
    assert.equal(statuses.length, 1);
    assert.match(statuses[0][0], /1 figure captured/);
    assert.equal(statuses[0][1], "ok");
    // A second run with no figures must not clear or re-open the tab.
    globalThis.fetch = async () => response(200, JSON.stringify({plots: []}));
    assert.equal(await figures.show(globalThis, doc, "r", () => {}), false);
    assert.equal(tab.clicked, 1);
  } finally {
    if (savedFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = savedFetch;
  }
});
