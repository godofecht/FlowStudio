"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const panel = require("../docs/app/python_debug_panel.js");

function control(value = "") {
  const listeners = new Map();
  return {
    value, disabled:false, textContent:"",
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type) { listeners.get(type)?.(); }
  };
}
function paused() {
  return {state:"paused", ok:true, message:"", output:"", stack:[
    {line:2, function:"<module>", locals:{}}
  ]};
}
function stopped() {
  return {state:"stopped", ok:true, message:"", output:"", stack:[]};
}
function fixture({getDocument = true, deferredStart = null} = {}) {
  let documentId = getDocument ? "first-document" : null;
  const source = control("number = 1\nnumber += 1\nprint(number)\n");
  const language = control("python");
  const actions = [], visits = [], notices = [];
  const native = {
    available:() => true,
    async debugPythonStart(code) {
      actions.push(["start", code]);
      return deferredStart ? await deferredStart : paused();
    },
    async debugPythonCommand(action) {
      actions.push([action]);
      return action === "stop" ? stopped() : paused();
    }
  };
  const controls = {
    native, source, language, breakpoints:control("2"),
    startButton:control(), stepButton:control(), nextButton:control(),
    finishButton:control(), continueButton:control(), stopButton:control(),
    statusButton:control(), target:control(),
    getDocId:() => documentId,
    onFrame:frame => visits.push(frame.line),
    notice:message => notices.push(message)
  };
  return {
    ui:panel.create(controls), controls, actions, visits, notices,
    setDocument(value) { documentId = value; }
  };
}

test("live Python debugger refuses stepping a different document while permitting stop", async () => {
  const f = fixture();
  assert.equal(await f.ui.execute("start"), true);
  assert.deepEqual(f.visits, [2]);
  f.setDocument("second-document");
  for (const action of ["step", "next", "finish", "continue"]) {
    assert.equal(await f.ui.execute(action), false, action);
  }
  assert.deepEqual(f.actions.map(entry => entry[0]), ["start"]);
  assert.equal(f.controls.stepButton.disabled, true);
  assert.match(f.notices.at(-1), /stop the old session/);
  assert.equal(await f.ui.execute("status"), true);
  assert.equal(await f.ui.execute("stop"), true);
  assert.deepEqual(f.actions.map(entry => entry[0]), ["start", "status", "stop"]);
});

test("edit and undo invalidates debugger execution even when source text matches", async () => {
  const f = fixture();
  await f.ui.execute("start");
  const original = f.controls.source.value;
  f.controls.source.value = "print('changed')";
  f.controls.source.emit("input");
  f.controls.source.value = original;
  f.controls.source.emit("input");
  assert.equal(f.controls.stepButton.disabled, true);
  assert.equal(await f.ui.execute("step"), false);
  assert.equal(f.ui.selectFrame(0), false);
  assert.deepEqual(f.actions.map(entry => entry[0]), ["start"]);
  assert.equal(await f.ui.execute("stop"), true);
});

test("switching language invalidates a paused native Python debugger", async () => {
  const f = fixture();
  await f.ui.execute("start");
  f.controls.language.value = "r";
  f.controls.language.emit("change");
  assert.equal(f.controls.continueButton.disabled, true);
  assert.equal(await f.ui.execute("continue"), false);
  assert.equal(await f.ui.execute("stop"), true);
});

test("source changed during asynchronous start cannot be stepped afterward", async () => {
  let resolveStart;
  const pending = new Promise(resolve => { resolveStart = resolve; });
  const f = fixture({deferredStart:pending});
  const start = f.ui.execute("start");
  f.controls.source.value += "\nprint('new')";
  f.controls.source.emit("input");
  resolveStart(paused());
  assert.equal(await start, true);
  assert.deepEqual(f.visits, []);
  assert.equal(await f.ui.execute("next"), false);
  assert.deepEqual(f.actions.map(entry => entry[0]), ["start"]);
  assert.equal(await f.ui.execute("stop"), true);
});

test("standalone debugger without document identity can still step unchanged source", async () => {
  const f = fixture({getDocument:false});
  assert.equal(await f.ui.execute("start"), true);
  assert.deepEqual(f.visits, []);
  assert.equal(f.controls.stepButton.disabled, false);
  assert.equal(await f.ui.execute("step"), true);
  assert.deepEqual(f.actions.map(entry => entry[0]), ["start", "step"]);
});
