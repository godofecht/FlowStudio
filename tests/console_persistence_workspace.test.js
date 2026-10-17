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
  const elements = new Map(), storage = memoryStorage();
  const panel = {style:{}, append(...nodes) { for (const node of nodes) register(node); }};
  function register(node) {
    if (node.id) elements.set(node.id, node);
    for (const child of node.children || []) register(child);
  }
  function element(id = "") {
    return {id, value:"", textContent:"", style:{}, dataset:{}, children:[],
      listeners:{}, disabled:false, selectionStart:0, selectionEnd:0,
      addEventListener(name,fn){this.listeners[name]=fn;},
      setAttribute(name,value){this[name]=value;},
      setSelectionRange(){},
      append(...nodes){this.children.push(...nodes); for(const node of nodes) register(node);},
      fire(name){this.listeners[name]?.();}};
  }
  for (const id of ["console","language","resultStatus","run","runCell"])
    elements.set(id, element(id));
  elements.get("console").parentElement = panel;
  elements.get("language").value = "python";
  const doc = {getElementById:id=>elements.get(id) || null, createElement:()=>element()};
  const context = vm.createContext({TextEncoder, localStorage:storage, console});
  const root = path.join(__dirname,"..","web");
  vm.runInContext(fs.readFileSync(path.join(root,"console.js"),"utf8"),context);
  vm.runInContext(fs.readFileSync(path.join(root,"workspace_console.js"),"utf8"),context);
  const c = context.FlowStudioWorkspaceConsole.mount(doc,async()=>({ok:true,status:200,text:async()=>"ok"}));
  assert.equal(elements.get("consoleRememberHistory").checked,false);
  elements.get("consoleRememberHistory").checked = true;
  elements.get("consoleRememberHistory").fire("change");
  assert.equal(c.isPersisting(),true);
  elements.get("consoleInput").value = "print(1)";
  await c.run(elements.get("consoleInput"));
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_PREFIX+"python")),["print(1)"]);
  elements.get("consoleClearHistory").fire("click");
  assert.deepEqual(Array.from(c.history("python")),[]);
  elements.get("consoleRememberHistory").checked = false;
  elements.get("consoleRememberHistory").fire("change");
  assert.equal(storage.values.size,0);
});
