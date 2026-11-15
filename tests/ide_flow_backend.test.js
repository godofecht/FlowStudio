"use strict";
/* Flow backend switcher state (web/ide_flow_backend.js): per-project memory,
 * availability from the server probe, and the labels the UI shows. */
const test = require("node:test");
const assert = require("node:assert/strict");
const backend = require("../web/ide_flow_backend.js");

function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); }
  };
}
const alpha = { name: "alpha" };
const beta = { name: "beta" };

test("both backends are listed with a one-line description", () => {
  assert.deepEqual(backend.BACKENDS.map(item => [item.id, item.value]), [["c", ""], ["mlir", "mlir"]]);
  for (const item of backend.BACKENDS) {
    assert.ok(item.description.length > 10 && !item.description.includes("\n"), item.id);
    assert.doesNotMatch(item.description + item.label, new RegExp("[\\u2013\\u2014]"), "no dashes in UI copy");
  }
});

test("a new project starts on C and each project keeps its own choice", () => {
  const storage = fakeStorage();
  const state = backend.createState({ storage });
  assert.equal(state.preferred(alpha), "c");
  state.remember(alpha, "mlir");
  assert.equal(state.preferred(alpha), "mlir");
  assert.equal(state.preferred(beta), "c", "another project is unaffected");
  state.remember(beta, "c");
  // A fresh state reads the same choices back from storage.
  const reloaded = backend.createState({ storage });
  assert.equal(reloaded.preferred(alpha), "mlir");
  assert.equal(reloaded.preferred(beta), "c");
});

test("with no project open the last choice is used", () => {
  const state = backend.createState({ storage: fakeStorage() });
  assert.equal(state.preferred(null), "c");
  state.remember(alpha, "mlir");
  assert.equal(state.preferred(null), "mlir");
  state.remember(null, "c");
  assert.equal(state.preferred(null), "c");
  assert.equal(state.preferred(alpha), "mlir", "a no-project choice leaves projects alone");
});

test("unknown ids and corrupt storage are ignored", () => {
  const state = backend.createState({ storage: fakeStorage({ [backend.KEY]: "{not json" }) });
  assert.equal(state.preferred(alpha), "c");
  assert.equal(state.remember(alpha, "llvm"), false);
  assert.equal(state.preferred(alpha), "c");
  const bad = backend.createState({ storage: fakeStorage({
    [backend.KEY]: JSON.stringify({ projects: { "p:alpha": "gpu", "p:beta": "mlir" }, last: "x" }) }) });
  assert.equal(bad.preferred(alpha), "c");
  assert.equal(bad.preferred(beta), "mlir");
  assert.equal(bad.preferred(null), "c");
});

test("storage that throws does not break the switcher", () => {
  const storage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  const state = backend.createState({ storage });
  assert.equal(state.remember(alpha, "mlir"), true);
  assert.equal(state.preferred(alpha), "mlir");
});

test("availability is unknown until probed, then follows the server report", () => {
  const state = backend.createState({ storage: fakeStorage() });
  assert.equal(state.probed(), false);
  assert.equal(state.available("mlir"), null);
  state.setAvailability({ c: { available: true }, mlir: { available: false, reason: "MLIR tools not found." } });
  assert.equal(state.probed(), true);
  assert.equal(state.available("c"), true);
  assert.equal(state.available("mlir"), false);
  assert.equal(state.reason("mlir"), "MLIR tools not found.");
  // A failed probe (null report) is probed but unknown.
  state.setAvailability(null);
  assert.equal(state.probed(), true);
  assert.equal(state.available("mlir"), null);
});

test("a remembered MLIR choice runs on C where MLIR is missing, and comes back where it exists", () => {
  const storage = fakeStorage();
  const state = backend.createState({ storage });
  state.remember(alpha, "mlir");
  assert.equal(state.effective(alpha), "mlir", "unknown availability keeps the choice");
  state.setAvailability({ c: { available: true }, mlir: { available: false, reason: "missing" } });
  assert.equal(state.effective(alpha), "c");
  assert.equal(state.preferred(alpha), "mlir", "the preference itself is kept");
  state.setAvailability({ c: { available: true }, mlir: { available: true } });
  assert.equal(state.effective(alpha), "mlir");
});

test("the Run tooltip and console run line name the active backend", () => {
  assert.equal(backend.runTooltip("flow", "c"), "Run with the Flow C backend (Ctrl/⌘+Enter)");
  assert.equal(backend.runTooltip("flow", "mlir"), "Run with the Flow MLIR backend (Ctrl/⌘+Enter)");
  assert.equal(backend.runTooltip("python", "mlir"), "Run selection or entire buffer (Ctrl/⌘+Enter)");
  assert.equal(backend.runtimeLabel("flow", ""), "flow, C backend");
  assert.equal(backend.runtimeLabel("flow", "mlir"), "flow, MLIR backend");
  assert.equal(backend.runtimeLabel("r", "mlir"), "r");
  assert.equal(backend.runNote("flow", "mlir"), " on the MLIR backend");
  assert.equal(backend.runNote("flow", ""), " on the C backend");
  assert.equal(backend.runNote("python", "mlir"), "");
});
