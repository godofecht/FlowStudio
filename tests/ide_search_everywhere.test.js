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
  assert.equal(search.score("Run current cell", "rc"), 20);     // word-start subsequence
  assert.equal(search.score("Run current cell", "ue"), 10);     // plain subsequence
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
  // Open buffers come first, then only registered commands ("run" and "showFiles").
  assert.deepEqual(labels.slice(0, 2), ["analysis.R", "main.flow"]);
  assert.deepEqual(labels.slice(2, 4), ["Run selection or file", "Show project files"]);
  assert.deepEqual(labels.slice(4), ["Flow pipeline", "R regression study"]);
  assert.equal(rows[0].kind, "buffer");
  assert.equal(rows[0].dirty, true);
  assert.equal(rows[2].kind, "command");
  assert.equal(rows[4].kind, "example");
  assert.equal(context.groups.querySelectorAll(".se-row").length, 6);
});

test("filtering respects both ranking and registered commands", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  controller.open("an");
  // "an" scores analysis.R as a word start (100) and main.flow as a subsequence (10).
  const labels = controller.rows().map(row => row.label);
  assert.deepEqual(labels, ["analysis.R", "main.flow"]);
});

test("Enter runs the selected command and closes the overlay", () => {
  const context = searchDoc();
  const app = appStub();
  const controller = search.mount(context.doc, { app, examples: examplesStub() });
  controller.open();
  controller.moveSelection(2);                     // buffers(2) -> "Run selection or file"
  context.query.fire("keydown", { key: "Enter", ...EVENT });
  assert.equal(app.commands.runFired, 1);
  assert.equal(controller.isOpen(), false);
});

test("Enter on a buffer row activates that document", () => {
  const context = searchDoc();
  const app = appStub();
  const controller = search.mount(context.doc, { app, examples: examplesStub() });
  controller.open();
  assert.equal(controller.selection(), 0);
  assert.equal(controller.rows()[0].label, "analysis.R");
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
  assert.ok(labels.includes("main.flow"));
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
  context.groups.querySelectorAll(".se-row")[1].fire("click", {});  // main.flow buffer
  assert.deepEqual(app.activated, ["d1"]);
});

function fileFixture() {
  const file = name => ({ kind: "file", name });
  const dir = (name, children) => ({ kind: "directory", name,
    async *entries() { for (const child of children) yield [child.name, child]; } });
  return dir("proj", [
    file("main.flow"),
    dir("src", [file("solver.flow"), file("plot_results.py")]),
    dir(".git", [file("HEAD")]),
    dir("node_modules", [file("index.js")])
  ]);
}

test("the file index walks the folder and skips .git and node_modules", async () => {
  const { files, truncated } = await search.buildFileIndex(fileFixture());
  assert.deepEqual(files.map(f => f.rel), ["main.flow", "src/plot_results.py", "src/solver.flow"]);
  assert.equal(files[2].dir, "src");
  assert.equal(truncated, false);
  const limited = await search.buildFileIndex(fileFixture(), { files: 2, depth: 12, entries: 100 });
  assert.equal(limited.files.length, 2);
  assert.equal(limited.truncated, true);
});

test("file results rank by name, highlight matches and open through the app", async () => {
  const context = searchDoc();
  const { files } = await search.buildFileIndex(fileFixture());
  const opened = [];
  const controller = search.mount(context.doc, { app: appStub(), examples: examplesStub(), files,
    openFile: entry => { opened.push(entry.rel); return true; } });
  controller.open("pr");
  const fileRows = controller.rows().filter(row => row.kind === "file");
  assert.equal(fileRows[0].rel, "src/plot_results.py");     // p..r on word starts
  controller.open("solver");
  assert.equal(controller.rows()[0].rel, "src/solver.flow");
  assert.deepEqual(controller.rows()[0].positions, [0, 1, 2, 3, 4, 5]);
  const marks = context.groups.querySelectorAll(".se-row")[0].querySelectorAll("mark");
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent, "solver");
  context.query.fire("keydown", { key: "Enter", ...EVENT });
  assert.deepEqual(opened, ["src/solver.flow"]);
});

test("Tab cycles scopes and a leading > searches commands only", async () => {
  const context = searchDoc();
  const tabs = new FakeNode("div");
  context.doc.ids.set("seTabs", tabs);
  const { files } = await search.buildFileIndex(fileFixture());
  const controller = search.mount(context.doc, { app: appStub(), examples: examplesStub(), files });
  controller.open("");
  assert.equal(controller.scope(), "all");
  assert.equal(tabs.querySelectorAll(".se-tab").length, search.TABS.length);
  context.query.fire("keydown", { key: "Tab", ...EVENT });
  assert.equal(controller.scope(), "files");
  assert.deepEqual(controller.rows().map(row => row.kind), ["file", "file", "file"]);
  context.query.fire("keydown", { key: "Tab", shiftKey: true, ...EVENT });
  assert.equal(controller.scope(), "all");
  context.query.value = "> show";
  context.query.fire("input", {});
  assert.deepEqual(controller.rows().map(row => row.label), ["Show project files"]);
});

test("typing a double quote never opens the overlay", () => {
  /* '"' is Shift+' on most layouts. Two quotes typed quickly press Shift
   * twice inside the window, with the quote key in between. */
  const context = searchDoc();
  const controller = mount(context.doc);
  const key = k => context.doc.fireDocument("keydown", { key: k, preventDefault() {} });
  key("Shift"); key('"'); key("Shift"); key('"');
  assert.equal(controller.isOpen(), false);
  key("Shift"); key("Shift");
  assert.equal(controller.isOpen(), true);
});

test("Ctrl+P opens files and Ctrl+K opens commands", () => {
  const context = searchDoc();
  const controller = mount(context.doc);
  context.doc.fireDocument("keydown", { key: "p", ctrlKey: true, preventDefault() {} });
  assert.equal(controller.scope(), "files");
  controller.close();
  context.doc.fireDocument("keydown", { key: "k", metaKey: true, preventDefault() {} });
  assert.equal(controller.isOpen(), true);
  assert.equal(controller.scope(), "commands");
});
