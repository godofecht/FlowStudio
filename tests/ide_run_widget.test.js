"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeNode, makeDoc } = require("./ui_dom.js");
const widget = require("../web/ide_run_widget.js");

const EVENT = { preventDefault() {} };

function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); }
  };
}

function runDoc(languageValue = "flow", backendValue = "") {
  const runConfigChip = new FakeNode("button", "run-chip");
  const runChipLang = new FakeNode("span", "run-chip-lang");
  const runChipBackend = new FakeNode("span", "run-chip-backend");
  const language = new FakeNode("select");
  language.value = languageValue;
  const flowBackend = new FakeNode("select");
  flowBackend.value = backendValue;
  const runConfigDialog = new FakeNode("dialog", "se-dialog");
  const runConfigList = new FakeNode("div", "se-groups");
  const runConfigQuery = new FakeNode("input");
  const doc = makeDoc({
    runConfigChip, runChipLang, runChipBackend, language, flowBackend,
    runConfigDialog, runConfigList, runConfigQuery
  });
  return { doc, runConfigChip, runChipLang, runChipBackend, language,
    flowBackend, runConfigDialog, runConfigList, runConfigQuery };
}

test("the chip mirrors the language and backend selects", () => {
  const context = runDoc("flow", "");
  widget.mount(context.doc, { storage: fakeStorage() });
  assert.equal(context.runChipLang.textContent, "Flow");
  assert.equal(context.runChipBackend.textContent, "C");
  context.language.value = "python";
  context.language.fire("change", {});
  assert.equal(context.runChipLang.textContent, "Python");
  assert.equal(context.runChipBackend.textContent, "");    // backend is Flow-only
  assert.equal(context.runConfigChip.getAttribute("data-language"), "python");
  context.language.value = "flow";
  context.flowBackend.value = "mlir";
  context.flowBackend.fire("change", {});
  assert.equal(context.runChipBackend.textContent, "MLIR");
});

test("opening the dialog preselects the current configuration", () => {
  const context = runDoc("r", "");
  const controller = widget.mount(context.doc, { storage: fakeStorage() });
  controller.openDialog();
  assert.equal(controller.isOpen(), true);
  assert.equal(context.runConfigDialog.open, true);
  assert.equal(controller.items().length, 4);           // flow×2 backends, r, python
  assert.equal(controller.selection(), 2);              // R, C backend
  const rows = context.runConfigList.querySelectorAll(".se-row");
  assert.equal(rows.length, 4);
  assert.equal(rows[controller.selection()].getAttribute("aria-selected"), "true");
});

test("arrows and Enter apply a configuration end to end", () => {
  const context = runDoc("r", "");
  const storage = fakeStorage();
  const languageChanges = [];
  context.language.addEventListener("change",
    event => languageChanges.push(event.target && event.target.value));
  const controller = widget.mount(context.doc, { storage });
  controller.openDialog();
  controller.moveSelection(1);                          // R -> python (C backend)
  controller.moveSelection(1);                          // wraps to flow + C
  controller.moveSelection(1);                          // flow + MLIR
  const chosen = controller.items()[controller.selection()];
  controller.openDialog();                              // reopen resets to R, position 2
  assert.equal(controller.items()[controller.selection()].language, "r");
  controller.moveSelection(1);                          // R -> python
  assert.ok(controller.apply("python", ""),
    "apply() validates language and backend ids");
  assert.equal(controller.apply("flow", "nope"), false); // unknown backend rejected
  assert.equal(context.language.value, "python");
  assert.equal(context.flowBackend.value, "");
  assert.ok(languageChanges.includes("python"), "language change event emitted");
  assert.equal(storage.getItem(widget.KEY),
    JSON.stringify({ language: "python", backend: "" }));
  assert.equal(context.runChipLang.textContent, "Python");
  assert.equal(controller.isOpen(), false);
  assert.equal(controller.items()[controller.selection()].language, "python");
  void chosen;
});

test("the dialog query filters configurations and Enter applies the match", () => {
  const context = runDoc("flow", "");
  const controller = widget.mount(context.doc, { storage: fakeStorage() });
  controller.openDialog();
  context.runConfigQuery.value = "mlir";
  context.runConfigQuery.fire("input", {});
  controller.render();
  assert.equal(controller.items().length, 1);
  context.runConfigQuery.fire("keydown", { key: "Enter", ...EVENT });
  assert.equal(context.language.value, "flow");
  assert.equal(context.flowBackend.value, "mlir");
  assert.equal(controller.isOpen(), false);
  assert.equal(context.runChipBackend.textContent, "MLIR");
});

test("the chip click toggles the dialog and Escape dismisses it", () => {
  const context = runDoc("flow", "");
  const controller = widget.mount(context.doc, { storage: fakeStorage() });
  context.runConfigChip.fire("click", {});
  assert.equal(controller.isOpen(), true);
  context.runConfigQuery.fire("keydown", { key: "Escape", ...EVENT });
  assert.equal(controller.isOpen(), false);
  context.runConfigChip.fire("click", {});
  assert.equal(controller.isOpen(), true);
  context.runConfigChip.fire("click", {});
  assert.equal(controller.isOpen(), false);
});

test("a stored configuration is restored at mount and announced", () => {
  const context = runDoc("flow", "");
  const storage = fakeStorage({
    [widget.KEY]: JSON.stringify({ language: "r", backend: "" })
  });
  const changes = [];
  context.language.addEventListener("change", event => changes.push(event.target.value));
  widget.mount(context.doc, { storage });
  assert.equal(context.language.value, "r");
  assert.equal(context.runChipLang.textContent, "R");
  assert.ok(changes.includes("r"), "restored configuration emits change");
});

test("corrupt stored configurations are ignored", () => {
  assert.equal(widget.readStorage(fakeStorage({ [widget.KEY]: "{not json" })), null);
  assert.equal(widget.readStorage(fakeStorage({
    [widget.KEY]: JSON.stringify({ language: "fortran", backend: "" })
  })), null);
  assert.deepEqual(
    widget.readStorage(fakeStorage({
      [widget.KEY]: JSON.stringify({ language: "python", backend: "mlir" })
    })),
    { language: "python", backend: "mlir" });
});
