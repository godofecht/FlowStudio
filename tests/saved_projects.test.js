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

test("UTF-8 byte ceilings, exact boundaries and malformed Unicode fail closed", () => {
  const source = text => project("unicode", [{ name: "λ.flow", language: "flow", text }]);
  assert.equal(storeModule.validProject(source("é".repeat(32768))), true,
    "exactly 65,536 UTF-8 bytes is allowed");
  assert.equal(storeModule.validProject(source("é".repeat(32769))), false,
    "UTF-16 code-unit count must not bypass the byte ceiling");
  assert.equal(storeModule.validProject(source("🧪".repeat(16385))), false,
    "four-byte Unicode must obey the same bound");
  assert.equal(storeModule.validProject(source("a\ud800b")), false,
    "unpaired surrogates must not be silently replaced");
  for (const name of ["..", ".", "bad\n.py", "bad\u0000.py", "bad\udc00.py"]) {
    assert.equal(storeModule.validProject(project("bad-name", [
      { name, language: "python", text: "pass" }
    ])), false, name);
  }
  assert.equal(storeModule.validProject(project("duplicates", [
    { name: "same.py", language: "python", text: "a" },
    { name: "same.py", language: "python", text: "b" }
  ])), false, "duplicate source paths cannot overwrite each other on restore");
});

test("saved project snapshots cannot be mutated through inputs or returned files", () => {
  const storage = memoryStorage();
  const store = storeModule.createStore(storage);
  const original = project("immutable", [
    { name: "simulation.flow", language: "flow", text: "print(42)" },
    { name: "analysis.R", language: "r", text: "mean(c(1,2,3))" },
    { name: "plot.py", language: "python", text: "print('π')" }
  ]);
  const returned = store.upsert(original);
  original.files[0].text = "corrupted input";
  returned.files[1].text = "corrupted return";
  const listed = store.list();
  listed[0].files[2].text = "corrupted list";
  const found = store.find("immutable");
  found.files[0].name = "../bad.flow";
  found.files.pop();
  assert.deepEqual(store.find("immutable").files.map(f => f.text),
    ["print(42)", "mean(c(1,2,3))", "print('π')"]);
  assert.equal(storeModule.createStore(storage).find("immutable").files.length, 3);
});

test("large deterministic polyglot projects round-trip without Unicode truncation", () => {
  const storage = memoryStorage();
  const store = storeModule.createStore(storage);
  const files = Array.from({ length: 12 }, (_, index) => ({
    name: "module" + index + (index % 3 === 0 ? ".flow" : index % 3 === 1 ? ".R" : ".py"),
    language: index % 3 === 0 ? "flow" : index % 3 === 1 ? "r" : "python",
    text: ("λ" + index + " 🧪\\n").repeat(4000)
  }));
  const saved = project("large-reproducible", files);
  assert.equal(storeModule.validProject(saved), true);
  assert.ok(store.upsert(saved));
  const restored = storeModule.createStore(storage).find(saved.id);
  assert.deepEqual(restored.files, files);
  assert.ok(new TextEncoder().encode(JSON.stringify(restored)).byteLength < storeModule.MAX_TOTAL_BYTES);
  const invalid = project("invalid", [{ name: "bad.py", language: "python",
    text: "🧪".repeat(16385) }]);
  assert.equal(store.upsert(invalid), null);
  assert.equal(storeModule.createStore(storage).find("invalid"), null);
  assert.deepEqual(storeModule.createStore(storage).find(saved.id).files, files);
});

test("corrupt or duplicate saved file entries are excluded on reload", () => {
  const storage = memoryStorage();
  const good = project("good");
  const bad = project("bad", [
    { name: "same.py", language: "python", text: "1" },
    { name: "same.py", language: "python", text: "2" }
  ]);
  storage.setItem(storeModule.KEY, JSON.stringify([bad, good]));
  const store = storeModule.createStore(storage);
  assert.deepEqual(store.list().map(p => p.id), ["good"]);
  assert.equal(store.find("bad"), null);
});
