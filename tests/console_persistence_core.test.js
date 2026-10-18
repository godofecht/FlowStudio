"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {create, STORAGE_PREFIX, STORAGE_ENABLED, MAX_HISTORY, MAX_STORED_BYTES} =
  require("../web/console.js");
function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    values
  };
}
function field(value) {
  return {value, selectionStart: 0, setSelectionRange() {}};
}
test("command history remains ephemeral until explicit opt-in", async () => {
  const storage = memoryStorage();
  const controller = create(async () => true, () => "python", () => {}, {storage});
  assert.equal(await controller.run(field("secret = 123")), true);
  assert.equal(controller.isPersisting(), false);
  assert.equal(storage.values.size, 0);
  const reloaded = create(async () => true, () => "python", () => {}, {storage});
  assert.deepEqual(reloaded.history("python"), []);
});
test("opt-in restores independent Flow, R and Python histories across reloads", async () => {
  const storage = memoryStorage();
  let lang = "flow";
  const c = create(async () => true, () => lang, () => {}, {storage});
  assert.equal(c.setPersistence(true), true);
  for (const [runtime, code] of [["flow", "println(2)"], ["r", "x <- 42"],
    ["python", "print('λ')\n"]]) {
    lang = runtime;
    await c.run(field(code));
  }
  assert.equal(storage.getItem(STORAGE_ENABLED), "1");
  const restored = create(async () => true, () => lang, () => {}, {storage});
  assert.deepEqual(restored.history("flow"), ["println(2)"]);
  assert.deepEqual(restored.history("r"), ["x <- 42"]);
  assert.deepEqual(restored.history("python"), ["print('λ')\n"]);
  const entry = field("unsent draft");
  assert.equal(restored.navigate(entry, -1), true);
  assert.equal(entry.value, "print('λ')\n");
  assert.equal(restored.navigate(entry, 1), true);
  assert.equal(entry.value, "unsent draft");
});
test("disabling persistence deletes stored commands without deleting live history", async () => {
  const storage = memoryStorage();
  const c = create(async () => true, () => "r", () => {}, {storage});
  c.setPersistence(true);
  await c.run(field("password <- 'private'"));
  assert.equal(c.setPersistence(false), true);
  assert.equal(storage.values.size, 0);
  assert.deepEqual(c.history("r"), ["password <- 'private'"]);
  assert.deepEqual(create(async () => true, () => "r", () => {}, {storage}).history("r"), []);
});
test("clear selected language preserves other languages and persisted consent", async () => {
  const storage = memoryStorage();
  let lang = "flow";
  const c = create(async () => true, () => lang, () => {}, {storage});
  c.setPersistence(true);
  await c.run(field("let x = 1"));
  lang = "python";
  await c.run(field("x = 1"));
  assert.equal(c.clearHistory("python"), true);
  assert.deepEqual(c.history("python"), []);
  assert.deepEqual(c.history("flow"), ["let x = 1"]);
  assert.equal(storage.getItem(STORAGE_ENABLED), "1");
  assert.equal(storage.getItem(STORAGE_PREFIX + "python"), null);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_PREFIX + "flow")), ["let x = 1"]);
});
test("malformed, oversized and invalid stored history is discarded", () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_ENABLED, "1");
  storage.setItem(STORAGE_PREFIX + "flow", "not JSON");
  storage.setItem(STORAGE_PREFIX + "r", JSON.stringify([42]));
  storage.setItem(STORAGE_PREFIX + "python", "x".repeat(MAX_STORED_BYTES + 1));
  const c = create(async () => true, () => "flow", () => {}, {storage});
  for (const lang of ["flow", "r", "python"]) {
    assert.deepEqual(c.history(lang), []);
    assert.equal(storage.getItem(STORAGE_PREFIX + lang), null);
  }
});
test("quota failures cannot block execution and do not claim persistence enabled", async () => {
  const errors = [];
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("quota exceeded"); };
  const c = create(async () => true, () => "python", e => errors.push(e), {storage});
  assert.equal(c.setPersistence(true), false);
  assert.equal(c.isPersisting(), false);
  assert.match(errors.join(" "), /quota exceeded/);
  assert.equal(await c.run(field("print(1)")), true);
  assert.deepEqual(c.history("python"), ["print(1)"]);
});
