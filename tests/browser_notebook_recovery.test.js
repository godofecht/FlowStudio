"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const recovery = require("../docs/app/notebook_recovery.js");

function storage() {
  const values = new Map();
  return {
    getItem:key=>values.get(key) ?? null,
    setItem:(key,value)=>{ values.set(key,value); },
    removeItem:key=>{ values.delete(key); },
    raw:()=>values.get(recovery.KEY)
  };
}
function entry(index, output = "42") {
  return {index,kind:"code",ok:true,output,truncated:false,plots:[]};
}
test("completed cell outputs survive reload only for exact source and language", () => {
  const store = storage();
  const source = "# %%\nx = 42\nx";
  assert.equal(recovery.save(store, source, "python", [entry(0)]), true);
  assert.deepEqual(recovery.read(store, source, "python"), [entry(0)]);
  assert.equal(recovery.read(store, source + " ", "python"), null);
  assert.equal(recovery.read(store, source, "r"), null);
  assert.equal(recovery.clear(store), true);
  assert.equal(recovery.read(store, source, "python"), null);
});
test("partial failed notebook runs retain ordered outputs and truncation", () => {
  const store = storage();
  const results = [entry(0), {...entry(2,"Traceback"),ok:false,truncated:true}];
  assert.equal(recovery.save(store, "# %%\nx\n# %%\n1/0", "python", results), true);
  assert.deepEqual(recovery.read(store, "# %%\nx\n# %%\n1/0", "python"), results);
});
test("rejects malformed, reordered, injected and excessive output", () => {
  const store = storage();
  for (const entries of [
    [entry(1),entry(1)], [entry(2),entry(1)], [{...entry(0),index:-1}],
    [{...entry(0),output:"x".repeat(131073)}],
    [{...entry(0),plots:[{png:"data:image/png;base64,evil"}]}],
    [{...entry(0),plots:[{png:"iVBORw0KGgo<script>"}]}],
    Array.from({length:129},(_,i)=>entry(i))
  ]) assert.equal(recovery.save(store, "source", "r", entries), false);
  assert.equal(recovery.save(store, "x".repeat(131073), "r", [entry(0)]), false);
  assert.equal(recovery.save(store, "source", "flow", [entry(0)]), false);
  assert.equal(recovery.save(store, "source", "python", [entry(0)]), true);
  const record = JSON.parse(store.raw());
  record.entries[0].output = "<img src=x onerror=alert(1)>";
  store.setItem(recovery.KEY, JSON.stringify(record));
  assert.equal(recovery.read(store, "source", "python"), null);
});
test("persists bounded PNG plot data but rejects over-budget records", () => {
  const store = storage();
  const withPlot = {...entry(0),plots:[{number:1,png:"iVBORw0KGgo" + "A".repeat(100)}]};
  assert.equal(recovery.save(store,"x","python",[withPlot]),true);
  assert.equal(recovery.read(store,"x","python")[0].plots[0].png,withPlot.plots[0].png);
  assert.equal(recovery.save(store,"x","python",
    Array.from({length:5},(_,i)=>({...entry(i),plots:[{png:"iVBORw0KGgo"+"A".repeat(300000)}]}))),false);
});
test("storage failure does not claim persistence", () => {
  const store = {getItem(){throw Error("denied");},setItem(){throw Error("quota");},removeItem(){throw Error("denied");}};
  assert.equal(recovery.save(store,"x","python",[entry(0)]),false);
  assert.equal(recovery.read(store,"x","python"),null);
  assert.equal(recovery.clear(store),false);
});
test("browser workspace wires incremental save, exact-match recovery and reset", () => {
  const html = fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/src="\.\/notebook_recovery\.js"/);
  assert.match(html,/FlowStudioNotebookRecovery\.save\(/);
  assert.match(html,/FlowStudioNotebookRecovery\.read\(/);
  assert.match(html,/function restoreNotebookOutputs\(/);
  assert.match(html,/clearNotebookRecovery\(\);/);
  assert.match(html,/Interpreter variables were not restored/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(()=>new vm.Script(inline[1]));
});
