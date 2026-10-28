"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const snapshots = require("../docs/app/session_snapshot.js");
const {create:createRSession} = require("../docs/app/r_session.js");

const packet = {kind:"vector",type:"string",values:["low",null,"high","low"]};
const factor = {levels:["low","middle","high"],ordered:true};
const snapshot = {format:snapshots.FORMAT_V2,language:"r",omitted:0,truncated:false,
  variables:[{name:"rating",value:packet,restoreAs:"factor",factor}]};

function session(rows) {
  const queries = [];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query, type) {
      assert.equal(type,"string[]");
      queries.push(query);
      return rows;
    }
  }
  return {queries,r:createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
const encoded = ["@FACTOR@","1","3","low","middle","high","low","@NA@","high","low"];

test("v2 R factor snapshot preserves ordered and unused levels",()=>{
  assert.deepEqual(snapshots.validate(snapshot),snapshot);
  const invalid = [
    {...snapshot,format:snapshots.FORMAT},
    {...snapshot,language:"python"},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor"}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"matrix",factor}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor",factor:{levels:["low","low"],ordered:true}}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor",factor:{levels:["low"],ordered:true}}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor",factor:{levels:["low"],ordered:"true"}}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor",factor:{levels:["low"],ordered:true,other:1}}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor",factor:{levels:["low","middle","high"],ordered:true},dtype:"<U6"}]},
    {...snapshot,variables:[{name:"rating",value:{kind:"scalar",type:"string",values:["low"]},restoreAs:"factor",factor}]},
    {...snapshot,variables:[{name:"rating",value:packet,restoreAs:"factor",factor:{levels:["low","middle","high","\\ud800"],ordered:true}}]}
  ];
  for (const bad of invalid) assert.throws(()=>snapshots.validate(bad));
});

test("capture opts into real R factor provenance; ordinary vectors remain v1",async()=>{
  const captured = await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"rating"},{name:"plain"}]}),
    exportValue:async(_,name)=>name==="rating" ?
      {ok:true,value:packet,origin:"factor",factor} :
      {ok:true,value:{kind:"vector",type:"string",values:["a"]}}});
  assert.equal(captured.format,snapshots.FORMAT_V2);
  assert.equal(captured.variables.length,2);
  assert.deepEqual(captured.variables[1],{name:"rating",value:packet,restoreAs:"factor",factor});
  assert.equal(captured.omitted,0);
  const malformed = await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"rating"}]}),
    exportValue:async()=>({ok:true,value:packet,origin:"factor",factor:{levels:["wrong"],ordered:false}})});
  assert.equal(malformed.omitted,1);
  assert.equal(malformed.variables.length,0);
});

test("restore preflights every factor and routes metadata only for factor entries",async()=>{
  const calls = [];
  assert.equal(await snapshots.restore({snapshot,language:"r",generation:()=>0,
    importValue:async(...args)=>{calls.push(args);return {ok:true};}}),1);
  assert.deepEqual(calls,[["r","rating",packet,"factor",factor]]);
  let touched=0;
  await assert.rejects(snapshots.restore({snapshot:{...snapshot,variables:[
    snapshot.variables[0],{name:"bad",value:packet,restoreAs:"factor",
      factor:{levels:["other"],ordered:false}}]},
    language:"r",generation:()=>0,importValue:async()=>{touched++;return {ok:true};}}));
  assert.equal(touched,0);
});

test("webR exports only strict base factors for snapshots, not ordinary transfers",async()=>{
  const source = session(encoded);
  const result = await source.r.exportVariable("rating",{forSnapshot:true});
  assert.deepEqual(result,{ok:true,value:packet,origin:"factor",factor});
  assert.match(source.queries[0],/factor_origin <- TRUE/);
  assert.match(source.queries[0],/base::identical\(base::sort\(base::names\(base::attributes\(v\)\)\)/);
  const ordinary = session(encoded);
  assert.equal((await ordinary.r.exportVariable("rating")).ok,false);
  assert.match(ordinary.queries[0],/factor_origin <- FALSE/);
  const bad = session(["@FACTOR@","1","2","low","low","low"]);
  assert.equal((await bad.r.exportVariable("rating",{forSnapshot:true})).ok,false);
});

test("webR factor import constructs a real ordered factor without evaluating level source",async()=>{
  const target = session(["ok"]);
  assert.deepEqual(await target.r.importVariable("rating",packet,{asFactor:factor}),{ok:true});
  assert.match(target.queries[0],/base::factor\(/);
  assert.match(target.queries[0],/ordered=TRUE/);
  assert.match(target.queries[0],/levels=base::c\(/);
  const invalid = session(["ok"]);
  for (const options of [
    {asFactor:{levels:["other"],ordered:true}},
    {asFactor:{levels:["low","middle","high"],ordered:"yes"}},
    {asFactor:factor,asMatrix:true},
    {asFactor:{...factor,extra:1}}
  ]) assert.equal((await invalid.r.importVariable("rating",packet,options)).ok,false);
  assert.equal(invalid.queries.length,0);
});

test("browser snapshot UI explicitly dispatches factor metadata to R",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/restoreAs==="factor" \? \{asFactor:dtype\} : undefined/);
});

test("real Rscript round-trips ordered factors, missing values and unused levels",async t=>{
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (probe.error) return t.skip("Rscript unavailable locally; native CI must run this test");
  const source=session(encoded);
  assert.equal((await source.r.exportVariable("rating",{forSnapshot:true})).ok,true);
  const query=source.queries[0];
  const setup='rating <- factor(c("low", NA_character_, "high", "low"), levels=c("low","middle","high"), ordered=TRUE)';
  const exported=spawnSync("Rscript",["--vanilla","-e",setup+
    "\nwriteLines(eval(parse(text="+JSON.stringify(query)+")))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(exported.status,0,exported.stderr);
  assert.deepEqual(exported.stdout.trim().split(/\r?\n/),encoded);
  const target=session(["ok"]);
  assert.equal((await target.r.importVariable("rating",packet,{asFactor:factor})).ok,true);
  const importQuery=target.queries[0];
  const restored=spawnSync("Rscript",["--vanilla","-e",
    importQuery+"\nstopifnot(identical(levels(rating),c('low','middle','high')), is.ordered(rating), "+
    "identical(as.character(rating),c('low',NA_character_,'high','low')))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(restored.status,0,restored.stderr);
  const decorated=spawnSync("Rscript",["--vanilla","-e",
    setup+"\nattr(rating,'extra') <- 1L\nwriteLines(eval(parse(text="+JSON.stringify(query)+")))"],
    {encoding:"utf8",timeout:20000});
  assert.notEqual(decorated.status,0,"Extra factor attributes must be rejected");
});
