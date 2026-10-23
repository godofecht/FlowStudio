"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const projectSource = fs.readFileSync(path.join(root, "web/project.js"), "utf8").trimEnd();
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).filter(source => source.trim() && !source.includes("FlowStudioWorkspaceTabs.mount();"));

class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.textContent = "";
    this.value = "";
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.focused = false;
    this.open = false;
    this.scrollTop = 0;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  fire(event, payload = {}) { return this.listeners[event]?.(payload); }
  click() { return this.fire("click"); }
  focus() { this.focused = true; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setRangeText(text, start, end) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.setSelectionRange(start + text.length, start + text.length);
  }
}
function file(name, initial = "") {
  let content = initial;
  return {
    kind: "file", name,
    get content() { return content; },
    async getFile() { return { name, text: async () => content }; },
    async createWritable() {
      let pending = content;
      return {
        write: async value => { pending = value; },
        close: async () => { content = pending; }
      };
    }
  };
}
function directory(name, children = []) {
  const entries = new Map(children);
  return {
    kind: "directory", name,
    async *entries() { yield* entries.entries(); },
    async getFileHandle(name, options = {}) {
      if (!entries.has(name) && options.create) entries.set(name, file(name));
      if (!entries.has(name)) throw new Error("File not found");
      return entries.get(name);
    }
  };
}
function workspace(folder) {
  const elements = new Map();
  const ids = [
    "source", "language", "console", "resultStatus", "fileLabel", "dirty",
    "cursor", "run", "runCell", "resetPython", "refreshPythonEnvironment", "pythonEnvironment", "open", "save", "clear", "fallbackOpen", "runtimeInfo",
    "projectTree", "folder", "newFile", "refreshProject",
    "projectSearch", "caseSensitive", "searchProject", "searchResults",
    "editorFind", "editorReplace", "findNext", "findPrevious",
    "replaceOne", "replaceAll", "editorCaseSensitive", "editorFindCount"
  ];
  for (const id of ids) elements.set(id, new Element());
  elements.get("source").value = "initial";
  elements.get("language").value = "flow";
  elements.get("console").textContent = "Ready";
  let allowDiscard = true;
  let nextFilename = "created.flow";
  const fetches = [];
  const inspectionFetches = [];
  const document = {
    getElementById: id => {
      assert.ok(elements.has(id), "Missing element: " + id);
      return elements.get(id);
    },
    createElement: tag => new Element(tag),
    listeners: {},
    addEventListener(event, fn) { this.listeners[event] = fn; }
  };
  const window = {
    showDirectoryPicker: async () => folder,
    prompt: () => nextFilename
  };
  const context = vm.createContext({
    window, document,
    confirm: () => allowDiscard,
    fetch: async (url, options) => {
      if (url === "/api/inspect/python") {
        inspectionFetches.push({ url, options });
        return { ok: true, status: 200,
          json: async () => ({ variables: [{ name: "value", type: "int", size: null }], truncated: false }) };
      }
      fetches.push({ url, options });
      return { ok: true, status: 200, text: async () => "ran" };
    },
    Blob, URL, setTimeout, console
  });
  assert.equal(scripts.length, 4, "Expected project, editor-find, cells and workspace scripts");
  vm.runInContext(scripts[0], context, { filename: "project-embedded.js" });
  vm.runInContext(scripts[1], context, { filename: "editor-find-embedded.js" });
  vm.runInContext(scripts[2], context, { filename: "source-cells-embedded.js" });
  vm.runInContext(scripts[3], context, { filename: "workspace.js" });
  return {
    el: id => elements.get(id), document, fetches, inspectionFetches,
    setDiscard: value => { allowDiscard = value; },
    setNewFilename: value => { nextFilename = value; }
  };
}

test("embedded project module exactly mirrors tested standalone source", () => {
  assert.equal(scripts[0].trim(), projectSource);
  const findSource = fs.readFileSync(path.join(root, "web/editor_find.js"), "utf8").trimEnd();
  assert.equal(scripts[1].trim(), findSource);
  assert.equal(scripts[2].trim(), fs.readFileSync(path.join(root, "web/source_cells.js"), "utf8").trimEnd());
  assert.match(html, /id="projectTree"/);
  assert.match(html, /id="folder"/);
  assert.match(html, /id="newFile"/);
});

test("folder selection opens nested source in editor, saves to exact handle", async () => {
  const target = file("analysis.R", "x <- 7");
  const folder = directory("research", [["analysis.R", target]]);
  const app = workspace(folder);
  await app.el("folder").fire("click");
  const tree = app.el("projectTree");
  assert.equal(tree.children[1].textContent, "File: analysis.R");
  await tree.children[1].fire("click");
  assert.equal(app.el("source").value, "x <- 7");
  assert.equal(app.el("language").value, "r");
  assert.equal(app.el("fileLabel").textContent, "research/analysis.R");
  app.el("source").value = "x <- 11";
  app.el("source").fire("input");
  assert.equal(app.el("dirty").hidden, false);
  await app.el("save").fire("click");
  assert.equal(target.content, "x <- 11");
  assert.equal(app.el("dirty").hidden, true);
});

test("refuses project file switch with unsaved changes", async () => {
  const first = file("one.py", "first");
  const second = file("two.py", "second");
  const app = workspace(directory("p", [["one.py", first], ["two.py", second]]));
  await app.el("folder").fire("click");
  await app.el("projectTree").children[1].fire("click");
  app.el("source").value = "unsaved";
  app.el("source").fire("input");
  app.setDiscard(false);
  await app.el("projectTree").children[2].fire("click");
  assert.equal(app.el("source").value, "unsaved");
  assert.equal(app.el("dirty").hidden, false);
});

test("new source file is created in project and opened in editor", async () => {
  const folder = directory("work");
  const app = workspace(folder);
  await app.el("folder").fire("click");
  app.setNewFilename("result.flow");
  await app.el("newFile").fire("click");
  assert.equal(app.el("fileLabel").textContent, "work/result.flow");
  app.el("source").value = 'function main() -> i32 { return 0 }';
  app.el("source").fire("input");
  await app.el("save").fire("click");
  const handle = await folder.getFileHandle("result.flow");
  assert.equal(handle.content, app.el("source").value);
});

test("selection execution sends selected code with required request intent", async () => {
  const app = workspace(directory("empty"));
  app.el("language").value = "python";
  app.el("source").value = 'print("one")\nprint("two")';
  app.el("source").selectionStart = 0;
  app.el("source").selectionEnd = 12;
  await app.el("run").fire("click");
  assert.equal(app.fetches.length, 1);
  assert.equal(app.fetches[0].url, "/api/run/python");
  assert.equal(app.fetches[0].options.body, 'print("one")');
  assert.equal(app.fetches[0].options.headers["X-FlowStudio-Intent"], "run");
  assert.match(app.el("console").textContent, /ran/);
});

test("native Python execution refreshes environment through intent-protected inspection", async () => {
  const app = workspace(directory("empty"));
  app.el("language").value = "python";
  app.el("source").value = "value = 42";
  await app.el("run").fire("click");
  assert.equal(app.inspectionFetches.length, 1);
  assert.equal(app.inspectionFetches[0].url, "/api/inspect/python");
  assert.equal(app.inspectionFetches[0].options.headers["X-FlowStudio-Intent"], "run");
  const table = app.el("pythonEnvironment").children[0];
  assert.equal(table.tag, "table");
  assert.equal(table.children[2].children[0].textContent, "value");
  assert.equal(table.children[2].children[1].textContent, "int");
});

test("new-file action rejects unsupported filenames without creating files", async () => {
  const folder = directory("work");
  const app = workspace(folder);
  await app.el("folder").fire("click");
  app.setNewFilename("../bad.flow");
  await app.el("newFile").fire("click");
  assert.match(app.el("resultStatus").textContent, /Invalid/);
  assert.equal(app.el("projectTree").children.length, 1);
});


test("project-wide search navigates to exact match with editor selection", async () => {
  const folder = directory("research", [
    ["analysis.R", file("analysis.R", "x <- 1\nx <- 2\n")]
  ]);
  const app = workspace(folder);
  await app.el("folder").fire("click");
  app.el("projectSearch").value = "x <- 2";
  await app.el("searchProject").fire("click");
  const results = app.el("searchResults");
  assert.equal(results.children.length, 2);
  assert.match(results.children[0].textContent, /1 matches in 1 files/);
  assert.match(results.children[1].textContent, /analysis\.R:2:1/);
  await results.children[1].fire("click");
  assert.equal(app.el("source").value, "x <- 1\nx <- 2\n");
  assert.equal(app.el("source").selectionStart, 7);
  assert.equal(app.el("source").selectionEnd, 13);
  assert.equal(app.el("cursor").textContent, "Ln 2, Col 1");
  assert.equal(app.el("source").focused, true);
});

test("search navigation preserves unsaved source edits when switching is declined", async () => {
  const folder = directory("research", [
    ["a.flow", file("a.flow", "needle")],
    ["b.flow", file("b.flow", "needle")]
  ]);
  const app = workspace(folder);
  await app.el("folder").fire("click");
  await app.el("projectTree").children[1].fire("click");
  app.el("source").value = "unsaved changes";
  app.el("source").fire("input");
  app.el("projectSearch").value = "needle";
  await app.el("searchProject").fire("click");
  app.setDiscard(false);
  await app.el("searchResults").children[2].fire("click");
  assert.equal(app.el("source").value, "unsaved changes");
  assert.equal(app.el("dirty").hidden, false);
});

test("search does not send local project contents to execution API", async () => {
  const folder = directory("research", [
    ["secret.flow", file("secret.flow", "private searchable content")]
  ]);
  const app = workspace(folder);
  await app.el("folder").fire("click");
  app.el("projectSearch").value = "private";
  await app.el("searchProject").fire("click");
  assert.equal(app.fetches.length, 0);
  assert.equal(app.el("searchResults").children.length, 2);
});


test("in-buffer find navigates matches with wrapping and case option", () => {
  const app = workspace(directory("empty"));
  app.el("source").value = "cat Cat cat";
  app.el("editorFind").value = "cat";
  app.el("editorFind").fire("input");
  assert.equal(app.el("editorFindCount").textContent, "3 matches");
  app.el("findNext").fire("click");
  assert.equal(app.el("source").selectionStart, 0);
  app.el("findNext").fire("click");
  assert.equal(app.el("source").selectionStart, 4);
  app.el("findPrevious").fire("click");
  assert.equal(app.el("source").selectionStart, 0);
  app.el("editorCaseSensitive").checked = true;
  app.el("editorCaseSensitive").fire("change");
  assert.equal(app.el("editorFindCount").textContent, "2 matches");
  assert.equal(app.fetches.length, 0);
});

test("replace current and replace all edit buffer without saving or executing", () => {
  const app = workspace(directory("empty"));
  app.el("source").value = "cat cat Cat";
  app.el("editorFind").value = "cat";
  app.el("editorReplace").value = "$&";
  app.el("findNext").fire("click");
  app.el("replaceOne").fire("click");
  assert.equal(app.el("source").value, "$& cat Cat");
  assert.equal(app.el("dirty").hidden, false);
  app.el("editorReplace").value = "dog";
  app.el("replaceAll").fire("click");
  assert.equal(app.el("source").value, "$& dog dog");
  assert.equal(app.el("editorFindCount").textContent, "0 matches");
  assert.equal(app.fetches.length, 0);
});

test("replace-all limit prevents partial source mutation", () => {
  const app = workspace(directory("empty"));
  app.el("source").value = "x".repeat(10001);
  app.el("editorFind").value = "x";
  app.el("editorReplace").value = "y";
  app.el("replaceAll").fire("click");
  assert.equal(app.el("source").value, "x".repeat(10001));
  assert.match(app.el("resultStatus").textContent, /10,000 matches/);
  assert.equal(app.fetches.length, 0);
});

test("Ctrl+F populates selected text and focuses editor find", () => {
  const app = workspace(directory("empty"));
  app.el("source").value = "alpha beta";
  app.el("source").setSelectionRange(6, 10);
  let prevented = false;
  app.document.listeners.keydown({
    ctrlKey: true, metaKey: false, key: "f",
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(app.el("editorFind").value, "beta");
  assert.equal(app.el("editorFind").focused, true);
});

test("Run cell sends only the active percent cell through execution API", async () => {
  const app = workspace(directory("empty"));
  app.el("language").value = "python";
  const source = "# %% first\nprint('one')\n# %% second\nprint('two')\n";
  app.el("source").value = source;
  app.el("source").setSelectionRange(source.indexOf("two"), source.indexOf("two"));
  await app.el("runCell").fire("click");
  assert.equal(app.fetches.length, 1);
  assert.equal(app.fetches[0].url, "/api/run/python");
  assert.equal(app.fetches[0].options.body, "print('two')\n");
  assert.match(app.el("console").textContent, /\[cell 2\/2\]/);
});
test("Markdown and empty cells never execute", async () => {
  const app = workspace(directory("empty"));
  app.el("source").value = "# %% [markdown]\n# Title\n# %%\n";
  app.el("source").setSelectionRange(5, 5);
  await app.el("runCell").fire("click");
  assert.equal(app.fetches.length, 0);
  assert.match(app.el("resultStatus").textContent, /Markdown/);
  app.el("source").setSelectionRange(app.el("source").value.length, app.el("source").value.length);
  await app.el("runCell").fire("click");
  assert.equal(app.fetches.length, 0);
  assert.match(app.el("resultStatus").textContent, /empty/);
});
test("Cell execution rejects UTF-8 bodies over native HTTP limit", async () => {
  const app = workspace(directory("empty"));
  app.el("source").value = "# %%\n" + "λ".repeat(70000);
  await app.el("runCell").fire("click");
  assert.equal(app.fetches.length, 0);
  assert.match(app.el("resultStatus").textContent, /128 KiB/);
});
test("Ctrl+Shift+Enter executes cell instead of selected text", async () => {
  const app = workspace(directory("empty"));
  app.el("language").value = "r";
  const source = "# %%\nx <- 1\n# %%\ny <- 2\n";
  app.el("source").value = source;
  app.el("source").setSelectionRange(source.indexOf("y <-"), source.indexOf("y <-") + 1);
  let prevented = false;
  app.document.listeners.keydown({
    ctrlKey: true, metaKey: false, shiftKey: true, key: "Enter",
    preventDefault() { prevented = true; }
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(prevented, true);
  assert.equal(app.fetches.length, 1);
  assert.equal(app.fetches[0].options.body, "y <- 2\n");
});

test("native Python reset is gated by language and uses the intent-protected route", async () => {
  const app = workspace(directory("empty"));
  await app.el("resetPython").fire("click");
  assert.equal(app.fetches.length, 0);
  assert.match(app.el("resultStatus").textContent, /Select Python/);
  app.el("language").value = "python";
  await app.el("resetPython").fire("click");
  assert.equal(app.fetches.length, 1);
  assert.equal(app.fetches[0].url, "/api/reset/python");
  assert.equal(app.fetches[0].options.method, "POST");
  assert.equal(app.fetches[0].options.headers["X-FlowStudio-Intent"], "run");
  assert.equal(app.fetches[0].options.body, "");
  assert.match(app.el("resultStatus").textContent, /session reset/);
});
