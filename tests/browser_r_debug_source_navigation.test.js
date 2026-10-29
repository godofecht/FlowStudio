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
  return {instance, source, language, runtime, target, watchExpression,
    startButton, stepButton, continueButton, evaluateButton, stopButton, statusButton,
    targetLine};
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
  assert.equal(await f.instance.execute("step"), false);
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
  assert.equal(f.stepButton.disabled, true);
  assert.equal(f.continueButton.disabled, true);
  assert.equal(f.evaluateButton.disabled, true);
  assert.equal(f.stopButton.disabled, false);
  assert.equal(f.statusButton.disabled, false);
  assert.equal(await f.instance.execute("step"), false);
});

test("native Pages R debugger passes changing editor and session identity", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /documentIdentity:\(\) => editorIdentity \+ ":" \+ sessionGeneration/);
  assert.match(html, /setFilename: \(name, path\) => \{ editorIdentity\+\+/);
  assert.match(html, /editorIdentity\+\+; \$\("source"\)\.value = source/);
  assert.match(html, /editorIdentity\+\+; fileName = name\.replace/);
});

test("R paused commands cannot execute a changed or edit-undone source snapshot", async () => {
  const calls = [];
  const native = {
    available:() => true,
    async debugRStart(source) { calls.push(["start", source]); return result("paused"); },
    async debugRCommand(action) {
      calls.push([action]);
      return action === "stop" ? result("idle", {total:0}) : result("paused");
    }
  };
  const f = fixture(native);
  assert.equal(await f.instance.execute("start"), true);
  assert.equal(f.stepButton.disabled, false);
  f.source.value += "\nnew_value <- 3";
  f.source.emit("input");
  assert.equal(f.stepButton.disabled, true);
  assert.equal(f.continueButton.disabled, true);
  assert.equal(f.evaluateButton.disabled, true);
  assert.equal(f.targetLine.disabled, true);
  assert.equal(f.stopButton.disabled, false);
  assert.equal(f.statusButton.disabled, false);
  assert.equal(await f.instance.execute("step"), false);
  assert.equal(await f.instance.execute("continue"), false);
  f.watchExpression.value = "a + 1";
  assert.equal(await f.instance.execute("evaluate"), false);
  assert.match(f.target.textContent, /source changed/);
  assert.deepEqual(calls.map(item => item[0]), ["start"]);
  // Undo restores the characters, but not the original source revision.
  f.source.value = "a <- 1\nb <- 2\nstop('bad')";
  f.source.emit("input");
  assert.equal(await f.instance.execute("step"), false);
  assert.equal(f.stepButton.disabled, true);
  assert.equal(await f.instance.execute("status"), true);
  assert.equal(f.stepButton.disabled, true);
  assert.equal(await f.instance.execute("stop"), true);
  assert.equal(await f.instance.execute("start"), true);
  assert.equal(f.stepButton.disabled, false);
  assert.deepEqual(calls.map(item => item[0]), ["start", "status", "stop", "start"]);
});

test("R failed-frame evaluation cannot target a different document", async () => {
  let document = 0;
  const calls = [];
  const native = {
    available:() => true,
    async debugRStart() { return result("paused"); },
    async debugRCommand(action) {
      calls.push(action);
      if (action === "step") return result("error", {
        ok:false, failed_line:2, frames:[{id:1, call:"broken()", locals:["x"]}]
      });
      if (action === "stop") return result("idle", {total:0, frames:[]});
      if (action === "status") return result("error", {ok:true, failed_line:2});
      return result("error", {failed_line:2});
    }
  };
  const f = fixture(native, () => document);
  assert.equal(await f.instance.execute("start"), true);
  assert.equal(await f.instance.execute("step"), false);
  assert.equal(f.evaluateButton.disabled, false);
  document++;
  f.instance.update();
  assert.equal(f.evaluateButton.disabled, true);
  f.watchExpression.value = "x";
  assert.equal(await f.instance.execute("evaluate"), false);
  assert.equal(await f.instance.execute("status"), true);
  assert.equal(await f.instance.execute("stop"), true);
  assert.deepEqual(calls, ["step", "status", "stop"]);
});

function mockFrameList() {
  const ownerDocument = {
    createElement() {
      const listeners = new Map(), attributes = {};
      return {
        disabled:false, textContent:"", attributes,
        setAttribute(name, value) { attributes[name] = value; },
        addEventListener(name, handler) { listeners.set(name, handler); },
        click() { listeners.get("click")?.(); }
      };
    }
  };
  return {ownerDocument, children:[], replaceChildren(...children) { this.children = children; }};
}

test("R postmortem frame controls select actual retained evaluation environments and definition lines", async () => {
  const source = control("outer <- function() 1\ninner <- function() 2\nstop('bad')");
  const language = control("r"), runtime = control("native");
  const [startButton, stepButton, continueButton, evaluateButton, stopButton,
    statusButton, targetLine, watchExpression] = Array.from({length:8}, () => control());
  const frameInput = control("0"), frameList = mockFrameList(), target = control();
  const frames = [
    {id:1, call:"outer()", definition_line:1, locals:["outer_local"]},
    {id:2, call:"inner()", definition_line:2, locals:["inner_local"]}
  ];
  const calls = [];
  const native = {
    available:() => true,
    async debugRStart() { return result("paused"); },
    async debugRCommand(action, expression, frame) {
      calls.push([action, expression, frame]);
      if (action === "step") return result("error", {ok:false, frames, failed_line:3});
      if (action === "evaluate") return result("error", {ok:true, frames, failed_line:3});
      if (action === "status") return result("error", {ok:true, frames, failed_line:3});
      return result("idle", {total:0, frames:[]});
    }
  };
  const p = panel.create({native, source, language, runtime, startButton, stepButton,
    continueButton, evaluateButton, stopButton, statusButton, targetLine,
    watchExpression, frameInput, frameList, target});
  assert.equal(await p.execute("start"), true);
  assert.equal(frameList.children.length, 0);
  assert.equal(await p.execute("step"), false);
  assert.equal(frameList.children.length, 2);
  assert.equal(frameList.children[1].disabled, false);
  assert.match(frameList.children[1].textContent, /definition line 2/);
  frameList.children[1].click();
  assert.equal(frameInput.value, "2");
  assert.equal(source.selectionStart, source.value.indexOf("\n") + 1);
  assert.equal(frameList.children[1].attributes["aria-pressed"], "true");
  watchExpression.value = "inner_local";
  assert.equal(await p.execute("evaluate"), true);
  assert.deepEqual(calls.at(-1), ["evaluate", "inner_local", 2]);
  assert.equal(await p.execute("status"), true);
  assert.equal(frameInput.value, "2");
  assert.equal(frameList.children[1].attributes["aria-pressed"], "true");
  assert.equal(await p.execute("stop"), true);
  assert.equal(frameList.children.length, 0);
});

test("R postmortem frame controls refuse stale editor revisions and never claim live stepping", async () => {
  const source = control("f <- function() stop('bad')\nf()");
  const language = control("r"), runtime = control("native");
  const [startButton, stepButton, continueButton, evaluateButton, stopButton,
    statusButton, targetLine, watchExpression] = Array.from({length:8}, () => control());
  const frameInput = control("0"), frameList = mockFrameList(), target = control();
  const frames = [{id:1, call:"f()", definition_line:1, locals:["value"]}];
  const native = {
    available:() => true,
    async debugRStart() { return result("paused"); },
    async debugRCommand(action) {
      if (action === "step") return result("error", {ok:false, frames, failed_line:2});
      if (action === "status") return result("error", {ok:true, frames, failed_line:2});
      return result("idle", {total:0, frames:[]});
    }
  };
  const p = panel.create({native, source, language, runtime, startButton, stepButton,
    continueButton, evaluateButton, stopButton, statusButton, targetLine,
    watchExpression, frameInput, frameList, target});
  await p.execute("start");
  await p.execute("step");
  const previous = source.selectionStart;
  source.value += "\nchanged <- TRUE";
  source.emit("input");
  assert.equal(frameList.children[0].disabled, true);
  frameList.children[0].click();
  assert.equal(frameInput.value, "0");
  assert.equal(source.selectionStart, previous);
  assert.equal(await p.execute("status"), true);
  assert.equal(frameList.children[0].disabled, true);
  assert.equal(await p.execute("stop"), true);
});

test("native R frame buttons are present and wired in the actual workspace", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="rDebugFrames"/);
  assert.match(html, /frameList:\$("rDebugFrames"\)/);
});
