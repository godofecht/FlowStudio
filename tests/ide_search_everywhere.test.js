"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeNode, makeDoc } = require("./ui_dom.js");
const search = require("../web/ide_search_everywhere.js");

const EVENT = { preventDefault() {} };

function searchDoc() {
  const dialog = new FakeNode("dialog", "se-dialog");
  dialog.setAttribute("id", "searchEverywhere");
  const query = new FakeNode("input");
  const groups = new FakeNode("div", "se-groups");
  const doc = makeDoc({ searchEverywhere: dialog, seQuery: query, seGroups: groups });
  return { doc, dialog, query, groups };
}

function appStub(overrides = {}) {
  const activated = [];
  const commands = {
    run() { commands.runFired = (commands.runFired || 0) + 1; },
    showFiles() { commands.showFilesFired = (commands.showFilesFired || 0) + 1; },
    ...overrides
  };
  const app = {
    activated,
    commands,
    documents: {
      list: () => [
        { id: "d1", name: "main.flow", language: "flow", dirty: false },
        { id: "d2", name: "analysis.R", language: "r", dirty: true }
      ]
    },
    activateDocument: id => {
      if (id === "missing") return null;
      activated.push(id);
      return { id };
    }
  };
  return app;
}

function examplesStub() {
  return {
    examples: () => [
      { id: "ex1", title: "Flow pipeline", files: [{ name: "a.flow" }] },
      { id: "ex2", title: "R regression study", files: [{ name: "a.R" }, { name: "b.R" }] }
    ]
  };
}

function mount(doc, extra = {}) {
  return search.mount(doc, {
    app: appStub(),
    examples: examplesStub(),
    ...extra
  });
}

test("boundary-aware scoring ranks word starts above substring above subsequence", () => {
  assert.equal(search.score("Run current cell", "run"), 100);
  assert.equal(search.score("Toggle console dock", "console"), 90);
  assert.equal(search.score("Run current cell", "rc"), 10);     // subsequence
  assert.equal(search.score("Run current cell", "xyz"), 0);
  assert.equal(search.score("Anything", ""), 1);                // empty query ranks low
});

test("results group commands, open buffers and examples", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.open();
  assert.equal(controller.isOpen(), true);
  assert.equal(context.dialog.open, true);
  const rows = controller.rows();
  const labels = rows.map(row => row.label);
  // Equal empty-query weights fall back to alphabetical order per group.
  // Commands: only registered commands land in Commands ("run" and "showFiles").
  assert.deepEqual(labels.slice(0, 2), ["Run selection or file", "Show project files"]);
  assert.deepEqual(labels.slice(2, 4),
    ["analysis.R ● · r", "main.flow · flow"]);
  assert.deepEqual(labels.slice(4), ["Flow pipeline", "R regression study"]);
  assert.equal(rows[0].kind, "command");
  assert.equal(rows[2].kind, "buffer");
  assert.equal(rows[4].kind, "example");
  assert.equal(context.groups.querySelectorAll(".se-row").length, 6);
});

test("filtering respects both ranking and registered commands", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.open("an");
  // "an" scores analysis.R as a word start (100) and main.flow as a subsequence (10).
  const labels = controller.rows().map(row => row.label);
  assert.deepEqual(labels, ["analysis.R ● · r", "main.flow · flow"]);
});

test("Enter runs the selected command and closes the overlay", () => {
  const context = searchDoc();
  const app = appStub();
  const controller = search.mount(context.doc, { app, examples: examplesStub() });
  controller.open();
  context.query.fire("keydown", { key: "Enter", ...EVENT });
  assert.equal(app.commands.runFired, 1);          // first row = "Run selection or file"
  assert.equal(controller.isOpen(), false);
});

test("Enter on a buffer row activates that document", () => {
  const context = searchDoc();
  const app = appStub();
  const controller = search.mount(context.doc, { app, examples: examplesStub() });
  controller.open();
  controller.moveSelection(2);                     // commands(2) -> first buffer row
  assert.equal(controller.selection(), 2);
  assert.equal(controller.rows()[2].label, "analysis.R ● · r");
  context.query.fire("keydown", { key: "Enter", ...EVENT });
  assert.deepEqual(app.activated, ["d2"]);
  assert.equal(app.commands.runFired, undefined);
});

test("typing re-renders and arrow keys cycle the selection", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.open();
  context.query.value = "flow";
  context.query.fire("input", {});
  const labels = controller.rows().map(row => row.label);
  assert.ok(labels.includes("main.flow · flow"));
  assert.ok(labels.includes("Flow pipeline"));
  controller.moveSelection(1);
  assert.equal(controller.selection(), 1);
  highlightSelected(context, 1);
});

function highlightSelected(context, index) {
  const rows = context.groups.querySelectorAll(".se-row");
  rows.forEach((row, i) => {
    if (i === index) assert.equal(row.getAttribute("aria-selected"), "true");
    else assert.notEqual(row.getAttribute("aria-selected"), "true");
  });
}

test("Escape closes the open overlay but leaves selection restartable", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.open();
  context.query.fire("keydown", { key: "Escape", ...EVENT });
  assert.equal(controller.isOpen(), false);
  assert.equal(context.dialog.open, false);
});

test("double Shift opens the overlay from anywhere", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.shift({ key: "Shift", preventDefault() {} });
  assert.equal(controller.isOpen(), false, "single Shift does not open");
  controller.shift({ key: "Shift", preventDefault() {} });
  assert.equal(controller.isOpen(), true, "two Shift presses within the window open");
});

test("double Shift is ignored inside the search dialog and with modifiers", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.open();
  controller.close();
  // Inside the search context (target within #searchEverywhere) nothing re-opens.
  controller.shift({ key: "Shift", target: context.dialog, preventDefault() {} });
  controller.shift({ key: "Shift", target: context.dialog, preventDefault() {} });
  assert.equal(controller.isOpen(), false);
  // Modified Shift resets the window instead of opening.
  controller.shift({ key: "Shift", ctrlKey: true, preventDefault() {} });
  controller.shift({ key: "Shift", preventDefault() {} });
  assert.equal(controller.isOpen(), false);
});

test("the closed dialog opens on a direct click, the open dialog dismisses on backdrop", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  context.dialog.fire("click", { target: context.dialog });   // Tools menu data-act
  assert.equal(controller.isOpen(), true);
  context.dialog.fire("click", { target: context.dialog });   // backdrop click
  assert.equal(controller.isOpen(), false);
  // Clicks targeting rows inside the dialog never toggle the overlay.
  controller.open();
  const row = context.groups.querySelectorAll(".se-row")[0];
  row.addEventListener("click", () => {});                    // row has its own handler
  context.dialog.fire("click", { target: row });
  assert.equal(controller.isOpen(), true);
});

test("clicking a row activates its kind", () => {
  const context = searchDoc();
  const app = appStub();
  search.mount(context.doc, { app, examples: examplesStub() }).open();
  context.groups.querySelectorAll(".se-row")[3].fire("click", {});  // main.flow buffer
  assert.deepEqual(app.activated, ["d1"]);
});
