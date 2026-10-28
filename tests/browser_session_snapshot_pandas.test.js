"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const snapshots = require("../docs/app/session_snapshot.js");
const transfer = require("../docs/app/variable_transfer.js");

const table = {kind:"table",columns:[
  {name:"score",type:"number",values:[1.5,null,2.25]},
  {name:"label",type:"string",values:["é",null,"@NA@"]}
]};
const scalar = {kind:"scalar",type:"boolean",values:[true]};
const base = {format:snapshots.FORMAT,language:"python",omitted:0,truncated:false,
  variables:[{name:"frame",value:table}]};
const v2 = {format:snapshots.FORMAT_V2,language:"python",omitted:0,truncated:false,
  variables:[{name:"frame",value:table,restoreAs:"pandas"}]};

test("v1 snapshots remain importable; v2 preserves only approved pandas table provenance",()=>{
  assert.deepEqual(snapshots.validate(base),base);
  assert.deepEqual(snapshots.validate(v2),v2);
  for (const bad of [
    {...base,variables:[{name:"frame",value:table,restoreAs:"pandas"}]},
    {...v2,language:"r"},
    {...v2,variables:[{name:"frame",value:scalar,restoreAs:"pandas"}]},
    {...v2,variables:[{name:"frame",value:table,restoreAs:"dict"}]},
    {...v2,variables:[{name:"frame",value:table,restoreAs:"pandas",extra:true}]},
    {...v2,variables:[{name:"frame",value:table,restoreAs:"pandas"},{name:"frame",value:scalar}]},
    {...v2,variables:[{name:"frame",value:{kind:"table",columns:[]},restoreAs:"pandas"}]},
    {...v2,format:"flowstudio-session-v3"}
  ]) assert.throws(()=>snapshots.validate(bad));
});

test("capture upgrades to v2 only for a verified pandas table, keeping plain tables and missing cells",async()=>{
  const values = {a:{ok:true,value:scalar},b:{ok:true,value:table},
    c:{ok:true,value:table,origin:"pandas"}};
  const captured = await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"c"},{name:"a"},{name:"b"}]}),
    exportValue:async(_,name)=>values[name]});
  assert.equal(captured.format,snapshots.FORMAT_V2);
  assert.deepEqual(captured.variables,[
    {name:"a",value:scalar},{name:"b",value:table},
    {name:"c",value:table,restoreAs:"pandas"}
  ]);
  assert.equal(captured.omitted,0);
  assert.equal(transfer.validate(captured.variables[2].value),table);
  const legacy = await snapshots.capture({language:"python",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"b"}]}),
    exportValue:async()=>({ok:true,value:table})});
  assert.equal(legacy.format,snapshots.FORMAT);
});

test("unsupported provenance is omitted rather than mislabelled",async()=>{
  const captured = await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"bad"},{name:"good"}]}),
    exportValue:async(_,name)=>name==="bad"?
      {ok:true,value:table,origin:"pandas"}:{ok:true,value:table}});
  assert.equal(captured.format,snapshots.FORMAT);
  assert.equal(captured.omitted,1);
  assert.deepEqual(captured.variables,[{name:"good",value:table}]);
});

test("restore preflights the entire v2 snapshot before mutation and dispatches per-entry origin",async()=>{
  const calls=[];
  const source = {...v2,variables:[{name:"a",value:scalar},
    {name:"frame",value:table,restoreAs:"pandas"},{name:"other",value:table}]};
  const count=await snapshots.restore({snapshot:source,language:"python",generation:()=>0,
    importValue:async(lang,name,value,restoreAs)=>{
      calls.push({lang,name,value,restoreAs});return {ok:true};
    }});
  assert.equal(count,3);
  assert.deepEqual(calls.map(x=>[x.name,x.restoreAs]),
    [["a",null],["frame","pandas"],["other",null]]);
  let touched=0;
  const malformed={...source,variables:[source.variables[0],
    {...source.variables[1],restoreAs:"not-pandas"}]};
  await assert.rejects(snapshots.restore({snapshot:malformed,language:"python",
    generation:()=>0,importValue:async()=>{touched++;return {ok:true};}}));
  assert.equal(touched,0);
});

test("pandas restore failure reports partial state without claiming rollback",async()=>{
  const calls=[];
  await assert.rejects(snapshots.restore({snapshot:{...v2,variables:[
    {name:"a",value:scalar},{name:"frame",value:table,restoreAs:"pandas"}]},
    language:"python",generation:()=>0,
    importValue:async(_,name,packet,origin)=>{
      calls.push([name,origin]);return name==="frame"?{ok:false,output:"pandas unavailable"}:{ok:true};
    }}),/Restored 1 of 2 values; frame: pandas unavailable/);
  assert.deepEqual(calls,[["a",null],["frame","pandas"]]);
});

function makeWorker(kind="pandas") {
  const source=fs.readFileSync(path.join(__dirname,"../docs/app/python-worker.js"),"utf8");
  const queries=[], replies=[];
  const py={async runPythonAsync(query) {
    queries.push(query);
    return query==="_fs_transfer_kind" ? kind : JSON.stringify(table);
  }};
  const self={postMessage:reply=>replies.push(reply)};
  vm.runInNewContext(source,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  async function send(op) {
    replies.length=0;queries.length=0;
    self.onmessage({data:{id:1,op,code:"frame"}});
    for(let i=0;i<200 && !replies.length;i++)
      await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(replies.length,1,"worker did not answer "+op);
    return {reply:replies[0],queries:[...queries]};
  }
  return {send};
}
test("real worker export-snapshot reports pandas origin while normal transfers stay unchanged",async()=>{
  const worker=makeWorker();
  const exported=await worker.send("export-snapshot");
  assert.equal(exported.reply.ok,true);
  assert.equal(exported.reply.origin,"pandas");
  assert.deepEqual(JSON.parse(JSON.stringify(exported.reply.value)),table);
  assert.equal(exported.queries.length,2);
  assert.equal(exported.queries[1],"_fs_transfer_kind");
  const ordinary=await worker.send("export");
  assert.equal(ordinary.reply.ok,true);
  assert.equal(Object.hasOwn(ordinary.reply,"origin"),false);
  assert.equal(ordinary.queries.length,1);
  const plain=await makeWorker("table").send("export-snapshot");
  assert.equal(plain.reply.ok,true);
  assert.equal(Object.hasOwn(plain.reply,"origin"),false);
});

test("real CPython distinguishes pandas and plain dictionary provenance",async t=>{
  const probe=spawnSync("python3",["-c","import pandas"],{encoding:"utf8"});
  if(probe.status!==0) {
    if(process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
      assert.fail("pandas is required for native source CI: "+(probe.stderr||probe.error));
    return t.skip("pandas unavailable locally");
  }
  const worker=makeWorker();
  const query=(await worker.send("export-snapshot")).queries[0];
  const lines=query.split("\n");
  lines[lines.length-1]="print("+lines.at(-1)+")";
  lines.push("print(_fs_transfer_kind)");
  for(const [setup,expected] of [
    ["import pandas as pd\nframe = pd.DataFrame({'score':pd.Series([1.5,None,2.25],dtype='Float64'),'label':pd.Series(['é',None,'@NA@'],dtype='string')})","pandas"],
    ["frame = {'score':[1.5,None,2.25],'label':['é',None,'@NA@']}","table"]
  ]) {
    const run=spawnSync("python3",["-c",setup+"\n"+lines.join("\n")],{encoding:"utf8"});
    assert.equal(run.status,0,run.stderr);
    const rows=run.stdout.trim().split("\n");
    assert.deepEqual(JSON.parse(rows[0]),table);
    assert.equal(rows[1],expected);
  }
});

test("browser snapshot wiring selects the pandas import only for annotated v2 entries",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/request\("export-snapshot",name\)/);
  assert.match(html,/request\(restoreAs==="pandas" \? "import-pandas" : restoreAs==="numpy" \? "import-numpy" : "import",name,value\)/);
  assert.match(html,/FlowStudioSessionSnapshot\.create/);
});
