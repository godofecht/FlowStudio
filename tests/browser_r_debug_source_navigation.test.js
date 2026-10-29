"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const panel = require("../docs/app/r_debug_panel.js");

function control(value = "") {
  const listeners = new Map();
  return {
    value, disabled:false, textContent:"", selectionStart:-1, selectionEnd:-1, focusCount:0,
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type) { listeners.get(type)?.(); },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    focus() { this.focusCount++; }
  };
}
function result(state, overrides = {}) {
  return {state, ok:state !== "error", index:1, total:3,
    next_line:state === "paused" ? 2 : null, executed_line:null,
    failed_line:state === "error" ? 1 : null, output:"", ...overrides};
}
function fixture(native, identity = () => 0) {
  const source = control("a <- 1\nb <- 2\nstop('bad')");
  const language = control("r"), runtime = control("native");
  const controls = Array.from({length:8}, () => control());
  const [startButton, stepButton, continueButton, evaluateButton,
    stopButton, statusButton, targetLine, watchExpression] = controls;
  const target = control();
  const instance = panel.create({native, source, language, runtime, startButton,
    stepButton, continueButton, evaluateButton, stopButton, statusButton,
    targetLine, watchExpression, target, documentIdentity:identity});
  return {instance, source, language, runtime, target, watchExpression};
}

test("R source line navigation respects real textarea lines and CRLF", () => {
  const source = control("first\r\nsecond\nthird");
  assert.equal(panel.revealSourceLine(source, 2), true);
  assert.equal(source.selectionStart, 7);
  assert.equal(panel.revealSourceLine(source, 3), true);
  assert.equal(source.selectionStart, 14);
  assert.equal(panel.revealSourceLine(source, 0), false);
  assert.equal(panel.revealSourceLine(source, 4), false);
  assert.equal(source.selectionStart, 14);
  assert.equal(source.focusCount, 2);
});

test("R debugger navigates actual paused and failed top-level lines, not evaluation", async () => {
  let moves = 0;
  const native = {
    available:() => true,
    async debugRStart() { return result("paused"); },
    async debugRCommand(action) {
      if (action === "step") return result("paused", {next_line:3});
      if (action === "continue") return result("error");
      if (action === "evaluate") return result("error", {ok:true, output:"[1] 42"});
      return result("idle", {total:0});
    }
  };
  const f = fixture(native);
  const original = f.source.setSelectionRange;
  f.source.setSelectionRange = function(...args) { moves++; return original.apply(this, args); };
  assert.equal(await f.instance.execute("start"), true);
  assert.equal(f.source.selectionStart, 7);
  assert.equal(await f.instance.execute("step"), true);
  assert.equal(f.source.selectionStart, 14);
  assert.equal(await f.instance.execute("continue"), false);
  assert.equal(f.source.selectionStart, 0);
  f.watchExpression.value = "a + 1";
  assert.equal(await f.instance.execute("evaluate"), true);
  assert.equal(moves, 3);
  assert.equal(await f.instance.execute("stop"), true);
  assert.equal(moves, 3);
});

test("R debugger refuses stale document, language and changed-source navigation", async () => {
  let document = 0, line = 2;
  const native = {
    available:() => true,
    async debugRStart() { return result("paused", {next_line:line}); },
    async debugRCommand() { return result("paused", {next_line:++line}); }
  };
  const f = fixture(native, () => document);
  assert.equal(await f.instance.execute("start"), true);
  assert.equal(f.source.selectionStart, 7);
  document++;
  assert.equal(await f.instance.execute("step"), true);
  assert.equal(f.source.selectionStart, 7);
  document--;
  f.source.value = "changed\nsource";
  assert.equal(await f.instance.execute("status"), true);
  assert.equal(f.source.selectionStart, 7);
  f.source.value = "a <- 1\nb <- 2\nstop('bad')";
  f.source.emit("input");
  assert.equal(await f.instance.execute("status"), true);
  assert.equal(f.source.selectionStart, 7);
  f.language.value = "python";
  assert.equal(await f.instance.execute("step"), false);
  assert.equal(f.source.selectionStart, 7);
});

test("R debugger never navigates an asynchronous start into a replaced editor", async () => {
  let resolveStart;
  const native = {
    available:() => true,
    debugRStart() { return new Promise(resolve => { resolveStart = resolve; }); },
    async debugRCommand() { return result("idle", {total:0}); }
  };
  let document = 0;
  const f = fixture(native, () => document);
  const pending = f.instance.execute("start");
  document++;
  resolveStart(result("paused"));
  assert.equal(await pending, true);
  assert.equal(f.source.selectionStart, -1);
  assert.match(f.target.textContent, /Next expression at line 2/);
});

test("native Pages R debugger passes changing editor and session identity", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /documentIdentity:\(\) => editorIdentity \+ ":" \+ sessionGeneration/);
  assert.match(html, /setFilename: \(name, path\) => \{ editorIdentity\+\+/);
  assert.match(html, /editorIdentity\+\+; \$\("source"\)\.value = source/);
  assert.match(html, /editorIdentity\+\+; fileName = name\.replace/);
});
