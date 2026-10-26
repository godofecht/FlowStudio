"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const fmt=require("../docs/app/notebook_format.js");
const {parseCells}=require("../docs/app/source_cells.js");
const ipynb=cells=>JSON.stringify({nbformat:4,nbformat_minor:5,metadata:{language_info:{name:"python"}},cells});
const code=(source,id,tags=[])=>({cell_type:"code",id,metadata:{tags},source,outputs:[]});
const round=source=>JSON.parse(fmt.encode(source,"python",[],parseCells));
test("Jupyter 4.5 IDs and tags survive Markdown and code roundtrip",()=>{
  const imported=fmt.decode(ipynb([{cell_type:"markdown",id:"intro-1",metadata:{tags:["hide-input","π"]},source:"# Intro\n"},
    code("print(42)","run_2",["parameters","tag with spaces"])]));
  const exported=round(imported.source);
  assert.equal(imported.ignoredMetadata,false);
  assert.equal(exported.nbformat_minor,5);
  assert.deepEqual(exported.cells.map(c=>c.id),["intro-1","run_2"]);
  assert.deepEqual(exported.cells.map(c=>c.metadata.tags),[["hide-input","π"],["parameters","tag with spaces"]]);
  assert.equal(exported.cells[1].source,"print(42)");
});
test("missing IDs receive deterministic collision-free names",()=>{
  const source=fmt.decode(ipynb([code("a=1","flowstudio-2"),
    {cell_type:"markdown",metadata:{tags:["notes"]},source:"notes"},
    code("print(a)","run-3")])).source;
  const first=round(source), second=round(source);
  assert.deepEqual(first.cells.map(c=>c.id),second.cells.map(c=>c.id));
  assert.equal(first.cells[1].id,"flowstudio-2-1");
  assert.equal(new Set(first.cells.map(c=>c.id)).size,3);
});
test("duplicate IDs reject on import and export",()=>{
  assert.throws(()=>fmt.decode(ipynb([code("a=1","same"),code("b=2","same")])),/Duplicate Jupyter cell ID/);
  const meta=encodeURIComponent(JSON.stringify({id:"same"}));
  assert.throws(()=>round("# %% meta="+meta+"\na=1\n# %% meta="+meta+"\nb=2"),/Duplicate Jupyter cell ID/);
});
test("unsupported metadata is reported and valid tags retained",()=>{
  const imported=fmt.decode(ipynb([{...code("x=1","valid",["safe"]),
    metadata:{tags:["safe"],execution:{iopub:"ignore"},widgets:{unsafe:true}}}]));
  assert.equal(imported.ignoredMetadata,true);
  assert.deepEqual(round(imported.source).cells[0].metadata,{tags:["safe"]});
});
test("malformed metadata markers fail closed",()=>{
  for(const token of ["%XX",encodeURIComponent('{"id":"a","extra":1}'),
    encodeURIComponent('{"id":"bad id"}'),"a".repeat(2049)])
    assert.throws(()=>round("# %% meta="+token+"\nprint(1)"),/Invalid Jupyter cell metadata marker/);
  assert.throws(()=>round("# %% meta=%7B%7D meta=%7B%7D\nx"),/Invalid Jupyter cell metadata marker/);
});
test("invalid imported tags are omitted without changing source",()=>{
  const imported=fmt.decode(ipynb([code("print('safe')","valid",["x".repeat(81)])]));
  assert.equal(imported.ignoredMetadata,true);
  assert.equal(round(imported.source).cells[0].source,"print('safe')");
  assert.deepEqual(round(imported.source).cells[0].metadata,{});
});
test("plain 4.4 export stays backward compatible",()=>{
  const exported=round("# %% [markdown]\n# Title\n# %%\nx=1");
  assert.equal(exported.nbformat_minor,4);
  assert.ok(exported.cells.every(c=>!Object.hasOwn(c,"id")&&!Object.hasOwn(c.metadata,"tags")));
});
