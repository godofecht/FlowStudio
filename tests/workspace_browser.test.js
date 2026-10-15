"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const projectSource = fs.readFileSync(path.join(root, "web/project.js"), "utf8").trimEnd();
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);

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
    this.open = false;
    this.scrollTop = 0;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  fire(event, payload = {}) { return this.listeners[event]?.(payload); }
  click() { return this.fire("click"); }
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
    "cursor", "run", "open", "save", "clear", "fallbackOpen", "runtimeInfo",
    "projectTree", "folder", "newFile", "refreshProject"
  ];
  for (const id of ids) elements.set(id, new Element());
  elements.get("source").value = "initial";
  elements.get("language").value = "flow";
  elements.get("console").textContent = "Ready";
  let allowDiscard = true;
  let nextFilename = "created.flow";
  const fetches = [];
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
      fetches.push({ url, options });
      return { ok: true, status: 200, text: async () => "ran" };
    },
    Blob, URL, setTimeout, console
  });
  assert.equal(scripts.length, 2, "Expected embedded project module and workspace script");
  vm.runInContext(scripts[0], context, { filename: "project-embedded.js" });
  vm.runInContext(scripts[1], context, { filename: "workspace.js" });
  return {
    el: id => elements.get(id), document, fetches,
    setDiscard: value => { allowDiscard = value; },
    setNewFilename: value => { nextFilename = value; }
  };
}

test("embedded project module exactly mirrors tested standalone source", () => {
  assert.equal(scripts[0].trim(), projectSource);
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

test("new-file action rejects unsupported filenames without creating files", async () => {
  const folder = directory("work");
  const app = workspace(folder);
  await app.el("folder").fire("click");
  app.setNewFilename("../bad.flow");
  await app.el("newFile").fire("click");
  assert.match(app.el("resultStatus").textContent, /Invalid/);
  assert.equal(app.el("projectTree").children.length, 1);
});
