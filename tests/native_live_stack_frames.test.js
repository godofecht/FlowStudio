"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const panel = require("../docs/app/python_debug_panel.js");

function button() {
  return {
    disabled: false, attributes: {}, listeners: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  };
}
function frameHost() {
  return {
    children: [],
    ownerDocument: { createElement: () => button() },
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  };
}
const nested = {
  state: "paused", ok: true, message: "", output: "",
  stack: [
    { line: 3, function: "inner", locals: {value: {type: "int", value: "4"}} },
    { line: 5, function: "<module>", locals: {} }
  ]
};
const finished = {state: "done", ok: true, message: "", output: "4\n", stack: []};
function fixture(responses) {
  let docId = "doc-a", sourceText = "def inner():\n    value = 4\n    return value\nresult = inner()\nprint(result)\n";
  const source = { get value() { return sourceText; }, set value(value) { sourceText = value; } };
  const host = frameHost(), visited = [], notices = [];
  const controls = {
    native: {
      available: () => true,
      async debugPythonStart() { return await responses.shift(); },
      async debugPythonCommand() { return await responses.shift(); }
    },
    source, language: {value: "python"}, breakpoints: {value: "3"},
    startButton: button(), stepButton: button(), nextButton: button(),
    finishButton: button(), continueButton: button(), stopButton: button(),
    statusButton: button(), target: {textContent: ""}, frameHost: host,
    getDocId: () => docId,
    onFrame: (frame, index) => visited.push([frame.line, index]),
    notice: text => notices.push(text)
  };
  return {
    controls, host, visited, notices,
    setDocId(value) { docId = value; },
    setSource(value) { sourceText = value; }
  };
}

test("paused CPython stack frames navigate their actual source lines and update selection", async () => {
  const f = fixture([nested, nested, finished]);
  const ui = panel.create(f.controls);
  assert.equal(await ui.execute("start"), true);
  assert.deepEqual(f.visited, [[3, 0]]);
  assert.equal(f.host.children.length, 2);
  assert.match(f.host.children[1].textContent, /<module>.*line 5/);
  assert.equal(f.host.children[0].attributes["aria-current"], "true");
  f.host.children[1].listeners.click();
  assert.deepEqual(f.visited, [[3, 0], [5, 1]]);
  assert.equal(f.host.children[1].attributes["aria-current"], "true");
  assert.equal(f.host.children[0].attributes["aria-current"], "false");
  assert.equal(await ui.execute("next"), true);
  assert.deepEqual(f.visited.at(-1), [3, 0]);
  assert.equal(f.host.children[0].attributes["aria-current"], "true");
  assert.equal(await ui.execute("continue"), true);
  assert.equal(f.host.children.length, 0);
  assert.equal(ui.selectFrame(0), false);
});

test("switching documents or editing source prevents stale paused-frame navigation", async () => {
  for (const kind of ["document", "source", "language"]) {
    const f = fixture([nested]);
    const ui = panel.create(f.controls);
    await ui.execute("start");
    if (kind === "document") f.setDocId("doc-b");
    else if (kind === "source") f.setSource("print('edited')");
    else f.controls.language.value = "r";
    assert.equal(ui.selectFrame(1), false);
    assert.deepEqual(f.visited, [[3, 0]]);
    assert.ok(f.host.children.every(button => button.disabled));
    assert.match(f.notices.at(-1), /navigation disabled/);
  }
});

test("asynchronous debugger responses cannot move a changed editor", async () => {
  let finish;
  const pendingResponse = new Promise(resolve => { finish = resolve; });
  const f = fixture([pendingResponse]);
  const ui = panel.create(f.controls);
  const run = ui.execute("start");
  f.setDocId("another-document");
  finish(nested);
  assert.equal(await run, true);
  assert.deepEqual(f.visited, []);
  assert.ok(f.host.children.every(button => button.disabled));
  assert.match(f.controls.target.textContent, /Line 3 in inner/);
});

test("status without an owned source snapshot cannot jump to unrelated code", async () => {
  const f = fixture([nested]);
  const ui = panel.create(f.controls);
  assert.equal(await ui.execute("status"), true);
  assert.deepEqual(f.visited, []);
  assert.equal(ui.selectFrame(0), false);
});

test("native workspace wires paused frames to the actual editor and keeps labels inert", () => {
  const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
  const html = read("web/index.html");
  const wiring = read("web/workspace_panels.js");
  assert.match(html, /id="liveDebugFrames"/);
  assert.match(html, /class="live-debug-frames"/);
  assert.match(wiring, /frameHost: el\("liveDebugFrames"\)/);
  assert.match(wiring, /getDocId: activeDocumentId/);
  assert.match(wiring, /onFrame: frame => global\.FlowStudioApp\.revealPosition\(frame\.line, 1\)/);
  const f = fixture([{...nested, stack: [
    {line: 3, function: "<img onerror=alert(1)>", locals: {}}
  ]}]);
  return panel.create(f.controls).execute("start").then(() => {
    assert.equal(f.host.children[0].textContent.includes("<img"), true);
    assert.equal(f.host.children[0].innerHTML, undefined);
  });
});
