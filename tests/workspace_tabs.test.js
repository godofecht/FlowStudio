"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mount} = require("../web/workspace_tabs.js");

function fixture(initial = null, unavailable = false) {
  const nodes = new Map();
  const focus = [];
  for (const name of ["files", "outline", "plots", "data", "packages", "examples", "debug"]) {
    const tab = {
      attributes: {}, tabIndex: 0, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, fn) { this.listeners[key] = fn; },
      focus() { focus.push(name); }
    };
    const frame = {attributes: {}, getAttribute(key) { return this.attributes[key] || null; },
      setAttribute(key, value) { this.attributes[key] = value; }};
    const panel = {hidden: false, querySelector(key) { return key === "iframe" ? frame : null; }, frame};
    nodes.set("tab-" + name, tab);
    nodes.set("view-" + name, panel);
  }
  const storage = {
    saved: initial,
    getItem() { if (unavailable) throw Error("disabled"); return this.saved; },
    setItem(key, value) { if (unavailable) throw Error("disabled"); this.saved = value; }
  };
  return {doc: {getElementById: key => nodes.get(key)}, storage, nodes, focus};
}

test("starts on files without loading plot or data frames", () => {
  const f = fixture();
  const tabs = mount(f.doc, f.storage);
  assert.equal(tabs.current(), "files");
  assert.equal(f.nodes.get("view-files").hidden, false);
  assert.equal(f.nodes.get("view-plots").hidden, true);
  assert.equal(f.nodes.get("view-plots").frame.getAttribute("src"), null);
  assert.equal(f.nodes.get("view-data").frame.getAttribute("src"), null);
  assert.equal(f.nodes.get("tab-files").attributes["aria-selected"], "true");
});

test("switches tabs and lazy-loads the data frame exactly once", () => {
  const f = fixture();
  const tabs = mount(f.doc, f.storage);
  f.nodes.get("tab-plots").listeners.click();
  assert.equal(tabs.current(), "plots");
  // Plots render inline from captured figures; no iframe route is needed.
  assert.equal(f.nodes.get("view-plots").hidden, false);
  assert.equal(f.nodes.get("view-plots").frame.getAttribute("src"), null);
  assert.equal(f.nodes.get("view-files").hidden, true);
  assert.equal(f.storage.saved, "plots");
  f.nodes.get("tab-data").listeners.click();
  assert.equal(f.nodes.get("view-data").frame.getAttribute("src"), "/data");
  tabs.select("plots");
  assert.equal(f.nodes.get("view-plots").frame.getAttribute("src"), null);
  assert.equal(f.nodes.get("view-data").frame.getAttribute("src"), "/data");
  assert.equal(tabs.select("unknown"), false);
});

test("supports roving keyboard focus and wraps", () => {
  const f = fixture();
  const tabs = mount(f.doc, f.storage);
  let prevented = 0;
  f.nodes.get("tab-files").listeners.keydown({key: "ArrowLeft", preventDefault() {prevented++;}});
  assert.equal(tabs.current(), "debug");
  assert.deepEqual(f.focus, ["debug"]);
  f.nodes.get("tab-debug").listeners.keydown({key: "Home", preventDefault() {prevented++;}});
  assert.equal(tabs.current(), "files");
  assert.equal(prevented, 2);
  assert.equal(f.nodes.get("tab-debug").tabIndex, -1);
});

test("switches the sidebar panels tab and shows its panel", () => {
  const f = fixture();
  const tabs = mount(f.doc, f.storage);
  for (const name of ["packages", "examples", "debug"]) {
    f.nodes.get("tab-" + name).listeners.click();
    assert.equal(tabs.current(), name, name);
    assert.equal(f.nodes.get("view-" + name).hidden, false, name);
    assert.equal(f.nodes.get("tab-" + name).attributes["aria-selected"], "true", name);
    assert.equal(f.nodes.get("view-files").hidden, true, name);
  }
});

test("recovers from invalid and inaccessible session storage", () => {
  const f = fixture("javascript:alert(1)", true);
  const tabs = mount(f.doc, f.storage);
  assert.equal(tabs.current(), "files");
  assert.equal(tabs.select("data"), true);
  assert.equal(f.nodes.get("view-data").frame.getAttribute("src"), "/data");
});

test("fails visibly when required tab controls are absent", () => {
  const f = fixture();
  f.nodes.delete("tab-plots");
  assert.throws(() => mount(f.doc, f.storage), /incomplete/);
});
