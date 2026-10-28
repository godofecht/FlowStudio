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
const { FakeElement, createDocument } = require("./terminal_dom.js");
function field(value) {
  return {value, selectionStart: 0, setSelectionRange() {}};
}
test("stored history is bounded in count and bytes, newest commands survive", async () => {
  const storage = memoryStorage();
  const c = create(async () => true, () => "python", () => {}, {storage});
  c.setPersistence(true);
  for (let i = 0; i < MAX_HISTORY + 8; i++) {
    assert.equal(await c.run(field("x = " + i + " # " + "λ".repeat(1600))), true);
  }
  const raw = storage.getItem(STORAGE_PREFIX + "python");
  assert.ok(Buffer.byteLength(raw) <= MAX_STORED_BYTES);
  const restored = create(async () => true, () => "python", () => {}, {storage});
  assert.ok(restored.history("python").length < MAX_HISTORY);
  assert.match(restored.history("python").at(-1), /x = 107/);
});
test("network rejection is not saved to device history", async () => {
  const storage = memoryStorage();
  const c = create(async () => false, () => "r", () => {}, {storage});
  c.setPersistence(true);
  assert.equal(await c.run(field("stop('failed')")), false);
  assert.deepEqual(c.history("r"), []);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_PREFIX + "r")), []);
});
test("workspace mounts opt-in checkbox and clear-history controls", async () => {
  const storage = memoryStorage();
  const { doc, elements } = createDocument();
  const panel = new FakeElement("div");
  for (const id of ["console", "language", "resultStatus", "run", "runCell"]) {
    const node = new FakeElement("span");
    node.attributes.id = id;
    elements.set(id, node);
  }
  elements.get("language").value = "python";
  elements.get("console").parentElement = panel;
  const root = path.join(__dirname, "..", "web");
  const context = vm.createContext({ TextEncoder, localStorage: storage, console });
  for (const file of ["terminal_render", "terminal_sessions", "terminal_input",
    "console", "workspace_console"])
    vm.runInContext(fs.readFileSync(path.join(root, file + ".js"), "utf8"), context);
  const c = context.FlowStudioWorkspaceConsole.mount(doc, async () =>
    ({ ok: true, status: 200, text: async () => "ok" }));
  const find = node => {
    for (const child of node.children) {
      if (child.attributes.id === "consoleRememberHistory") return child;
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  const remember = find(panel);
  assert.ok(remember, "the menu carries the opt-in persistence control");
  const box = remember.children[0];
  assert.equal(box.checked, false);
  box.checked = true;
  box.fire("change");
  assert.equal(c.isPersisting(), true);
  const inputFind = node => {
    for (const child of node.children) {
      if (child.attributes.id === "consoleInput") return child;
      const hit = inputFind(child);
      if (hit) return hit;
    }
    return null;
  };
  const input = inputFind(panel);
  input.value = "print(1)";
  await c.run(input);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_PREFIX + "python")), ["print(1)"]);
  const clear = (() => {
    const walk = node => {
      for (const child of node.children) {
        if (child.attributes.id === "consoleClearHistory") return child;
        const hit = walk(child);
        if (hit) return hit;
      }
      return null;
    };
    return walk(panel);
  })();
  clear.fire("click");
  assert.deepEqual(Array.from(c.history("python")), []);
  box.checked = false;
  box.fire("change");
  assert.equal(storage.values.size, 0);
});
