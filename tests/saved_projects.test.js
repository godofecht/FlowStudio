"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const storeModule = require(path.join(__dirname, "..", "web", "saved_projects.js"));

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    values
  };
}
function project(id, files = [{ name: "generate.py", language: "python", text: "print(1)\n" }]) {
  return { id, title: "Project " + id, savedAt: Date.now(), files };
}

test("projects open as saved project files with validated shapes", () => {
  assert.equal(storeModule.validProject(project("a")), true);
  assert.equal(storeModule.validProject({ id: "", title: "x", savedAt: 1, files: [] }), false);
  assert.equal(storeModule.validProject(project("b", "not-files")), false);
  assert.equal(storeModule.validProject(project("c", [
    { name: "bad/name.py", language: "python", text: "x" }
  ])), false, "path separators are rejected");
  assert.equal(storeModule.validProject({
    id: "d", title: "d", savedAt: 1,
    files: [{ name: "a.py", language: "lua", text: "x" }]
  }), false, "unsupported languages are rejected");
  const big = "x".repeat(storeModule.MAX_FILE_TEXT + 1);
  assert.equal(storeModule.validProject({
    id: "e", title: "e", savedAt: 1,
    files: [{ name: "a.py", language: "python", text: big }]
  }), false, "oversized file text is rejected");
});

test("upsert dedupes by project id and persists the newest text", () => {
  const storage = memoryStorage();
  const store = storeModule.createStore(storage);
  store.upsert(project("p1", [{ name: "a.py", language: "python", text: "v1" }]));
  store.upsert(project("p1", [{ name: "a.py", language: "python", text: "v2 edited" }]));
  store.upsert(project("p2"));
  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "p2", "most recent save is first");
  assert.equal(storage.values.size, 1, "one storage key");
  const reopened = storeModule.createStore(storage);
  const saved = reopened.find("p1");
  assert.equal(saved.files[0].text, "v2 edited", "edits survive a reload");
});

test("the project list is bounded and remove forgets cleanly", () => {
  const storage = memoryStorage();
  const store = storeModule.createStore(storage);
  for (let i = 0; i < storeModule.MAX_PROJECTS + 5; i++) store.upsert(project("p" + i));
  assert.equal(store.list().length, storeModule.MAX_PROJECTS);
  assert.equal(store.find("p0"), null, "oldest overflow project is dropped");
  assert.equal(store.remove("p" + storeModule.MAX_PROJECTS), true);
  assert.equal(store.remove("missing"), false);
  assert.equal(store.find("" + storeModule.MAX_PROJECTS), null);
});

test("without storage the store still works in memory and never throws", () => {
  const store = storeModule.createStore(null);
  store.upsert(project("n1"));
  assert.equal(store.list().length, 1);
  assert.equal(store.remove("n1"), true);
});

test("corrupt storage is discarded instead of breaking load", () => {
  const storage = memoryStorage();
  storage.setItem(storeModule.KEY, "{not json");
  const store = storeModule.createStore(storage);
  assert.equal(store.list().length, 0);
  assert.equal(storage.getItem(storeModule.KEY), null, "corrupt entry removed");
});
