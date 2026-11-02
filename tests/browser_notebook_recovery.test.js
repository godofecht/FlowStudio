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
  const source = "# %%\nx\n# %%\npass\n# %%\n1/0";
  assert.equal(recovery.save(store, source, "python", results), true);
  assert.deepEqual(recovery.read(store, source, "python"), results);
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

test("recovery binds every output to a real executable Flow/R/Python source cell", () => {
  const store = storage();
  const source = [
    "# %% [markdown]\\n# Numerical report\\n",
    "# %% [flow]\\nfunction main() -> i32 { return 7 }\\n",
    "# %% [r]\\nx <- 2; print(x)\\n",
    "# %% [python]\\nprint(3)\\n",
    "# %% [python]\\n   \\n"
  ].join("").replaceAll("\\n", "\n");
  const valid = [
    {...entry(1,"flow-ok"),language:"flow"},
    {...entry(2,"r-ok"),language:"r"},
    {...entry(3,"python-ok"),language:"python"}
  ];
  assert.equal(recovery.save(store, source, "python", valid), true);
  assert.deepEqual(recovery.read(store, source, "python"), valid);
  assert.equal(recovery.save(store, source, "python", [entry(0)]), false,
    "markdown must never receive executable output");
  assert.equal(recovery.save(store, source, "python", [entry(4)]), false,
    "whitespace-only code must never receive output");
  assert.equal(recovery.save(store, source, "python", [entry(5)]), false,
    "missing cell must never receive output");
  assert.equal(recovery.save(store, source, "python", [{...entry(1),language:"r"}]), false,
    "a Flow result must not be relabeled as R");
  assert.equal(recovery.save(store, source, "python", [{...entry(3),language:"flow"}]), false,
    "an untagged Python result must not be relabeled as Flow");
  assert.deepEqual(recovery.read(store, source, "python"), valid);
  const forged = JSON.parse(store.raw());
  forged.entries[0].language = "python";
  store.setItem(recovery.KEY, JSON.stringify(forged));
  assert.equal(recovery.read(store, source, "python"), null);
});

test("late-loaded browser Jupyter validator preserves rich outputs across reload", () => {
  // This is the real index.html load order: recovery precedes notebook_format.
  // Node require() eagerly supplies the format, masking the browser defect.
  const context = vm.createContext({TextEncoder});
  for (const name of ["source_cells.js", "notebook_recovery.js", "notebook_format.js"]) {
    const script = fs.readFileSync(path.join(__dirname, "../docs/app", name), "utf8");
    vm.runInContext(script, context, {filename:name});
  }
  const store = storage();
  const rich = {...entry(0,"before\\nfigure"),language:"python",
    jupyterOutputs:[
      {output_type:"stream",name:"stdout",text:"before\\n"},
      {output_type:"display_data",metadata:{},data:{"text/plain":"figure"}}
    ]};
  const source = "# %% [python]\\nprint('figure')".replaceAll("\\n", "\n");
  assert.equal(context.FlowStudioNotebookRecovery.save(store, source, "python", [rich]), true);
  const restored = context.FlowStudioNotebookRecovery.read(store, source, "python");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].language, "python");
  assert.equal(restored[0].jupyterOutputs.length, 2);
  assert.equal(restored[0].jupyterOutputs[1].data["text/plain"], "figure");
  assert.equal(context.FlowStudioNotebookRecovery.save(store,
    "# %% [flow]\\nfunction main() -> i32 { return 0 }".replaceAll("\\n", "\n"),
    "flow", [{...rich,language:"flow"}]), false,
    "Jupyter records cannot be attached to native Flow cells");
});

test("seeded 64-cell mixed notebook recovery stays bounded and rejects source drift", () => {
  let seed = 20261102;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const langs = ["flow", "r", "python"];
  const parts = [], entries = [];
  for (let index = 0; index < 64; index++) {
    const language = langs[index % langs.length];
    const value = next() % 100000;
    parts.push("# %% [" + language + "]\\n" +
      (language === "r" ? "print(" + value + ")\\n" :
        language === "flow" ? "let value = " + value + "\\n" :
          "print(" + value + ")\\n"));
    entries.push({...entry(index, "λ=" + value),language});
  }
  const source = parts.join("").replaceAll("\\n", "\n");
  const store = storage();
  assert.equal(recovery.save(store, source, "python", entries), true);
  assert.deepEqual(recovery.read(store, source, "python"), entries);
  assert.equal(Buffer.byteLength(store.raw(), "utf8") < 1048576, true);
  assert.equal(recovery.read(store, source.replace("print(", "cat("), "python"), null);
  assert.equal(recovery.read(store, source + "# changed", "python"), null);
});
