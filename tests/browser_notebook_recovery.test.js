"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const recovery = require("../docs/app/notebook_recovery.js");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");

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
  assert.equal(recovery.save(store, "source", "flow", [entry(0)]), true);
  assert.deepEqual(recovery.read(store, "source", "flow"), [entry(0)]);
  assert.equal(recovery.save(store, "source", "python", [entry(0)]), true);
  const record = JSON.parse(store.raw());
  record.entries[0].output = "x".repeat(131073);
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

test("Jupyter streams, traceback and PNG survive browser recovery and nbformat export", () => {
  const png = "iVBORw0KGgoAAA==";
  const notebook = {nbformat:4, nbformat_minor:4,
    metadata:{language_info:{name:"python"}}, cells:[{cell_type:"code", metadata:{},
      source:"raise ValueError('bad')", execution_count:12, outputs:[
        {output_type:"stream", name:"stdout", text:"before\\n"},
        {output_type:"stream", name:"stderr", text:"warning\\n"},
        {output_type:"display_data", data:{"text/plain":"figure", "image/png":png}},
        {output_type:"error", ename:"ValueError", evalue:"bad",
          traceback:["Traceback", "ValueError: bad"]}
      ]}]};
  const imported = format.decode(JSON.stringify(notebook));
  const store = storage();
  assert.equal(recovery.save(store, imported.source, imported.language, imported.entries), true);
  const restored = recovery.read(store, imported.source, imported.language);
  assert.equal(restored[0].jupyterOutputs.length, 4);
  const exported = JSON.parse(format.encode(imported.source, imported.language, restored, parseCells));
  assert.equal(exported.cells[0].execution_count, null);
  assert.deepEqual(exported.cells[0].outputs, [
    notebook.cells[0].outputs[0], notebook.cells[0].outputs[1],
    {output_type:"display_data", metadata:{},
      data:{"text/plain":"figure", "image/png":png}},
    notebook.cells[0].outputs[3]
  ]);
  assert.equal(recovery.read(store, imported.source + " ", imported.language), null);
});
test("recovery rejects mismatched, unsupported and noncanonical Jupyter records", () => {
  const store = storage();
  const valid = {...entry(0,"safe"),
    jupyterOutputs:[{output_type:"stream", name:"stdout", text:"safe"}]};
  assert.equal(recovery.save(store,"x","python",[valid]),true);
  assert.deepEqual(recovery.read(store,"x","python")[0].jupyterOutputs,valid.jupyterOutputs);
  assert.equal(recovery.save(store,"x","python",[
    {...valid, jupyterOutputs:[{output_type:"stream",name:"stdout",text:"changed"}]}]),false);
  assert.equal(recovery.save(store,"x","python",[
    {...valid, jupyterOutputs:[{output_type:"stream",name:"stdout",text:"safe",metadata:{}}]}]),false);
  assert.equal(recovery.save(store,"x","python",[
    {...valid, jupyterOutputs:[{output_type:"display_data",
      data:{"text/plain":"safe", "text/html":"<script>unsafe</script>"}}]}]),false);
  assert.deepEqual(recovery.read(store,"x","python")[0].jupyterOutputs,valid.jupyterOutputs);
  const tampered = JSON.parse(store.raw());
  tampered.entries[0].jupyterOutputs[0].text = "changed";
  store.setItem(recovery.KEY,JSON.stringify(tampered));
  assert.equal(recovery.read(store,"x","python"),null);
});
