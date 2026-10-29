"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const panel = require("../docs/app/r_debug_panel.js");

function control(value = "") {
  const listeners = new Map();
  return {
    value, disabled:false, textContent:"", selectionStart:0,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    emit(name) { for (const fn of listeners.get(name) || []) fn(); },
    setSelectionRange(start) { this.selectionStart = start; },
    focus() {}
  };
}
function snapshot(state, overrides = {}) {
  return {state, ok:true, index:1, total:4, next_line:state === "paused" ? 1 : null,
    executed_line:null, failed_line:null, output:"", ...overrides};
}
function fixture(native) {
  const source = control("a <- 1\nb <- 2\nc <- 3\ncat(c)");
  const language = control("r"), runtime = control("native");
  const [startButton, stepButton, continueButton, runToCursorButton,
    evaluateButton, stopButton, statusButton, targetLine, watchExpression] =
    Array.from({length:9}, () => control());
  const target = control();
  const instance = panel.create({native, source, language, runtime,
    startButton, stepButton, continueButton, runToCursorButton,
    evaluateButton, stopButton, statusButton, targetLine, watchExpression, target});
  return {instance, source, runToCursorButton, targetLine, target};
}

test("R run-to-caret computes real 1-based editor lines including CRLF", () => {
  const source = control("first\r\nsecond\nthird");
  source.selectionStart = 0;
  assert.equal(panel.caretLine(source), 1);
  source.selectionStart = 7;
  assert.equal(panel.caretLine(source), 2);
  source.selectionStart = source.value.indexOf("third");
  assert.equal(panel.caretLine(source), 3);
  source.selectionStart = -1;
  assert.equal(panel.caretLine(source), null);
  source.selectionStart = source.value.length + 1;
  assert.equal(panel.caretLine(source), null);
  source.selectionStart = 1.5;
  assert.equal(panel.caretLine(source), null);
});

test("R run-to-caret sends the actual caret line through native continue without changing breakpoint input", async () => {
  const calls = [];
  const native = {
    available:() => true,
    async debugRStart(source) { calls.push(["start", source]); return snapshot("paused"); },
    async debugRCommand(action, line) {
      calls.push([action, line]);
      if (action === "continue") return snapshot("paused", {index:3, next_line:3});
      return snapshot("idle", {total:0});
    }
  };
  const f = fixture(native);
  assert.equal(f.runToCursorButton.disabled, true);
  assert.equal(await f.instance.execute("start"), true);
  assert.equal(f.runToCursorButton.disabled, true);
  f.source.selectionStart = f.source.value.indexOf("c <- 3");
  f.source.emit("click");
  assert.equal(f.runToCursorButton.disabled, false);
  f.targetLine.value = "4?counter>=3";
  assert.equal(await f.instance.execute("run-to-cursor"), true);
  assert.deepEqual(calls[1], ["continue", "3"]);
  assert.equal(f.targetLine.value, "4?counter>=3");
  assert.equal(f.runToCursorButton.disabled, true);
  assert.equal(await f.instance.execute("run-to-cursor"), false);
  assert.equal(calls.length, 2);
  assert.equal(await f.instance.execute("stop"), true);
  assert.equal(f.runToCursorButton.disabled, true);
});

test("R run-to-caret refuses stale editor revisions even after undo", async () => {
  const calls = [];
  const native = {
    available:() => true,
    async debugRStart() { calls.push("start"); return snapshot("paused"); },
    async debugRCommand(action) { calls.push(action); return snapshot("idle", {total:0}); }
  };
  const f = fixture(native);
  await f.instance.execute("start");
  f.source.selectionStart = f.source.value.indexOf("cat(c)");
  f.source.emit("keyup");
  assert.equal(f.runToCursorButton.disabled, false);
  const original = f.source.value;
  f.source.value += "\nextra <- 1";
  f.source.emit("input");
  f.source.value = original;
  f.source.emit("input");
  assert.equal(f.runToCursorButton.disabled, true);
  assert.equal(await f.instance.execute("run-to-cursor"), false);
  assert.deepEqual(calls, ["start"]);
  assert.match(f.target.textContent, /source changed/);
  assert.equal(await f.instance.execute("status"), true);
  assert.deepEqual(calls, ["start", "status"]);
});

test("R run-to-caret preserves the paused state when R reports no matching future expression", async () => {
  const calls = [];
  const native = {
    available:() => true,
    async debugRStart() { return snapshot("paused"); },
    async debugRCommand(action, line) {
      calls.push([action, line]);
      return snapshot("paused", {ok:false, output:"No later top-level expression starts on any requested line."});
    }
  };
  const f = fixture(native);
  await f.instance.execute("start");
  f.source.selectionStart = f.source.value.indexOf("cat(c)") + 2;
  f.source.emit("select");
  assert.equal(await f.instance.execute("run-to-cursor"), false);
  assert.deepEqual(calls, [["continue", "4"]]);
  assert.match(f.target.textContent, /No later top-level expression/);
  assert.equal(f.source.selectionStart, f.source.value.indexOf("cat(c)") + 2);
  assert.equal(f.runToCursorButton.disabled, false);
});

test("R run-to-caret is wired to the actual workspace, not a simulated executor", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="rDebugRunToCursor"/);
  assert.match(html, /runToCursorButton:\$\("rDebugRunToCursor"\)/);
  const source = fs.readFileSync(path.join(__dirname, "../docs/app/r_debug_panel.js"), "utf8");
  assert.match(source, /debugRCommand\(action === "run-to-cursor" \? "continue" : action/);
});
