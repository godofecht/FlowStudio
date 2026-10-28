"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const snapshots = require("../docs/app/session_snapshot.js");
const {create: createRSession} = require("../docs/app/r_session.js");

const matrix = {kind:"table",columns:[
  {name:"V1",type:"number",values:[1.25,null]},
  {name:"V2",type:"number",values:[3,4]}
]};
const booleanMatrix = {kind:"table",columns:[
  {name:"V1",type:"boolean",values:[true,null]},
  {name:"V2",type:"boolean",values:[false,true]}
]};
const v2 = {format:snapshots.FORMAT_V2,language:"r",omitted:0,truncated:false,
  variables:[{name:"measurements",value:matrix,restoreAs:"matrix"}]};

function session(rows) {
  const queries=[];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query, type) {
      assert.equal(type,"string[]");
      queries.push(query);
      return rows;
    }
  }
  return {queries, r:createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
const encodedMatrix = ["@MATRIX@","2","2","V1","double","1.25","@NA@",
  "V2","double","3","4"];
const encodedTable = ["@TABLE@",...encodedMatrix.slice(1)];

test("R matrix snapshots use v2 metadata; v1 and cross-language provenance are rejected",()=>{
  assert.deepEqual(snapshots.validate(v2),v2);
  const invalid=[
    {...v2,format:snapshots.FORMAT},
    {...v2,language:"python"},
    {...v2,variables:[{name:"measurements",value:matrix,restoreAs:"pandas"}]},
    {...v2,variables:[{name:"measurements",value:{kind:"vector",type:"number",values:[1]},restoreAs:"matrix"}]},
    {...v2,variables:[{name:"measurements",value:{kind:"table",columns:[
      {name:"V1",type:"number",values:[1]},{name:"V2",type:"string",values:["a"]}]},restoreAs:"matrix"}]},
    {...v2,variables:[{name:"measurements",value:{kind:"table",columns:[
      {name:"V1",type:"number",values:[]}]},restoreAs:"matrix"}]},
    {...v2,variables:[{name:"measurements",value:matrix,restoreAs:"matrix",extra:true}]}
  ];
  for(const bad of invalid) assert.throws(()=>snapshots.validate(bad));
  assert.deepEqual(snapshots.validate({...v2,variables:[{name:"flag",value:{
    kind:"scalar",type:"boolean",values:[true]}}]}).variables[0].name,"flag");
});

test("snapshot capture preserves verified matrix provenance without changing ordinary R tables",async()=>{
  const captured=await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"z"},{name:"a"}]}),
    exportValue:async(_,name)=>name==="z"?
      {ok:true,value:matrix,origin:"matrix"}:{ok:true,value:matrix}});
  assert.equal(captured.format,snapshots.FORMAT_V2);
  assert.deepEqual(captured.variables,[
    {name:"a",value:matrix},{name:"z",value:matrix,restoreAs:"matrix"}]);
  assert.equal(captured.omitted,0);
  const legacy=await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"a"}]}),
    exportValue:async()=>({ok:true,value:matrix})});
  assert.equal(legacy.format,snapshots.FORMAT);
});

test("unsupported or malformed R matrix origins are omitted, never silently demoted",async()=>{
  const bad={kind:"table",columns:[
    {name:"V1",type:"number",values:[1]},{name:"V2",type:"string",values:["a"]}]};
  const result=await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"a"},{name:"b"},{name:"c"}]}),
    exportValue:async(_,name)=>name==="a"?{ok:true,value:bad,origin:"matrix"}:
      name==="b"?{ok:true,value:matrix,origin:"pandas"}:
      {ok:true,value:booleanMatrix,origin:"matrix"}});
  assert.equal(result.omitted,2);
  assert.deepEqual(result.variables,[{name:"c",value:booleanMatrix,restoreAs:"matrix"}]);
});

test("matrix restore preflights all entries and preserves explicit destination dispatch",async()=>{
  const calls=[];
  const count=await snapshots.restore({snapshot:v2,language:"r",generation:()=>0,
    importValue:async(...args)=>{calls.push(args);return {ok:true};}});
  assert.equal(count,1);
  assert.deepEqual(calls,[["r","measurements",matrix,"matrix"]]);
  let touched=0;
  await assert.rejects(snapshots.restore({snapshot:{...v2,variables:[
    v2.variables[0],{name:"bad",value:matrix,restoreAs:"pandas"}]},
    language:"r",generation:()=>0,importValue:async()=>{touched++;return {ok:true};}}));
  assert.equal(touched,0);
});

test("webR marks only verified plain matrices in explicit snapshot exports",async()=>{
  const m=session(encodedMatrix);
  const result=await m.r.exportVariable("measurements",{forSnapshot:true});
  assert.equal(result.ok,true);
  assert.equal(result.origin,"matrix");
  assert.deepEqual(result.value,matrix);
  assert.match(m.queries[0],/matrix_origin <- base::is.matrix\(v\) && !base::is.object\(v\)/);
  assert.match(m.queries[0],/matrix_origin && TRUE/);
  assert.match(m.queries[0],/bindingIsActive/);
  const ordinary=session(encodedTable);
  assert.equal((await ordinary.r.exportVariable("measurements")).origin,undefined);
  assert.match(ordinary.queries[0],/matrix_origin && FALSE/);
  const frame=session(encodedTable);
  assert.equal((await frame.r.exportVariable("frame",{forSnapshot:true})).origin,undefined);
  const invalid=session(encodedTable);
  for(const options of [null,[],{forSnapshot:"yes"},{forSnapshot:true,other:true}])
    assert.equal((await invalid.r.exportVariable("frame",options)).ok,false);
  assert.equal(invalid.queries.length,0);
  const unapproved=session(encodedMatrix);
  assert.equal((await unapproved.r.exportVariable("measurements")).ok,false);
});

test("browser snapshot controller opts in to R provenance and restores matrices explicitly",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/exportVariable\(name,\{forSnapshot:true\}\)/);
  assert.match(html,/restoreAs==="matrix" \? \{asMatrix:true\} : undefined/);
  assert.match(html,/request\(restoreAs==="pandas" \? "import-pandas" : restoreAs==="numpy" \? "import-numpy" : "import"/);
});

test("real Rscript identifies plain matrices without mislabelling data.frames",async t=>{
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if(probe.error) return t.skip("Rscript unavailable locally; native CI must run this test");
  const m=session(encodedMatrix);
  assert.equal((await m.r.exportVariable("measurements",{forSnapshot:true})).ok,true);
  const query=m.queries[0];
  const cases=[
    ["measurements <- matrix(c(1.25,NA_real_,3,4),nrow=2)", "@MATRIX@"],
    ["measurements <- data.frame(V1=c(1.25,NA_real_),V2=c(3,4))", "@TABLE@"],
    ["measurements <- structure(matrix(c(1,2),nrow=1),class='custom')", null]
  ];
  for(const [setup,expected] of cases) {
    const code=setup+"\nwriteLines(eval(parse(text="+JSON.stringify(query)+")))";
    const result=spawnSync("Rscript",["--vanilla","-e",code],
      {encoding:"utf8",timeout:20000});
    if(expected===null) {
      assert.notEqual(result.status,0,"Classed matrices must be rejected");
    } else {
      assert.equal(result.status,0,result.stderr);
      assert.equal(result.stdout.split(/\r?\n/)[0],expected);
    }
  }
});
