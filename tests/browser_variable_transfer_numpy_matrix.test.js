"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");
const {create: createRSession} = require("../docs/app/r_session.js");
const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");

async function exportQuery(packet = {kind:"table",columns:[
  {name:"V1",type:"number",values:[1.25,null]},
  {name:"V2",type:"number",values:[3,4]}
]}) {
  const queries = [], replies = [];
  const py = {async runPythonAsync(query) {queries.push(query);return JSON.stringify(packet);}};
  const self = {postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  self.onmessage({data:{id:1,op:"export",code:"matrix"}});
  for (let i=0;i<100 && !replies.length;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(replies.length,1,"worker did not respond");
  assert.equal(replies[0].ok,true);
  assert.equal(queries.length,1);
  assert.equal(transfer.validate(packet),packet);
  return queries[0];
}
function runPython(query, setup) {
  const lines=query.split("\n");
  lines[lines.length-1]="print("+lines.at(-1)+")";
  return spawnSync("python3",["-c",setup+"\n"+lines.join("\n")],{encoding:"utf8"});
}
function requireNumpy(t) {
  const probe=spawnSync("python3",["-c","import numpy"],{encoding:"utf8"});
  if (probe.status===0) return true;
  if (process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
    assert.fail("NumPy required by pinned CI acceptance: "+(probe.stderr||probe.error));
  t.skip("NumPy unavailable; no real ndarray acceptance claimed");
  return false;
}

test("2D ndarray exports through the existing bounded table protocol", async () => {
  const query=await exportQuery();
  assert.match(query,/NumPy matrix requires 1-128 rows and 1-16 columns/);
  assert.match(query,/for _fs_transfer_index in range\(_fs_transfer_width\)/);
  assert.match(query,/\{'name': 'V' \+ str\(_fs_transfer_index \+ 1\)/);
  assert.match(query,/type\(_fs_transfer_obj\) is _fs_transfer_np.ndarray/);
  assert.match(query,/allow_nan=False/);
});

test("real NumPy matrices transfer column order, numeric missing values, bool and Unicode", async t => {
  if (!requireNumpy(t)) return;
  const query=await exportQuery();
  const cases=[
    ["np.array([[1.25,3],[np.nan,4]],dtype=np.float64)",
      {kind:"table",columns:[{name:"V1",type:"number",values:[1.25,null]},
        {name:"V2",type:"number",values:[3,4]}]}],
    ["np.array([[2,3],[4,5]],dtype=np.int16)",
      {kind:"table",columns:[{name:"V1",type:"number",values:[2,4]},
        {name:"V2",type:"number",values:[3,5]}]}],
    ["np.array([[True,False],[False,True]],dtype=np.bool_)",
      {kind:"table",columns:[{name:"V1",type:"boolean",values:[true,false]},
        {name:"V2",type:"boolean",values:[false,true]}]}],
    ["np.array([['café','東京'],['🙂','']],dtype='U4')",
      {kind:"table",columns:[{name:"V1",type:"string",values:["café","🙂"]},
        {name:"V2",type:"string",values:["東京",""]}]}]
  ];
  for (const [expression,expected] of cases) {
    const result=runPython(query,"import numpy as np\nmatrix = "+expression);
    assert.equal(result.status,0,expression+": "+result.stderr);
    const packet=JSON.parse(result.stdout);
    assert.deepEqual(packet,expected);
    assert.equal(transfer.validate(packet),packet);
  }
});

test("real NumPy matrix export fails closed on shape, dtype, unsafe values and subclass", async t => {
  if (!requireNumpy(t)) return;
  const query=await exportQuery();
  const invalid=[
    "np.ones((2,2,2),dtype=np.float64)",
    "np.ones((0,2),dtype=np.float64)",
    "np.ones((2,0),dtype=np.float64)",
    "np.ones((129,2),dtype=np.float64)",
    "np.ones((2,17),dtype=np.float64)",
    "np.array([[np.nan,1],[np.nan,2]],dtype=np.float64)",
    "np.array([[float('inf'),1]],dtype=np.float64)",
    "np.array([[9007199254740992,1]],dtype=np.uint64)",
    "np.array([[1+2j]],dtype=np.complex128)",
    "np.array([[None]],dtype=object)",
    "np.array([['x']],dtype='U513')",
    "np.array([['x\\x00y']],dtype='U3')"
  ];
  for (const expression of invalid) {
    const result=runPython(query,"import numpy as np\nmatrix = "+expression);
    assert.notEqual(result.status,0,"Unexpectedly exported "+expression);
  }
  const subclass=runPython(query,"import numpy as np\n"+
    "class Trap(np.ndarray):\n def tolist(self): raise RuntimeError('unsafe traversal')\n"+
    "matrix = np.ones((2,2)).view(Trap)");
  assert.notEqual(subclass.status,0);
  assert.doesNotMatch(subclass.stderr,/unsafe traversal/);
  const oversized=runPython(query,"import numpy as np\nmatrix = np.full((16,16),'x'*200,dtype='U200')");
  assert.equal(oversized.status,0,oversized.stderr);
  assert.throws(()=>transfer.validate(JSON.parse(oversized.stdout)),/32 KiB/);
});

test("real R importer receives the NumPy table as a data.frame", async t => {
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (probe.error) return t.skip("Rscript unavailable locally; required in native CI");
  const packet={kind:"table",columns:[
    {name:"V1",type:"number",values:[1.25,null]},
    {name:"V2",type:"number",values:[3,4]}
  ]};
  const queries=[];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query,type) {queries.push(query);assert.equal(type,"string[]");return ["ok"];}
  }
  const r=createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  assert.equal((await r.importVariable("copy",packet)).ok,true);
  assert.equal(queries.length,1);
  const script="invisible("+queries[0]+")\n"+
    "stopifnot(is.data.frame(copy), identical(names(copy),c('V1','V2')), "+
    "identical(copy$V1,c(1.25,NA_real_)), identical(copy$V2,c(3,4)))";
  const result=spawnSync("Rscript",["--vanilla","-e",script],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
});
