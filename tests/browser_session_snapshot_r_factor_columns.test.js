"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const snapshots = require("../docs/app/session_snapshot.js");
const {create:createRSession} = require("../docs/app/r_session.js");

const table = {kind:"table", columns:[
  {name:"rating", type:"string", values:["low",null,"high"]},
  {name:"score", type:"number", values:[1.25,2.5,null]}
]};
const factorColumns = [{name:"rating",levels:["low","middle","high"],ordered:true}];
const snapshot = {format:snapshots.FORMAT_V2,language:"r",omitted:0,truncated:false,
  variables:[{name:"frame",value:table,restoreAs:"dataframe",factorColumns}]};
const encoded = ["@FRAME_FACTORS@","2","3","rating","character","low","@NA@","high",
  "score","double","1.25","2.5","@NA@","@FACTOR_COLUMNS@","1",
  "rating","1","3","low","middle","high"];

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

test("snapshot accepts only validated R data.frame factor column provenance",()=>{
  assert.deepEqual(snapshots.validate(snapshot),snapshot);
  const variable = snapshot.variables[0];
  const invalid = [
    {...snapshot,format:snapshots.FORMAT},
    {...snapshot,language:"python"},
    {...snapshot,variables:[{...variable,restoreAs:"factor"}]},
    {...snapshot,variables:[{...variable,factorColumns:[]}]},
    {...snapshot,variables:[{...variable,factorColumns:[...factorColumns,...factorColumns]}]},
    {...snapshot,variables:[{...variable,factorColumns:[{...factorColumns[0],name:"missing"}]}]},
    {...snapshot,variables:[{...variable,factorColumns:[{...factorColumns[0],levels:["low"]}]}]},
    {...snapshot,variables:[{...variable,factorColumns:[{...factorColumns[0],ordered:"true"}]}]},
    {...snapshot,variables:[{...variable,factorColumns:[{...factorColumns[0],other:true}]}]},
    {...snapshot,variables:[{...variable,factorColumns:[{...factorColumns[0],levels:["low","low"]}]}]},
    {...snapshot,variables:[{...variable,factorColumns:[{...factorColumns[0],levels:["low","middle","high","\ud800"]}]}]},
    {...snapshot,variables:[{...variable,value:{kind:"vector",type:"string",values:["low"]}}]}
  ];
  for(const bad of invalid) assert.throws(()=>snapshots.validate(bad));
});

test("capture preserves factor columns only when actual R export reports provenance",async()=>{
  const captured = await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"frame"},{name:"plain"}]}),
    exportValue:async(_,name)=>name==="frame" ?
      {ok:true,value:table,origin:"dataframe",factorColumns} : {ok:true,value:table}});
  assert.equal(captured.format,snapshots.FORMAT_V2);
  assert.deepEqual(captured.variables,[
    {name:"frame",value:table,restoreAs:"dataframe",factorColumns},
    {name:"plain",value:table}
  ]);
  assert.equal(captured.omitted,0);
  const forged = await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"frame"}]}),
    exportValue:async()=>({ok:true,value:table,origin:"dataframe",
      factorColumns:[{name:"score",levels:["low"],ordered:false}]})});
  assert.equal(forged.omitted,1);
  assert.deepEqual(forged.variables,[]);
});

test("restore validates the entire snapshot before changing any R binding",async()=>{
  const calls=[];
  assert.equal(await snapshots.restore({snapshot,language:"r",generation:()=>0,
    importValue:async(...args)=>{calls.push(args);return {ok:true};}}),1);
  assert.deepEqual(calls,[["r","frame",table,"dataframe",factorColumns]]);
  let mutated=0;
  const malformed={...snapshot,variables:[snapshot.variables[0],
    {name:"other",value:table,restoreAs:"dataframe",
      factorColumns:[{name:"rating",levels:["other"],ordered:true}]}]};
  await assert.rejects(snapshots.restore({snapshot:malformed,language:"r",generation:()=>0,
    importValue:async()=>{mutated++;return {ok:true};}}));
  assert.equal(mutated,0);
});

test("webR parser validates factor metadata, rejects ordinary classed transfer",async()=>{
  const source=session(encoded);
  assert.deepEqual(await source.r.exportVariable("frame",{forSnapshot:true}),
    {ok:true,value:table,origin:"dataframe",factorColumns});
  assert.match(source.queries[0],/factor_columns <- base::list/);
  assert.match(source.queries[0],/base::identical\(base::sort\(base::names\(base::attributes\(col\)\)\)/);
  const ordinary=session(encoded);
  assert.equal((await ordinary.r.exportVariable("frame")).ok,false);
  assert.match(ordinary.queries[0],/if \(FALSE\) for \(i in base::seq_along\(v\)\)/);
  for(const bad of [
    encoded.slice(0,-1),
    [...encoded.slice(0,-1),"wrong"],
    [...encoded,"unexpected"],
    [...encoded.slice(0,14),"2",...encoded.slice(15)],
    [...encoded.slice(0,15),"score",...encoded.slice(16)]
  ]) assert.equal((await session(bad).r.exportVariable("frame",{forSnapshot:true})).ok,false);
});

test("webR import builds actual factor columns and rejects malformed options",async()=>{
  const target=session(["ok"]);
  assert.deepEqual(await target.r.importVariable("frame",table,{asFactorColumns:factorColumns}),{ok:true});
  assert.match(target.queries[0],/base::as.data.frame/);
  assert.match(target.queries[0],/base::factor\(/);
  assert.match(target.queries[0],/ordered=TRUE/);
  const invalid=session(["ok"]);
  for(const options of [
    {asFactorColumns:[]},
    {asFactorColumns:[{name:"score",levels:["x"],ordered:false}]},
    {asFactorColumns:factorColumns,asMatrix:true},
    {asFactorColumns:factorColumns,asFactor:{levels:["low"],ordered:false}},
    {asFactorColumns:[{...factorColumns[0],ordered:"true"}]}
  ]) assert.equal((await invalid.r.importVariable("frame",table,options)).ok,false);
  assert.equal(invalid.queries.length,0);
});

test("browser workspace dispatches factor columns to the existing R interpreter",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/restoreAs==="dataframe" \? \(Array\.isArray\(dtype\) \? \{asFactorColumns:dtype\}/);
});

test("real Rscript round-trips ordered factor data.frame columns",async t=>{
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if(probe.error) return t.skip("Rscript unavailable locally; native CI must run this test");
  const setup='frame <- data.frame(rating=factor(c("low",NA_character_,"high"),'+
    'levels=c("low","middle","high"),ordered=TRUE),score=c(1.25,2.5,NA_real_))';
  const exporter=session(encoded);
  assert.equal((await exporter.r.exportVariable("frame",{forSnapshot:true})).ok,true);
  const query=exporter.queries[0];
  const result=spawnSync("Rscript",["--vanilla","-e",
    setup+"\nwriteLines(eval(parse(text="+JSON.stringify(query)+")))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(result.status,0,result.stderr);
  const actual=session(result.stdout.trim().split(/\r?\n/));
  assert.deepEqual(await actual.r.exportVariable("frame",{forSnapshot:true}),
    {ok:true,value:table,origin:"dataframe",factorColumns});
  const target=session(["ok"]);
  assert.equal((await target.r.importVariable("frame",table,{asFactorColumns:factorColumns})).ok,true);
  const restored=spawnSync("Rscript",["--vanilla","-e",
    target.queries[0]+"\nstopifnot(is.data.frame(frame), is.ordered(frame$rating), "+
    "identical(levels(frame$rating),c('low','middle','high')), "+
    "identical(as.character(frame$rating),c('low',NA_character_,'high')), "+
    "identical(frame$score,c(1.25,2.5,NA_real_)))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(restored.status,0,restored.stderr);
  const decorated=spawnSync("Rscript",["--vanilla","-e",
    setup+"\nattr(frame$rating,'extra') <- 1L\nwriteLines(eval(parse(text="+JSON.stringify(query)+")))"],
    {encoding:"utf8",timeout:20000});
  assert.notEqual(decorated.status,0,"Custom factor attributes must not be silently discarded");
});
