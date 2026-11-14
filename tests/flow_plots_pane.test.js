"use strict";
/* The Plots pane history (web/plot_pane.js), Flow plot frames
 * (web/flow_plots.js) and the Flow side of the Packages view
 * (web/ide_flow_packages.js), against a small fake document. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const pane = require("../web/plot_pane.js");
const flowPlots = require("../web/flow_plots.js");
const flowPackages = require("../web/ide_flow_packages.js");
const figures = require("../web/plot_figures.js");

class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.textValue = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") { this.textValue += node; continue; }
      node.parent = this;
      this.children.push(node);
    }
  }
  insertBefore(node, before) {
    const index = this.children.indexOf(before);
    node.parent = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
  replaceChildren(...nodes) { this.children = []; this.textValue = ""; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  get lastChild() { return this.children[this.children.length - 1]; }
  set textContent(value) { this.children = []; this.textValue = String(value); }
  get textContent() { return this.textValue + this.children.map(child => child.textContent).join(""); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  addEventListener(type, listener) { (this.listeners[type] = this.listeners[type] || []).push(listener); }
  dispatch(type, event = {}) { for (const listener of this.listeners[type] || []) listener(Object.assign({ preventDefault() {} }, event)); }
  click() { if (!this.disabled) this.dispatch("click"); }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  querySelector(selector) {
    const tags = selector.split(",").map(part => part.trim().toUpperCase());
    return this.all().slice(1).find(node => tags.includes(node.tagName)) || null;
  }
}

function fakeDocument() {
  const nodes = [];
  const doc = {
    body: new FakeElement("body"),
    createElement(tag) { const node = new FakeElement(tag); nodes.push(node); return node; },
    getElementById(id) {
      return [doc.body, ...nodes].flatMap(node => node.all()).find(node => node.id === id) || null;
    }
  };
  return doc;
}

const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"400\"><rect width=\"4\" height=\"4\"/></svg>";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const frame = svg => "\u001eFLOWSTUDIO-PLOT\u001e" + svg + "\n";

test("validate keeps bounded SVG, PNG and PDF figures only", () => {
  assert.equal(pane.validate({ kind: "svg", data: SVG, label: "x" }).kind, "svg");
  assert.equal(pane.validate({ kind: "png", data: PNG }).label, "Plot");
  assert.equal(pane.validate({ kind: "pdf", data: "255044462d312e350a0a" }).kind, "pdf");
  assert.equal(pane.validate({ kind: "svg", data: "<div>not svg</div>" }), null);
  assert.equal(pane.validate({ kind: "svg", data: "<svg>" + "x".repeat(pane.MAX_SVG_CHARS) + "</svg>" }), null);
  assert.equal(pane.validate({ kind: "png", data: "aGVsbG8=" }), null);
  assert.equal(pane.validate({ kind: "gif", data: SVG }), null);
});

test("the history steps back and forward and keeps the newest figures", () => {
  const history = pane.createHistory(3);
  for (let i = 1; i <= 4; i++) history.add({ kind: "svg", data: SVG, label: "p" + i });
  assert.equal(history.size(), 3, "the oldest figure is dropped");
  assert.equal(history.current().label, "p4");
  assert.equal(history.forward(), false);
  assert.equal(history.back(), true);
  assert.equal(history.back(), true);
  assert.equal(history.current().label, "p2");
  assert.equal(history.back(), false, "nothing before the first");
  assert.equal(history.remove(), true);
  assert.equal(history.current().label, "p3");
  assert.equal(history.count("Flow"), 1);
  assert.equal(history.count("Flow"), 2);
  history.clear();
  assert.equal(history.current(), null);
});

test("zoom steps through fixed levels and file names follow labels", () => {
  assert.equal(pane.stepZoom(1, 1), 1.5);
  assert.equal(pane.stepZoom(1, -1), 0.75);
  assert.equal(pane.stepZoom(0.6, 1), 0.75);
  assert.equal(pane.stepZoom(4, 1), 4);
  assert.equal(pane.stepZoom(0.25, -1), 0.25);
  assert.equal(pane.fileStem("Flow plot 3"), "flowstudio-flow-plot-3");
  assert.equal(pane.fileStem("<>"), "flowstudio-plot");
});

test("the pane renders the current figure with a working toolbar", () => {
  const doc = fakeDocument();
  const host = doc.createElement("div");
  host.id = "plotFigures";
  doc.body.append(host);
  const view = pane.create(doc, host, { urls: { createObjectURL: () => "blob:x", revokeObjectURL() {} } });
  assert.equal(doc.getElementById("plotPosition").textContent, "No plots");
  assert.equal(doc.getElementById("plotBack").disabled, true);
  view.add([{ kind: "svg", data: SVG, label: view.label("Flow") }, { kind: "png", data: PNG, label: "Python figure 1" }]);
  assert.equal(doc.getElementById("plotPosition").textContent, "2 of 2");
  assert.equal(doc.getElementById("plotExportSvg").disabled, true, "a PNG has no SVG export");
  doc.getElementById("plotBack").click();
  assert.equal(doc.getElementById("plotPosition").textContent, "1 of 2");
  assert.equal(doc.getElementById("plotStage").querySelector("figcaption").textContent, "Flow plot 1");
  assert.match(doc.getElementById("plotStage").querySelector("img").src, /^data:image\/svg\+xml/);
  assert.equal(doc.getElementById("plotExportSvg").disabled, false);
  doc.getElementById("plotZoomIn").click();
  assert.match(doc.getElementById("plotZoomFit").textContent, /^\d+%$/);
  doc.getElementById("plotZoomFit").click();
  assert.equal(doc.getElementById("plotZoomFit").textContent, "Fit");
  doc.getElementById("plotClear").click();
  assert.equal(view.size(), 0);
});

test("R and Python figures join the pane history through plot_figures", () => {
  const doc = fakeDocument();
  const host = doc.createElement("div");
  host.id = "plotFigures";
  doc.body.append(host);
  globalThis.document = doc;
  try {
    pane.instance = null;
    const panel = figures.create(doc, host);
    assert.equal(panel.append([{ number: 1, svg: SVG }, { number: 2, png: PNG }]), 2);
    assert.equal(pane.instance.size(), 2);
    assert.equal(pane.instance.current().label, "Python figure 1");
    pane.instance.back();
    assert.equal(pane.instance.current().label, "R plot 1");
  } finally {
    delete globalThis.document;
    pane.instance = null;
  }
});

test("extract finds whole SVG frames and leaves other output", () => {
  const found = flowPlots.extract("a\n" + frame(SVG) + "b\n" + frame("<svg>broken") + frame(SVG));
  assert.deepEqual(found.plots, [SVG, SVG]);
  assert.equal(found.dropped, 1);
  assert.doesNotMatch(found.text, /FLOWSTUDIO-PLOT|<svg/);
  assert.equal(flowPlots.extract("plain").plots.length, 0);
  const many = flowPlots.extract(frame(SVG).repeat(flowPlots.MAX_PER_RUN + 3));
  assert.equal(many.plots.length, flowPlots.MAX_PER_RUN);
  assert.equal(many.dropped, 3);
});

test("take moves figures to the pane and leaves a note", () => {
  const added = [];
  const fake = { label: () => "Flow plot " + (added.length + 1), add: entry => { added.push(entry); return [entry]; } };
  const doc = { getElementById: () => null };
  const text = flowPlots.take("start\n" + frame(SVG) + "end", { pane: fake, document: doc });
  assert.equal(text, "start\n(Flow plot 1 is in the Plots pane.)\nend");
  assert.deepEqual(added, [{ kind: "svg", data: SVG, label: "Flow plot 1" }]);
  assert.equal(flowPlots.take("no plots here", { pane: fake }), "no plots here");
  assert.equal(flowPlots.take(frame("<svg>" + "x".repeat(70000) + "</svg>"), { pane: fake, document: doc }),
    "(A Flow plot was too large to show.)\n");
});

test("classify accepts registry names, git URLs and folders only", () => {
  assert.equal(flowPackages.classify("json").kind, "registry");
  assert.equal(flowPackages.classify("json@^1.2").kind, "registry");
  assert.equal(flowPackages.classify("https://github.com/a/b.git").kind, "git");
  assert.equal(flowPackages.classify("../lib").kind, "path");
  assert.equal(flowPackages.classify("/abs/lib").kind, "path");
  for (const bad of ["", "--path", "a b", "x\ny", "http://insecure/x"]) assert.equal(flowPackages.classify(bad), null, bad);
  assert.equal(flowPackages.body("add", "/p", "json"), "add\n/p\njson");
});

test("the Flow packages view lists, adds and removes through the route", async () => {
  const doc = fakeDocument();
  const parts = { summary: doc.createElement("div"), list: doc.createElement("div"),
    log: doc.createElement("pre"), input: doc.createElement("input") };
  const calls = [];
  let deps = [];
  const call = async (operation, folder, argument) => {
    calls.push([operation, folder, argument]);
    if (operation === "add") deps = [{ name: "tinylib", spec: "../tinylib", source: "path", locked: "", installed: true, dev: false }];
    if (operation === "remove") deps = [];
    return { ok: true, project: folder, manifest: true, name: "demo", dependencies: deps,
      output: operation === "list" ? "" : "$ flow " + operation };
  };
  const storage = new Map();
  const view = flowPackages.create(doc, parts, { call, storage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  view.show();
  assert.equal(calls.length, 0, "nothing runs without a folder");
  view.element.children[0].value = "/tmp/demo";
  await view.load(true);
  assert.equal(storage.get(flowPackages.FOLDER_KEY), "/tmp/demo");
  assert.match(parts.summary.textContent, /demo, 0 Flow dependencies/);
  parts.input.value = "../tinylib";
  view.render();
  assert.match(parts.list.textContent, /Add \.\.\/tinylib/);
  await view.add("../tinylib");
  assert.deepEqual(calls[1], ["add", "/tmp/demo", "../tinylib"]);
  assert.equal(parts.log.textContent, "$ flow add");
  assert.match(parts.summary.textContent, /1 Flow dependency/);
  await view.remove("tinylib");
  assert.deepEqual(calls[2], ["remove", "/tmp/demo", "tinylib"]);
  assert.match(parts.summary.textContent, /0 Flow dependencies/);
  assert.equal(await view.add("--evil"), null, "an invalid spec never reaches the server");
  assert.equal(calls.length, 3);
});
