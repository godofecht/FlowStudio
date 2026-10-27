"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");

const source = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const numeric = {kind:"table",columns:[
  {name:"first",type:"number",values:[1.5,null,3]},
  {name:"second",type:"number",values:[4,5,null]}
]};
const logical = {kind:"table",columns:[
  {name:"yes",type:"boolean",values:[true,false]},
  {name:"no",type:"boolean",values:[false,true]}
]};
const unicode = {kind:"table",columns:[
  {name:"left",type:"string",values:["café","🙂"]},
  {name:"right",type:"string",values:["東京",""]}
]};
const control = value => ({value,disabled:false,addEventListener(){}});
function harness(options={}) {
  const queries=[], loaded=[], replies=[];
  const py = {
    async loadPackage(name) {
      loaded.push(name);
      if (options.loadError) throw Error("NumPy unavailable");
    },
    async runPythonAsync(query) { queries.push(query); return options.ack || "ok"; }
  };
  const self={postMessage:reply=>replies.push(reply)};
  vm.runInNewContext(source,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {queries,loaded,replies,send:(id,op,name,value)=>self.onmessage({
    data:{id,op,code:name,value}
  })};
}
async function wait(h,count) {
  for (let i=0;i<150 && h.replies.length<count;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,count,"worker did not acknowledge requests");
}
function python(code) {return spawnSync("python3",["-c",code],{encoding:"utf8"});}
function requireNumpy(t) {
  const result=python("import numpy");
  if (result.status===0) return true;
  if (process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
    assert.fail("NumPy required for independent CI acceptance: "+(result.stderr||result.error));
  t.skip("NumPy unavailable locally; no ndarray acceptance claimed");
  return false;
}
function controllerFor(packet, numpy=true, pandas=false) {
  let busy=false;
  const calls=[],notices=[];
  const c=transfer.create({direction:control("r-to-python"),source:control("table"),
    destination:control("matrix"),button:control(""),numpy:{checked:numpy},
    pandas:{checked:pandas},rSession:()=>({exportVariable:async()=>({ok:true,value:packet})}),
    python:async(op,name,value)=>{calls.push({op,name,value});return {ok:true};},
    notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>0});
  return {c,calls,notices};
}

test("controller sends homogeneous R tables to NumPy, retaining default dictionary mode", async () => {
  const enabled=controllerFor(numeric);
  assert.equal(await enabled.c.transfer(),true);
  assert.deepEqual(enabled.calls,[{op:"import-numpy",name:"matrix",value:numeric}]);
  assert.match(enabled.notices.at(-1),/NumPy ndarray/);
  const ordinary=controllerFor(numeric,false);
  assert.equal(await ordinary.c.transfer(),true);
  assert.equal(ordinary.calls[0].op,"import");
});

test("controller rejects mixed columns, missing logical/string cells and empty rows", async () => {
  const invalid=[
    {kind:"table",columns:[numeric.columns[0],unicode.columns[0]]},
    {kind:"table",columns:[{name:"x",type:"boolean",values:[true,null]}]},
    {kind:"table",columns:[{name:"x",type:"string",values:["safe",null]}]},
    {kind:"table",columns:[{name:"x",type:"number",values:[]}]}
  ];
  for (const packet of invalid) {
    const h=controllerFor(packet);
    assert.equal(await h.c.transfer(),false);
    assert.equal(h.calls.length,0,"Rejected table must not mutate destination");
    assert.match(h.notices.at(-1),/NumPy destination requires/);
  }
  const both=controllerFor(numeric,true,true);
  assert.equal(await both.c.transfer(),false);
  assert.equal(both.calls.length,0);
});

test("worker preflight rejects unsafe matrix packets before loading NumPy", async () => {
  const h=harness();
  const cases=[
    [numeric,true],[logical,true],[unicode,true],
    [{kind:"table",columns:[numeric.columns[0],unicode.columns[0]]},false],
    [{kind:"table",columns:[{name:"flag",type:"boolean",values:[true,null]}]},false],
    [{kind:"table",columns:[{name:"label",type:"string",values:[null,"ok"]}]},false],
    [{kind:"table",columns:[{name:"x",type:"number",values:[]}]},false],
    [{kind:"table",columns:[{name:"x",type:"number",values:[Infinity]}]},false],
    [{kind:"scalar",type:"number",values:[1]},false]
  ];
  cases.forEach(([packet],i)=>h.send(i+1,"import-numpy","matrix",packet));
  await wait(h,cases.length);
  const actual=h.replies.slice().sort((a,b)=>a.id-b.id).map(x=>x.ok);
  assert.deepEqual(actual,cases.map(x=>x[1]));
  assert.deepEqual(h.loaded,["numpy","numpy","numpy"]);
  assert.equal(h.queries.length,3);
  assert.match(h.queries[0],/column_stack/);
  assert.match(h.queries[0],/globals\(\)\["matrix"\] = _fs_transfer_array/);
});

test("real CPython constructs 2D numeric, logical and Unicode ndarrays with correct shape", async t => {
  if (!requireNumpy(t)) return;
  const h=harness();
  h.send(1,"import-numpy","numeric_matrix",numeric);
  h.send(2,"import-numpy","logical_matrix",logical);
  h.send(3,"import-numpy","unicode_matrix",unicode);
  await wait(h,3);
  const result=python(h.queries.join("\n")+"\n"+
    "import numpy as np\n"+
    "assert type(numeric_matrix) is np.ndarray and numeric_matrix.shape == (3,2)\n"+
    "assert numeric_matrix.dtype == np.dtype('float64')\n"+
    "assert numeric_matrix[0].tolist() == [1.5,4.0]\n"+
    "assert np.isnan(numeric_matrix[1,0]) and numeric_matrix[1,1] == 5\n"+
    "assert numeric_matrix[2,0] == 3 and np.isnan(numeric_matrix[2,1])\n"+
    "assert logical_matrix.shape == (2,2) and logical_matrix.dtype == np.dtype('bool')\n"+
    "assert logical_matrix.tolist() == [[True,False],[False,True]]\n"+
    "assert unicode_matrix.shape == (2,2) and unicode_matrix.dtype.kind == 'U'\n"+
    "assert unicode_matrix.tolist() == [['café','東京'],['🙂','']]\n");
  assert.equal(result.status,0,result.stderr);
});

test("failed NumPy matrix construction leaves the existing Python binding intact", async t => {
  if (!requireNumpy(t)) return;
  const h=harness();
  h.send(1,"import-numpy","matrix",numeric);
  await wait(h,1);
  const indented=h.queries[0].split("\n").map(line=>"    "+line).join("\n");
  const result=python("import numpy as np\nmatrix = 'unchanged'\n"+
    "def fail(*args,**kwargs): raise RuntimeError('construction failed')\n"+
    "np.column_stack = fail\ntry:\n"+indented+
    "\nexcept RuntimeError:\n    pass\nassert matrix == 'unchanged'\n");
  assert.equal(result.status,0,result.stderr);
});

test("missing NumPy and invalid acknowledgements do not report success", async () => {
  const unavailable=harness({loadError:true});
  unavailable.send(1,"import-numpy","matrix",numeric);
  await wait(unavailable,1);
  assert.equal(unavailable.replies[0].ok,false);
  assert.equal(unavailable.queries.length,0);
  const rejected=harness({ack:"unexpected"});
  rejected.send(1,"import-numpy","matrix",numeric);
  await wait(rejected,1);
  assert.equal(rejected.replies[0].ok,false);
  assert.match(rejected.replies[0].output,/did not acknowledge/);
});
