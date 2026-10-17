"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createHistory, validate} = require("../web/plot_history.js");
function fixture(limit = 3) {
  const released = [], created = [];
  const urls = {createObjectURL(file) {const u = "blob:" + file.name + ":" + created.length; created.push(u); return u;}, revokeObjectURL(url) {released.push(url);}};
  return {history: createHistory(urls, limit), created, released};
}
const png = (name, size = 100) => ({name, size, type:"image/png"});
test("accepts PNG and rejects oversized, empty, or wrong formats", () => {
  assert.equal(validate(png("a.png")), true);
  for (const f of [png("a.png",0), png("a.png", 17*1024*1024), {name:"x.svg",size:10,type:"image/svg+xml"}, {name:"x.png",size:10,type:"text/html"}]) assert.throws(() => validate(f));
});
test("selects and retains a bounded history, revoking evicted object URLs", () => {
  const f=fixture(2);const a=f.history.add(png("a.png"));const b=f.history.add(png("b.png"));
  assert.equal(f.history.current().id,b.id);
  const c=f.history.add(png("c.png"));
  assert.deepEqual(f.history.entries().map(x=>x.name),["b.png","c.png"]);
  assert.deepEqual(f.released,[a.url]);
  assert.equal(f.history.select(b.id),true);assert.equal(f.history.current().id,b.id);
  assert.equal(f.history.select(a.id),false);
  assert.equal(f.history.remove(b.id),true);assert.equal(f.history.current().id,c.id);
  assert.deepEqual(f.released,[a.url,b.url]);
});
test("clears all object URLs and leaves no active plot", () => {
  const f=fixture();f.history.add(png("a.png"));f.history.add(png("b.png"));
  f.history.clear();assert.equal(f.history.current(),null);assert.equal(f.history.entries().length,0);
  assert.deepEqual(f.released,f.created);
});
test("failed imports never allocate an object URL", () => {
  const f=fixture();assert.throws(()=>f.history.add({name:"bad.txt",size:50,type:"text/plain"}));assert.equal(f.created.length,0);
});
test("history snapshots are immutable externally", () => {
  const f=fixture();f.history.add(png("a.png"));const entries=f.history.entries();entries.pop();
  assert.equal(f.history.entries().length,1);assert.equal(Object.isFrozen(f.history.current()),true);
});

test("evicts oldest plots before exceeding 64 MiB aggregate history", () => {
  const f=fixture(60);
  for(let i=0;i<5;i++) f.history.add(png("p"+i+".png", 16*1024*1024));
  assert.equal(f.history.entries().length,4);
  assert.equal(f.released.length,1);
  assert.equal(f.history.current().name,"p4.png");
});
