"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {mount} = require("../web/flow_diagnostics.js");

function fixture(checkSyntax) {
  const events = {}, timers = new Map(), markers = [];
  let nextTimer = 0, currentDoc = "main.flow", currentModel;
  const scheduler = {
    setTimeout(fn, delay) {
      assert.equal(delay, 1100);
      const id = ++nextTimer;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    tick() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach(fn => fn());
    },
    count() { return timers.size; }
  };
  function model(value) {
    let version = 1;
    return {
      getValue: () => value,
      getVersionId: () => version,
      getLineCount: () => value.split("\n").length,
      getLineMaxColumn: line => value.split("\n")[line - 1].length + 1,
      edit(text) { value = text; version++; events.content(); }
    };
  }
  currentModel = model("function main() -> i32 {\n  return 0\n}");
  const editor = {
    getModel: () => currentModel,
    createDecorationsCollection: () => ({
      set(value) { markers.push(value); },
      clear() { markers.push([]); }
    }),
    onDidChangeModelContent(fn) { events.content = fn; },
    onDidChangeModel(fn) { events.model = fn; },
    setPosition(point) { this.position = point; },
    revealPositionInCenterIfOutsideViewport(point) { this.revealed = point; }
  };
  const autoCheck = {
    checked: false,
    addEventListener(type, fn) { assert.equal(type, "change"); events.auto = fn; }
  };
  const language = {value: "flow", addEventListener(type, fn) { events.language = fn; }};
  const button = {disabled: false, addEventListener(type, fn) { events.button = fn; }};
  const output = {hidden: true, textContent: ""};
  const status = {textContent: "", dataset: {}};
  const controller = mount({
    editor, native: {available: () => true, checkSyntax},
    app: {documents: {active: () => ({id: currentDoc})}},
    language, button, output, status, autoCheck, scheduler
  });
  return {
    controller, editor, autoCheck, language, button, output, status,
    events, scheduler, markers,
    enable() { autoCheck.checked = true; events.auto(); },
    disable() { autoCheck.checked = false; events.auto(); },
    edit(value) { currentModel.edit(value); },
    switchDoc(id, value) { currentDoc = id; currentModel = model(value); events.model(); }
  };
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("idle checks are opt-in and never move the editor caret", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return {ok: false, output: "real compiler error",
      diagnostics: [{line: 2, column: 3, message: "unexpected token"}]};
  });
  assert.equal(f.scheduler.count(), 0);
  f.enable();
  assert.equal(f.scheduler.count(), 1);
  assert.equal(calls, 0);
  f.scheduler.tick();
  await settle();
  assert.equal(calls, 1);
  assert.equal(f.editor.position, undefined);
  assert.equal(f.markers.at(-1).length, 1);
  assert.equal(f.status.dataset.state, "error");
});

test("multiple edits debounce into one compiler request for the newest source", async () => {
  const sources = [];
  const f = fixture(async source => {
    sources.push(source);
    return {ok: true, output: "passed", diagnostics: []};
  });
  f.enable();
  f.edit("first");
  f.edit("second");
  assert.equal(f.scheduler.count(), 1);
  f.scheduler.tick();
  await settle();
  assert.deepEqual(sources, ["second"]);
});

test("idle compiler requests do not overlap and recheck after stale responses", async () => {
  let firstReply, calls = 0;
  const f = fixture(() => {
    calls++;
    if (calls === 1) return new Promise(resolve => { firstReply = resolve; });
    return Promise.resolve({ok: true, output: "fresh", diagnostics: []});
  });
  f.enable();
  f.scheduler.tick();
  await settle();
  f.edit("changed");
  f.scheduler.tick();
  await settle();
  assert.equal(calls, 1);
  firstReply({ok: false, output: "stale",
    diagnostics: [{line: 1, column: 1, message: "stale"}]});
  await settle();
  assert.equal(f.output.hidden, true);
  assert.equal(f.scheduler.count(), 1);
  f.scheduler.tick();
  await settle();
  assert.equal(calls, 2);
  assert.equal(f.output.textContent, "fresh");
});

test("disabling idle checks cancels queued work and invalidates in-flight results", async () => {
  let reply;
  const f = fixture(() => new Promise(resolve => { reply = resolve; }));
  f.enable();
  f.scheduler.tick();
  await settle();
  f.disable();
  reply({ok: false, output: "stale", diagnostics: []});
  await settle();
  assert.equal(f.output.hidden, true);
  assert.equal(f.scheduler.count(), 0);
});

test("explicit Check Flow cancels idle work and preserves source navigation", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return {ok: false, output: "bad",
      diagnostics: [{line: 1, column: 1, message: "bad"}]};
  });
  f.enable();
  await f.controller.check();
  assert.equal(calls, 1);
  assert.equal(f.scheduler.count(), 0);
  assert.deepEqual(f.editor.position, {lineNumber: 1, column: 1});
});

test("language and document switches invalidate idle results and never check R", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return {ok: true, output: "passed", diagnostics: []};
  });
  f.enable();
  f.language.value = "r";
  f.events.language();
  assert.equal(f.scheduler.count(), 0);
  f.scheduler.tick();
  await settle();
  assert.equal(calls, 0);
  f.language.value = "flow";
  f.events.language();
  f.switchDoc("other.flow", "function main() -> i32 { return 1 }");
  assert.equal(f.scheduler.count(), 1);
  f.scheduler.tick();
  await settle();
  assert.equal(calls, 1);
});
