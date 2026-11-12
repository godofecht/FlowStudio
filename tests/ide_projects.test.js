"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const projects = require("../web/ide_projects.js");

/* ---------- a fake private file system (OPFS) ---------- */
class FakeFile {
  constructor(name, text = "") { this.kind = "file"; this.name = name; this.text = text; }
  async createWritable() { const file = this; let next = ""; return { write: async t => { next += t; }, close: async () => { file.text = next; } }; }
  async getFile() { return { text: async () => this.text }; }
}
class FakeDir {
  constructor(name) { this.kind = "directory"; this.name = name; this.entries = new Map(); }
  async getDirectoryHandle(name, opts = {}) {
    if (!this.entries.has(name)) {
      if (!opts.create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      const dir = new FakeDir(name); dir.parent = this; this.entries.set(name, dir);
    }
    return this.entries.get(name);
  }
  async getFileHandle(name, opts = {}) {
    if (!this.entries.has(name)) {
      if (!opts.create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      this.entries.set(name, new FakeFile(name));
    }
    return this.entries.get(name);
  }
  async *values() { yield* this.entries.values(); }
  async resolve(handle) {
    for (let node = handle; node; node = node.parent) if (node === this) return [];
    return null;
  }
}
function fakeStorageManager() { const root = new FakeDir(""); return { root, getDirectory: async () => root }; }

test("slugs and entry guesses", () => {
  assert.equal(projects.slug("  My Flow App! "), "my-flow-app");
  assert.equal(projects.slug("???"), "project");
  assert.equal(projects.guessEntry(["notes.txt", "util.flow", "main.flow"]), "main.flow");
  assert.equal(projects.guessEntry(["notes.txt", "b.py"]), "b.py");
  assert.equal(projects.guessEntry(["notes.txt"]), null);
});

test("local projects get unique folders; examples keep the user's edits", async () => {
  const manager = fakeStorageManager();
  const store = projects.createLocalStore(manager);
  const a = await store.create("demo", [{ name: "main.flow", text: "one" }]);
  const b = await store.create("demo", [{ name: "main.flow", text: "two" }]);
  assert.deepEqual([a.name, b.name], ["demo", "demo-2"]);
  assert.equal(await store.isLocal(a), true);
  assert.equal(await store.isLocal(new FakeDir("elsewhere")), false);
  const example = await store.example("debug-flow", [{ name: "debug_me.flow", text: "original" }]);
  (await example.getFileHandle("debug_me.flow")).text = "edited by the user";
  const again = await store.example("debug-flow", [{ name: "debug_me.flow", text: "original" }, { name: "new.flow", text: "added" }]);
  assert.equal(again, example);
  assert.equal((await again.getFileHandle("debug_me.flow")).text, "edited by the user");
  assert.equal((await again.getFileHandle("new.flow")).text, "added", "files the example gained are added");
});

/* ---------- switching ---------- */
function workspace() {
  const docs = [];
  let seq = 0, active = null;
  const app = {
    closed: [], saved: 0, untitled: 0,
    documents: {
      list: () => docs.slice(), count: () => docs.length,
      active: () => docs.find(d => d.id === active) || null, find: id => docs.find(d => d.id === id) || null
    },
    saveEditorBuffer() {},
    closeAllDocuments() { app.closed.push(...docs.map(d => d.path || d.name)); docs.length = 0; active = null; },
    async saveAllDocuments() { app.saved++; for (const d of docs) d.dirty = false; return []; },
    createUntitled() { app.untitled++; docs.push({ id: "u" + ++seq, name: "untitled.flow", language: "flow" }); },
    async openEditorHandle(handle, path) {
      docs.push({ id: "d" + ++seq, name: handle.name, path, handle, language: handle.name.endsWith(".py") ? "python" : "flow", dirty: false });
      active = "d" + seq; return true;
    },
    activateDocument(id) { active = id; return true; },
    status() {}
  };
  return { app, docs };
}

test("opening a project closes the previous tabs and opens the new files in order", async () => {
  const manager = fakeStorageManager();
  const local = projects.createLocalStore(manager);
  const { app, docs } = workspace();
  docs.push({ id: "old1", name: "app.flow", path: "walk/app.flow", dirty: false }, { id: "old2", name: "untitled.flow", dirty: false });
  let explorerRoot = null;
  const service = projects.mount({ getElementById: () => null }, { app, localStore: local, storage: null,
    explorer: { setRoot: async handle => { explorerRoot = handle; await service.rootChanged(handle, async () => 0); return true; },
      hasRoot: () => Boolean(explorerRoot), recents: () => [] } });
  const files = [{ name: "1_simulate.flow", language: "flow", text: "a" }, { name: "2_wrangle.py", language: "python", text: "b" }];
  assert.equal(await service.openExample({ id: "pipeline", title: "Pipeline", files, runProject: true }), true);
  assert.deepEqual(app.closed, ["walk/app.flow", "untitled.flow"], "every old tab closed");
  assert.deepEqual(docs.map(d => d.path), ["pipeline/1_simulate.flow", "pipeline/2_wrangle.py"]);
  assert.equal(service.current().name, "pipeline");
  assert.equal(service.current().local, true);
  const plan = service.runPlan();
  assert.deepEqual(plan.steps.map(step => [step.name, step.language]), [["1_simulate.flow", "flow"], ["2_wrangle.py", "python"]]);
});

test("unsaved files are saved or the switch is cancelled", async () => {
  const { app, docs } = workspace();
  docs.push({ id: "a", name: "main.flow", path: "p/main.flow", dirty: true, handle: { createWritable() {} } });
  const service = projects.mount({ getElementById: () => null }, { app, localStore: projects.createLocalStore(fakeStorageManager()), storage: null });
  const previous = globalThis.confirm;
  try {
    globalThis.confirm = () => false;
    assert.equal(await service.beforeSwitch(), false, "cancel keeps the project");
    assert.equal(app.saved, 0);
    globalThis.confirm = () => true;
    assert.equal(await service.beforeSwitch(), true);
    assert.equal(app.saved, 1, "the first choice saves before switching");
  } finally {
    if (previous === undefined) delete globalThis.confirm; else globalThis.confirm = previous;
  }
});

test("closing the project leaves one untitled buffer", async () => {
  const { app, docs } = workspace();
  docs.push({ id: "a", name: "main.flow", path: "p/main.flow", dirty: false });
  const service = projects.mount({ getElementById: () => null }, { app, localStore: projects.createLocalStore(fakeStorageManager()), storage: null });
  await service.rootChanged(null);
  assert.deepEqual(docs.map(d => d.name), ["untitled.flow"]);
  assert.equal(service.current(), null);
});
