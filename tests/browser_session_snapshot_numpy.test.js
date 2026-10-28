"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const snapshots = require("../docs/app/session_snapshot.js");
const transfer = require("../docs/app/variable_transfer.js");

const numeric = {kind:"table",columns:[
  {name:"V1",type:"number",values:[1.25,null]},
  {name:"V2",type:"number",values:[3,4]}
]};
const vector = {kind:"vector",type:"string",values:["café","東京"]};
const boolean = {kind:"table",columns:[
  {name:"V1",type:"boolean",values:[true,false]},
  {name:"V2",type:"boolean",values:[false,true]}
]};
const source = {format:snapshots.FORMAT_V2,language:"python",omitted:0,
  truncated:false,variables:[{name:"array",value:numeric,restoreAs:"numpy"}]};

test("NumPy provenance is v2 Python-only, homogeneous and nonempty",()=>{
  assert.deepEqual(snapshots.validate(source),source);
  assert.deepEqual(snapshots.validate({...source,variables:[
    {name:"labels",value:vector,restoreAs:"numpy"}]}).variables[0].value,vector);
  const invalid=[
    {...source,format:snapshots.FORMAT},
    {...source,language:"r"},
    {...source,variables:[{name:"array",value:numeric,restoreAs:"pandas",extra:true}]},
    {...source,variables:[{name:"array",value:{kind:"scalar",type:"number",values:[2]},restoreAs:"numpy"}]},
    {...source,variables:[{name:"array",value:{kind:"vector",type:"number",values:[]},restoreAs:"numpy"}]},
    {...source,variables:[{name:"array",value:{kind:"vector",type:"string",values:["a",null]},restoreAs:"numpy"}]},
    {...source,variables:[{name:"array",value:{kind:"table",columns:[
      {name:"V1",type:"number",values:[1]},{name:"V2",type:"boolean",values:[true]}]},restoreAs:"numpy"}]},
    {...source,variables:[{name:"array",value:{kind:"table",columns:[
      {name:"V1",type:"string",values:["a",null]}]},restoreAs:"numpy"}]},
    {...source,variables:[{name:"array",value:{kind:"table",columns:[
      {name:"V1",type:"number",values:[]}]},restoreAs:"numpy"}]}
  ];
  for(const item of invalid) assert.throws(()=>snapshots.validate(item));
});

test("capture preserves only verified NumPy origin, without changing plain table snapshots",async()=>{
  const values={a:{ok:true,value:numeric},b:{ok:true,value:numeric,origin:"ndarray"},
    c:{ok:true,value:vector,origin:"ndarray"},d:{ok:true,value:numeric,origin:"matrix"},
    e:{ok:true,value:{kind:"vector",type:"string",values:["a",null]},origin:"ndarray"}};
  const captured=await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:Object.keys(values).map(name=>({name}))}),
    exportValue:async(_,name)=>values[name]});
  assert.equal(captured.format,snapshots.FORMAT_V2);
  assert.deepEqual(captured.variables,[
    {name:"a",value:numeric},{name:"b",value:numeric,restoreAs:"numpy"},
    {name:"c",value:vector,restoreAs:"numpy"}]);
  assert.equal(captured.omitted,2);
  assert.deepEqual(transfer.validate(captured.variables[1].value),numeric);
  const legacy=await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"a"}]}),
    exportValue:async()=>values.a});
  assert.equal(legacy.format,snapshots.FORMAT);
});

test("restore preflights all entries and selects NumPy only for annotated variables",async()=>{
  const calls=[];
  const data={...source,variables:[{name:"a",value:vector},
    {name:"array",value:numeric,restoreAs:"numpy"}]};
  const count=await snapshots.restore({snapshot:data,language:"python",generation:()=>0,
    importValue:async(...args)=>{calls.push(args);return {ok:true};}});
  assert.equal(count,2);
  assert.deepEqual(calls.map(x=>[x[1],x[3]]),[["a",null],["array","numpy"]]);
  let touched=0;
  await assert.rejects(snapshots.restore({snapshot:{...data,variables:[
    data.variables[0],{name:"bad",value:{kind:"scalar",type:"number",values:[1]},restoreAs:"numpy"}]},
    language:"python",generation:()=>0,importValue:async()=>{touched++;return {ok:true};}}));
  assert.equal(touched,0);
});

const workerSource=fs.readFileSync(path.join(__dirname,"../docs/app/python-worker.js"),"utf8");
function worker(packet=numeric,origin="ndarray") {
  const queries=[],replies=[],packages=[];
  const py={async loadPackage(name){packages.push(name);},
    async runPythonAsync(query){
      queries.push(query);
      if(query==="_fs_transfer_kind") return origin;
      if(query==="_fs_transfer_dtype") return "float64";
      if(query.startsWith("import json as _fs_transfer_json, numpy as _fs_transfer_np")) return "ok";
      return JSON.stringify(packet);
    }};
  const self={postMessage:reply=>replies.push(reply)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  async function send(op,value=undefined){
    replies.length=0;queries.length=0;packages.length=0;
    self.onmessage({data:{id:1,op,code:"array",value}});
    for(let i=0;i<200&&!replies.length;i++) await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(replies.length,1,"worker did not respond to "+op);
    return {reply:replies[0],queries:[...queries],packages:[...packages]};
  }
  return {send};
}
test("worker marks real ndarray only in snapshot export and rejects malformed provenance",async()=>{
  const w=worker();
  const snapshot=await w.send("export-snapshot");
  assert.equal(snapshot.reply.ok,true);
  assert.equal(snapshot.reply.origin,"ndarray");
  assert.equal(snapshot.reply.dtype,"float64");
  assert.equal(snapshot.queries[1],"_fs_transfer_kind");
  assert.equal(snapshot.queries[2],"_fs_transfer_dtype");
  const ordinary=await w.send("export");
  assert.equal(ordinary.reply.ok,true);
  assert.equal(Object.hasOwn(ordinary.reply,"origin"),false);
  assert.equal(ordinary.queries.length,1);
  const invalid=await worker({kind:"table",columns:[
    {name:"V1",type:"string",values:["a",null]}]}).send("export-snapshot");
  assert.equal(invalid.reply.ok,false);
  assert.equal((await worker(numeric,"table").send("export-snapshot")).reply.origin,undefined);
});
test("browser dispatch restores annotated NumPy through existing real importer",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/request\(restoreAs==="pandas" \? "import-pandas" : restoreAs==="numpy" \? "import-numpy" : "import",name,value\)/);
  assert.match(html,/request\("export-snapshot",name\)/);
  assert.match(html,/request\("import-numpy-snapshot",name,\{packet:value,dtype\}\)/);
});

function requireNumpy(t){
  const probe=spawnSync("python3",["-c","import numpy"],{encoding:"utf8"});
  if(probe.status===0) return true;
  if(process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
    assert.fail("NumPy required by native acceptance: "+(probe.stderr||probe.error));
  t.skip("NumPy unavailable; real ndarray test not executed");
  return false;
}
test("real CPython NumPy export preserves 1D/2D shape and column order",async t=>{
  if(!requireNumpy(t)) return;
  const query=(await worker().send("export-snapshot")).queries[0];
  const lines=query.split("\n");
  lines[lines.length-1]="print("+lines.at(-1)+")";
  lines.push("print(_fs_transfer_kind)");
  const cases=[
    ["np.array([[1.25,3],[np.nan,4]],dtype=np.float64)",numeric],
    ["np.array([['café','東京'],['🙂','']],dtype='U4')",
      {kind:"table",columns:[{name:"V1",type:"string",values:["café","🙂"]},
        {name:"V2",type:"string",values:["東京",""]}]}],
    ["np.array([True,False,True],dtype=np.bool_)",
      {kind:"vector",type:"boolean",values:[true,false,true]}]
  ];
  for(const [expression,expected] of cases){
    const result=spawnSync("python3",["-c","import numpy as np\narray = "+
      expression+"\n"+lines.join("\n")],{encoding:"utf8"});
    assert.equal(result.status,0,expression+": "+result.stderr);
    const rows=result.stdout.trim().split("\n");
    assert.deepEqual(JSON.parse(rows[0]),expected);
    assert.equal(rows[1],"ndarray");
  }
});
test("real NumPy importer reconstructs matrix and vector identity, missing values and Unicode",async t=>{
  if(!requireNumpy(t)) return;
  for(const [packet,expected] of [
    [numeric,"assert array.shape == (2,2) and array.dtype.kind == 'f' and array[0,1] == 3 and np.isnan(array[1,0])"],
    [boolean,"assert array.shape == (2,2) and array.dtype.kind == 'b' and array[0,0] and not array[0,1]"],
    [vector,"assert array.shape == (2,) and array.dtype.kind == 'U' and array.tolist() == ['café','東京']"]
  ]){
    const result=await worker(packet).send("import-numpy",packet);
    assert.equal(result.reply.ok,true);
    assert.deepEqual(result.packages,["numpy"]);
    const code=result.queries[0]+"\nimport numpy as np\n"+
      "assert type(array) is np.ndarray\n"+expected+"\nprint('numpy restored')";
    const run=spawnSync("python3",["-c",code],{encoding:"utf8"});
    assert.equal(run.status,0,run.stderr);
    assert.match(run.stdout,/numpy restored/);
  }
});

test("v2 snapshot dtype metadata is validated before interpreter mutation",async()=>{
  const typed={...source,variables:[{name:"array",value:numeric,
    restoreAs:"numpy",dtype:"float32"}]};
  assert.deepEqual(snapshots.validate(typed),typed);
  const cases=[
    {dtype:"object",value:numeric},{dtype:"float128",value:numeric},
    {dtype:"int8",value:numeric},{dtype:"int8",value:{kind:"vector",type:"number",values:[128]}},
    {dtype:"uint8",value:{kind:"vector",type:"number",values:[-1]}},
    {dtype:"float16",value:{kind:"vector",type:"number",values:[70000]}},
    {dtype:"<U1",value:vector},{dtype:"<U513",value:vector},
    {dtype:"bool",value:numeric},{dtype:"float32",value:boolean},
    {dtype:"float64",value:{kind:"vector",type:"number",values:[1.5]}}
  ];
  for(const entry of cases.slice(0,-1)){
    const invalid={...source,variables:[{name:"array",value:entry.value,
      restoreAs:"numpy",dtype:entry.dtype}]};
    assert.throws(()=>snapshots.validate(invalid),entry.dtype);
  }
  assert.deepEqual(snapshots.validate({...source,variables:[
    {name:"array",value:cases.at(-1).value,restoreAs:"numpy",dtype:"float64"}]}).variables[0].dtype,"float64");
  for(const entry of [
    {name:"array",value:numeric,dtype:"float32"},
    {name:"array",value:numeric,restoreAs:"pandas",dtype:"float32"}
  ]) assert.throws(()=>snapshots.validate({...source,variables:[entry]}));
  let touched=0;
  await assert.rejects(snapshots.restore({snapshot:{...source,variables:[
    {name:"a",value:vector},{name:"array",value:numeric,restoreAs:"numpy",dtype:"int8"}]},
    language:"python",generation:()=>0,importValue:async()=>{touched++;return {ok:true};}}));
  assert.equal(touched,0);
});

test("snapshot capture and restore retain NumPy dtype only for verified ndarray provenance",async()=>{
  const captured=await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"a"},{name:"b"}]}),
    exportValue:async(_,name)=>name==="a"?
      {ok:true,value:numeric,origin:"ndarray",dtype:"float32"} :
      {ok:true,value:vector}});
  assert.equal(captured.format,snapshots.FORMAT_V2);
  assert.equal(captured.variables[0].dtype,"float32");
  assert.equal(captured.variables[1].dtype,undefined);
  const calls=[];
  assert.equal(await snapshots.restore({snapshot:captured,language:"python",
    generation:()=>0,importValue:async(...args)=>{calls.push(args);return {ok:true};}}),2);
  assert.deepEqual(calls.map(call=>[call[1],call[3],call[4] || null]),
    [["a","numpy","float32"],["b",null,null]]);
  const invalid=await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"bad"}]}),
    exportValue:async()=>({ok:true,value:numeric,origin:"ndarray",dtype:"int8"})});
  assert.equal(invalid.variables.length,0);
  assert.equal(invalid.omitted,1);
});

test("worker reconstructs exact NumPy dtypes using real CPython and refuses lossy casts",async t=>{
  if(!requireNumpy(t)) return;
  const cases=[
    [{kind:"vector",type:"number",values:[-12,27]},"int8","[-12,27]"],
    [{kind:"vector",type:"number",values:[65535,0]},"uint16","[65535,0]"],
    [{kind:"vector",type:"number",values:[1.25,2.5]},"float16","[1.25,2.5]"],
    [numeric,"float32","[[1.25,3.0],[float('nan'),4.0]]"],
    [boolean,"bool","[[True,False],[False,True]]"],
    [{kind:"vector",type:"string",values:["café","東京","🙂"]},"<U4","['café','東京','🙂']"]
  ];
  for(const [packet,dtype] of cases){
    const {reply,queries,packages}=await worker(packet).send("import-numpy-snapshot",{packet,dtype});
    assert.equal(reply.ok,true,dtype+":"+reply.output);
    assert.deepEqual(packages,["numpy"]);
    assert.equal(queries.length,1);
    const run=spawnSync("python3",["-c",queries[0]+
      "\nimport numpy as np\nassert type(array) is np.ndarray"+
      "\nassert str(array.dtype) == "+JSON.stringify(dtype)+
      "\nprint(array.shape)"],{encoding:"utf8"});
    assert.equal(run.status,0,dtype+": "+run.stderr);
  }
  for(const [packet,dtype] of [
    [{kind:"vector",type:"number",values:[128]},"int8"],
    [{kind:"vector",type:"number",values:[-1]},"uint8"],
    [{kind:"vector",type:"number",values:[70000]},"float16"],
    [{kind:"vector",type:"string",values:["Tokyo"]},"<U2"],
    [numeric,"object"]
  ]){
    const result=await worker(packet).send("import-numpy-snapshot",{packet,dtype});
    assert.equal(result.reply.ok,false,dtype);
    assert.equal(result.queries.length,0);
  }
  // A valid float32 metadata type with an unrepresentable value is rejected
  // by the real NumPy constructor path before overwriting the destination.
  const lossy={kind:"vector",type:"number",values:[0.1]};
  const result=await worker(lossy).send("import-numpy-snapshot",{packet:lossy,dtype:"float32"});
  assert.equal(result.reply.ok,true);
  const code="array = 'original'\ntry:\n"+
    result.queries[0].split("\n").map(line=>"    "+line).join("\n")+
    "\nexcept ValueError:\n    pass\nassert array == 'original'";
  const run=spawnSync("python3",["-c",code],{encoding:"utf8"});
  assert.equal(run.status,0,run.stderr);
});

test("real CPython NumPy export reports original dtype without changing transfer packet",async t=>{
  if(!requireNumpy(t)) return;
  const w=worker();
  const exported=await w.send("export-snapshot");
  const lines=exported.queries[0].split("\n");
  lines[lines.length-1]="print("+lines.at(-1)+")";
  lines.push("print(_fs_transfer_kind)");
  lines.push("print(_fs_transfer_dtype)");
  for(const [expression,dtype] of [
    ["np.array([1,2],dtype=np.int16)","int16"],
    ["np.array([[1.25,2.5]],dtype=np.float32)","float32"],
    ["np.array(['東京','🙂'],dtype='<U3')","<U3"]
  ]){
    const run=spawnSync("python3",["-c","import numpy as np\narray="+expression+
      "\n"+lines.join("\n")],{encoding:"utf8"});
    assert.equal(run.status,0,run.stderr);
    const rows=run.stdout.trim().split("\n");
    assert.equal(rows[1],"ndarray");
    assert.equal(rows[2],dtype);
    assert.ok(JSON.parse(rows[0]));
  }
});
