"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = fs.readFileSync(path.join(__dirname, "../docs/app/draft_storage.js"), "utf8");
function harness() {
  const items = new Map(), timers = new Map();
  let next = 0;
  const storage = {getItem:key=>items.get(key) ?? null, setItem:(key,value)=>items.set(key,value), removeItem:key=>items.delete(key)};
  const context = {setTimeout:fn=>{timers.set(++next,fn);return next;}, clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(script, context);
  const api = context.FlowStudioDraftStorage;
  return {api, storage, timers, items, runTimers:()=>{for (const fn of [...timers.values()]) fn();timers.clear();}};
}
test("persists and restores UTF-8 source, language and filename", () => {
  const {api,storage} = harness();
  assert.equal(api.save(storage, "λ = '🧠'\n", "analysis.py", "python"), true);
  const saved = api.read(storage);
  assert.equal(saved.source, "λ = '🧠'\n");
  assert.equal(saved.filename, "analysis.py");
  assert.equal(saved.language, "python");
});
test("rejects malformed, oversized and untrusted draft metadata", () => {
  const {api,storage,items} = harness();
  assert.equal(api.save(storage, "x", "../../oops.py", "python"), false);
  assert.equal(api.save(storage, "x", "safe.py", "javascript"), false);
  assert.equal(api.save(storage, "x".repeat(api.MAX_SOURCE+1), "safe.py", "python"), false);
  items.set(api.KEY, '{"version":1,"source":"a","filename":"x","language":"js"}');
  assert.equal(api.read(storage), null);
  items.set(api.KEY, "{");
  assert.equal(api.read(storage), null);
});
test("debounces edits and flushes latest version synchronously", () => {
  const {api,storage,timers,runTimers} = harness();
  const session = api.create(storage, 300);
  session.queue("old", "x.flow", "flow");
  session.queue("new", "x.flow", "flow");
  assert.equal(timers.size, 1);
  runTimers();
  assert.equal(api.read(storage).source, "new");
  session.queue("final", "x.flow", "flow");
  assert.equal(session.flush(), true);
  assert.equal(timers.size, 0);
  assert.equal(api.read(storage).source, "final");
});
test("clear prevents delayed draft resurrection", () => {
  const {api,storage,runTimers} = harness();
  const session = api.create(storage, 300);
  session.queue("old", "x.r", "r");
  assert.equal(session.clear(), true);
  runTimers();
  assert.equal(api.read(storage), null);
});
test("storage permission or quota errors fail without losing editor data", () => {
  const {api} = harness();
  const denied = {getItem:()=>{throw Error("denied");},setItem:()=>{throw Error("quota");},removeItem:()=>{throw Error("denied");}};
  assert.equal(api.read(denied), null);
  assert.equal(api.save(denied,"x","x.py","python"),false);
  assert.equal(api.clear(denied),false);
});
test("integration includes a storage controller and editor change handlers", () => {
  const html = fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html, /<script src="\.\/draft_storage\.js"><\/script>/);
  assert.match(html, /FlowStudioDraftStorage\.create\(draftStorage/);
  assert.match(html, /drafts\.queue\(/);
  assert.match(html, /drafts\.flush\(\)/);
  assert.match(html, /drafts\.read\(\)/);
});
