"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const dbg = require("../web/ide_debugger.js");

test("Flow snapshots map LLDB frames and locals", () => {
  const snap = dbg.ADAPTERS.flow.parse({ state: "paused", output: "x\n", exit_code: null,
    stack: [{ function: "square", line: 2, locals: { n: { type: "int32_t", value: "3" } } },
            { function: "main", line: 10, locals: {} }] });
  assert.equal(snap.state, "paused");
  assert.equal(snap.line, 2);
  assert.deepEqual(snap.frames.map(f => [f.name, f.line]), [["square", 2], ["main", 10]]);
  assert.deepEqual(snap.frames[0].variables, [{ name: "n", type: "int32_t", value: "3" }]);
  assert.equal(dbg.ADAPTERS.flow.parse({ state: "done", stack: [] }).state, "done");
});

test("Python snapshots keep value previews and surface exceptions", () => {
  const snap = dbg.ADAPTERS.python.parse({ state: "paused", stack: [
    { line: 6, function: "mean", locals: { total: { type: "int", value: "72" }, values: { type: "list" } } }],
    exception: { type: "ZeroDivisionError", message: "division by zero" } });
  assert.deepEqual(snap.frames[0].variables.map(v => v.value), ["72", "<list>"]);
  assert.equal(snap.message, "ZeroDivisionError: division by zero");
  const body = JSON.parse(dbg.ADAPTERS.python.startBody("x = 1", [{ line: 1, condition: "x >= 2" }, { line: 3 }],
    { pauseOnException: true }));
  assert.deepEqual(body.breakpoints, [{ line: 1, condition: "x>=2" }, 3]);
  assert.equal(body.pause_on_exception, true);
});

test("R snapshots pause on the next top-level line and continue to later breakpoints", () => {
  const snap = dbg.ADAPTERS.r.parse({ state: "paused", next_line: 5, frames: [], output: "" });
  assert.equal(snap.line, 5);
  assert.equal(snap.frames[0].name, "top level");
  const failed = dbg.ADAPTERS.r.parse({ state: "error", next_line: null, failed_line: 3, frames: [] });
  assert.equal(failed.state, "error");
  assert.equal(failed.line, 3);
  assert.equal(dbg.rContinueTargets([{ line: 2 }, { line: 7, condition: "i >= 3" }, { line: 9 }], 5), "7?i>=3,9");
  assert.equal(dbg.rContinueTargets([{ line: 2 }], 5), "");
});

test("languages come from the document, then its extension, then the run language", () => {
  assert.equal(dbg.languageOf({ language: "python" }), "python");
  assert.equal(dbg.languageOf({ name: "model.R" }), "r");
  assert.equal(dbg.languageOf({ name: "x.txt" }, { value: "r" }), "r");
  assert.equal(dbg.languageOf(null, null), "flow");
});

test("breakpoints live as model decorations and follow edits", () => {
  // A minimal model: decorations keep a line that shifts when lines are inserted above.
  let next = 0;
  const decorations = new Map();
  const model = {
    deltaDecorations(old, added) {
      for (const id of old) decorations.delete(id);
      return added.map(item => { const id = "d" + (next++); decorations.set(id, item.range.startLineNumber); return id; });
    },
    getDecorationRange(id) { return decorations.has(id) ? { startLineNumber: decorations.get(id) } : null; },
    insertLinesAbove(line, count) { for (const [id, at] of decorations) if (at >= line) decorations.set(id, at + count); }
  };
  const store = dbg.createBreakpoints();
  let changes = 0;
  store.onChange(() => changes++);
  store.toggle(model, 4);
  store.toggle(model, 9);
  assert.deepEqual(store.list(model).map(p => p.line), [4, 9]);
  model.insertLinesAbove(1, 2);
  assert.deepEqual(store.list(model).map(p => p.line), [6, 11]);
  const second = store.list(model)[1];
  store.update(model, second.id, { condition: "i > 2", enabled: false });
  assert.deepEqual(store.active(model).map(p => p.line), [6]);
  assert.equal(store.find(model, 11).condition, "i > 2");
  store.toggle(model, 6);
  assert.deepEqual(store.list(model).map(p => p.line), [11]);
  store.clear(model);
  assert.equal(store.list(model).length, 0);
  assert.ok(changes >= 5);
});
