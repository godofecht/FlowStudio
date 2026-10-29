"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {mount} = require("../web/flow_diagnostics.js");

function fixture(checkSyntax) {
  const events = {};
  const initial = "function main() -> i32 {\n  return 0\n}";
  let documentId = "main.flow";
  function makeModel(value) {
    let version = 1;
    return {
      getValue: () => value,
      getVersionId: () => version,
      getLineCount: () => value.split("\n").length,
      getLineMaxColumn: line => value.split("\n")[line - 1].length + 1,
      edit(next) { value = next; version++; events.content(); },
      bumpWithoutEvent() { version++; }
    };
  }
  let currentModel = makeModel(initial);
  const editor = {
    getModel: () => currentModel,
    createDecorationsCollection: () => ({set() {}, clear() {}}),
    onDidChangeModelContent: fn => { events.content = fn; },
    onDidChangeModel: fn => { events.model = fn; },
    setPosition(point) { this.position = point; },
    revealPositionInCenterIfOutsideViewport(point) { this.revealed = point; }
  };
  const problems = {
    hidden: true,
    children: [],
    ownerDocument: {
      createElement(tag) {
        assert.equal(tag, "button");
        return {
          handlers: {},
          addEventListener(name, fn) { this.handlers[name] = fn; },
          click() { this.handlers.click(); }
        };
      }
    },
    replaceChildren(...children) { this.children = children; }
  };
  const language = {value: "flow", addEventListener(name, fn) { events.language = fn; }};
  const output = {hidden: true, textContent: ""};
  const status = {textContent: "", dataset: {}};
  const button = {disabled: false, addEventListener() {}};
  const controller = mount({
    editor, problems, language, output, status, button,
    native: {available: () => true, checkSyntax},
    app: {documents: {active: () => ({id: documentId})}}
  });
  return {
    controller, editor, problems, language, output, status, button, initial,
    edit: text => currentModel.edit(text),
    bumpWithoutEvent: () => currentModel.bumpWithoutEvent(),
    switchDoc: (id, text = initial) => {
      documentId = id; currentModel = makeModel(text); events.model();
    },
    switchLanguage: value => { language.value = value; events.language(); }
  };
}

test("Flow compiler problems expose every valid location as a clickable source target", async () => {
  const f = fixture(async () => ({ok: false, output: "two errors", diagnostics: [
    {line: 2, column: 3, message: "unexpected token"},
    {line: 1, column: 10, message: "invalid declaration"}
  ]}));
  assert.equal(await f.controller.check(), false);
  assert.equal(f.problems.hidden, false);
  assert.equal(f.problems.children.length, 2);
  assert.equal(f.problems.children[0].type, "button");
  assert.match(f.problems.children[0].textContent, /Line 2, column 3: unexpected token/);
  assert.deepEqual(f.editor.position, {lineNumber: 2, column: 3});
  f.problems.children[1].click();
  assert.deepEqual(f.editor.position, {lineNumber: 1, column: 10});
  assert.deepEqual(f.editor.revealed, f.editor.position);
  assert.equal(f.controller.navigateToProblem(2), false);
  assert.equal(f.controller.navigateToProblem(-1), false);
});

test("compiler-provided source is displayed as text, never interpreted as HTML", async () => {
  const message = '<img src=x onerror=alert(1)>';
  const f = fixture(async () => ({ok: false, output: message, diagnostics: [
    {line: 1, column: 1, message}
  ]}));
  await f.controller.check();
  assert.equal(f.problems.children[0].textContent, "Line 1, column 1: " + message);
  assert.equal(f.problems.children[0].innerHTML, undefined);
  assert.equal(f.output.textContent, message);
});

test("source edits and undo remove locations and block previously captured click handlers", async () => {
  const f = fixture(async () => ({ok: false, output: "bad", diagnostics: [
    {line: 2, column: 1, message: "bad"}
  ]}));
  await f.controller.check();
  const staleButton = f.problems.children[0];
  f.edit("changed");
  f.edit(f.initial);
  assert.equal(f.problems.hidden, true);
  assert.equal(f.problems.children.length, 0);
  assert.equal(f.output.hidden, true);
  f.editor.position = {lineNumber: 3, column: 1};
  staleButton.click();
  assert.deepEqual(f.editor.position, {lineNumber: 3, column: 1});
  assert.equal(f.controller.navigateToProblem(0), false);
});

test("document and language changes cannot navigate an unrelated Monaco buffer", async () => {
  const f = fixture(async () => ({ok: false, output: "bad", diagnostics: [
    {line: 1, column: 1, message: "bad"}
  ]}));
  await f.controller.check();
  const staleButton = f.problems.children[0];
  f.switchDoc("other.flow");
  f.editor.position = {lineNumber: 3, column: 1};
  staleButton.click();
  assert.deepEqual(f.editor.position, {lineNumber: 3, column: 1});
  await f.controller.check();
  const secondButton = f.problems.children[0];
  f.switchLanguage("r");
  secondButton.click();
  assert.equal(f.problems.hidden, true);
  assert.equal(f.button.disabled, true);
  assert.deepEqual(f.editor.position, {lineNumber: 1, column: 1});
});

test("revision mismatch is refused even before Monaco emits an edit notification", async () => {
  const f = fixture(async () => ({ok: false, output: "bad", diagnostics: [
    {line: 2, column: 2, message: "bad"}
  ]}));
  await f.controller.check();
  f.editor.position = {lineNumber: 3, column: 1};
  f.bumpWithoutEvent();
  f.problems.children[0].click();
  assert.deepEqual(f.editor.position, {lineNumber: 3, column: 1});
});

test("invalid locations are excluded and the source problem list is bounded to 64", async () => {
  const diagnostics = [
    {line: 0, column: 1, message: "invalid"},
    ...Array.from({length: 70}, (_, index) => ({
      line: 1, column: index + 1, message: "diagnostic " + index
    }))
  ];
  const f = fixture(async () => ({ok: false, output: "many", diagnostics}));
  await f.controller.check();
  assert.equal(f.problems.children.length, 63);
  assert.equal(f.problems.children[0].textContent.includes("diagnostic 0"), true);
  assert.deepEqual(f.editor.position, {lineNumber: 1, column: 1});
});

test("late compiler results cannot repopulate a cleared problems list", async () => {
  let reply;
  const f = fixture(() => new Promise(resolve => { reply = resolve; }));
  const check = f.controller.check();
  f.edit("new buffer");
  reply({ok: false, output: "stale", diagnostics: [
    {line: 1, column: 1, message: "stale"}
  ]});
  assert.equal(await check, false);
  assert.equal(f.problems.hidden, true);
  assert.equal(f.problems.children.length, 0);
  assert.equal(f.editor.position, undefined);
});

test("compiler errors without source locations preserve raw output without invented targets", async () => {
  const f = fixture(async () => ({ok: false, output: "compiler process failed", diagnostics: []}));
  assert.equal(await f.controller.check(), false);
  assert.equal(f.problems.hidden, true);
  assert.equal(f.problems.children.length, 0);
  assert.equal(f.output.textContent, "compiler process failed");
});
