"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const snapshots = require("../docs/app/session_snapshot.js");
const {create:createRSession} = require("../docs/app/r_session.js");

const table = {kind:"table",columns:[{name:"score",type:"number",values:[1.25,2.5]}]};
const rowNames = ["alpha","βeta"];
const frame = {format:snapshots.FORMAT_V2,language:"r",omitted:0,truncated:false,
  variables:[{name:"frame",value:table,restoreAs:"dataframe",rowNames}]};
const encoded = ["@FRAME_ROWS@","1","2","score","double","1.25","2.5",
  "@ROW_NAMES@","2","alpha","%CE%B2eta"];
const factorTable = {kind:"table",columns:[
  {name:"rating",type:"string",values:["low","high"]},
  {name:"score",type:"number",values:[1,2]}
]};
const factorColumns = [{name:"rating",levels:["low","middle","high"],ordered:true}];
const combined = ["@FRAME_FACTORS_ROWS@","2","2","rating","character","low","high",
  "score","double","1","2","@FACTOR_COLUMNS@","1","rating","1","3",
  "low","middle","high","@ROW_NAMES@","2","alpha","%CE%B2eta"];
function session(rows) {
  const queries=[];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query,type) {
      assert.equal(type,"string[]");
      queries.push(query);
      return rows;
    }
  }
  return {queries,r:createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}

test("strict snapshot preflight validates row names independently of factor columns",()=>{
  assert.deepEqual(snapshots.validate(frame),frame);
  const both={...frame,variables:[{...frame.variables[0],value:factorTable,
    factorColumns}]};
  assert.deepEqual(snapshots.validate(both),both);
  for (const names of [
    [],["only-one"],["same","same"],["alpha",null],["alpha",1],
    ["alpha",""],["alpha","a".repeat(513)],["alpha","bad\0name"],
    ["alpha","\ud800"]
  ]) {
    assert.throws(()=>snapshots.validate({...frame,variables:[
      {...frame.variables[0],rowNames:names}]}));
  }
  for (const bad of [
    {...frame,format:snapshots.FORMAT},
    {...frame,language:"python"},
    {...frame,variables:[{...frame.variables[0],restoreAs:"matrix"}]},
    {...frame,variables:[{...frame.variables[0],rowNames,unexpected:true}]},
    {...frame,variables:[{...frame.variables[0],factorColumns:[]}]}
  ]) assert.throws(()=>snapshots.validate(bad));
});

test("snapshot capture records actual R row-name provenance and skips forged metadata",async()=>{
  const result=await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"frame"}]}),
    exportValue:async()=>({ok:true,value:table,origin:"dataframe",rowNames})});
  assert.deepEqual(result.variables,frame.variables);
  assert.equal(result.format,snapshots.FORMAT_V2);
  const forged=await snapshots.capture({language:"r",generation:()=>0,
    inspect:async()=>({ok:true,variables:[{name:"frame"}]}),
    exportValue:async()=>({ok:true,value:table,origin:"dataframe",rowNames:["a","a"]})});
  assert.equal(forged.omitted,1);
  assert.equal(forged.variables.length,0);
});

test("snapshot restore passes validated row names without mutating on malformed preflight",async()=>{
  const calls=[];
  assert.equal(await snapshots.restore({snapshot:frame,language:"r",generation:()=>0,
    importValue:async(...args)=>{calls.push(args);return {ok:true};}}),1);
  assert.deepEqual(calls,[["r","frame",table,"dataframe",
    {factorColumns:[],rowNames}]]);
  const both={...frame,variables:[{...frame.variables[0],value:factorTable,
    factorColumns}]};
  calls.length=0;
  assert.equal(await snapshots.restore({snapshot:both,language:"r",generation:()=>0,
    importValue:async(...args)=>{calls.push(args);return {ok:true};}}),1);
  assert.deepEqual(calls[0][4],{factorColumns,rowNames});
  let mutated=0;
  await assert.rejects(snapshots.restore({snapshot:{...frame,variables:[
    frame.variables[0],{name:"bad",value:table,restoreAs:"dataframe",
      rowNames:["x","x"]}]},language:"r",generation:()=>0,
    importValue:async()=>{mutated++;return {ok:true};}}));
  assert.equal(mutated,0);
});

test("webR snapshot exporter parses row names without allowing ordinary lossy transfer",async()=>{
  const plain=session(encoded);
  assert.deepEqual(await plain.r.exportVariable("frame",{forSnapshot:true}),
    {ok:true,value:table,origin:"dataframe",rowNames});
  assert.match(plain.queries[0],/custom_rows/);
  const factors=session(combined);
  assert.deepEqual(await factors.r.exportVariable("frame",{forSnapshot:true}),
    {ok:true,value:factorTable,origin:"dataframe",factorColumns,rowNames});
  assert.equal((await session(encoded).r.exportVariable("frame")).ok,false);
  for (const malformed of [
    encoded.slice(0,-1),[...encoded,"unexpected"],
    [...encoded.slice(0,-1),"alpha"],
    [...encoded.slice(0,8),"3",...encoded.slice(9)],
    [...encoded.slice(0,7),"@FACTOR_COLUMNS@",...encoded.slice(8)],
    [...combined,"extra"]
  ]) assert.equal((await session(malformed).r.exportVariable("frame",{forSnapshot:true})).ok,false);
});

test("webR importer validates row-name options before generating any R code",async()=>{
  const target=session(["ok"]);
  assert.deepEqual(await target.r.importVariable("frame",table,{asRowNames:rowNames,asFactorColumns:[]}),
    {ok:true});
  assert.match(target.queries[0],/row.names<-/);
  const combinedTarget=session(["ok"]);
  assert.equal((await combinedTarget.r.importVariable("frame",factorTable,
    {asFactorColumns:factorColumns,asRowNames:rowNames})).ok,true);
  assert.match(combinedTarget.queries[0],/base::factor/);
  for (const options of [
    {asRowNames:["same","same"]},{asRowNames:["short"]},
    {asRowNames:rowNames,asMatrix:true},
    {asRowNames:rowNames,asFactor:{levels:["x"],ordered:false}},
    {asRowNames:rowNames,asFactorColumns:[{name:"score",levels:["x"],ordered:false}]}
  ]) {
    const invalid=session(["ok"]);
    assert.equal((await invalid.r.importVariable("frame",table,options)).ok,false);
    assert.equal(invalid.queries.length,0);
  }
});

test("browser snapshot restoration routes row-name metadata to the actual R session",()=>{
  const html=fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/asRowNames:dtype\.rowNames/);
  assert.match(html,/Array\.isArray\(dtype\)/);
});

test("real Rscript exports and reconstructs custom row names and factor columns",async t=>{
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (probe.error) return t.skip("Rscript unavailable locally; native CI must run this test");
  const setup="frame <- data.frame(score=c(1.25,2.5), row.names=c('alpha','βeta'))";
  const source=session(encoded);
  assert.equal((await source.r.exportVariable("frame",{forSnapshot:true})).ok,true);
  const query=source.queries[0];
  const actual=spawnSync("Rscript",["--vanilla","-e",
    setup+"\nwriteLines(eval(parse(text="+JSON.stringify(query)+")))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(actual.status,0,actual.stderr);
  const decoded=session(actual.stdout.trim().split(/\r?\n/));
  assert.deepEqual(await decoded.r.exportVariable("frame",{forSnapshot:true}),
    {ok:true,value:table,origin:"dataframe",rowNames});
  const target=session(["ok"]);
  assert.equal((await target.r.importVariable("frame",table,{asRowNames:rowNames})).ok,true);
  const restored=spawnSync("Rscript",["--vanilla","-e",
    target.queries[0]+"\nstopifnot(identical(rownames(frame),c('alpha','βeta')), "+
    "identical(frame$score,c(1.25,2.5)))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(restored.status,0,restored.stderr);
  const setupFactors="frame <- data.frame(rating=factor(c('low','high'), "+
    "levels=c('low','middle','high'),ordered=TRUE),score=c(1,2), "+
    "row.names=c('alpha','βeta'))";
  const factorSource=session(combined);
  assert.equal((await factorSource.r.exportVariable("frame",{forSnapshot:true})).ok,true);
  const factorResult=spawnSync("Rscript",["--vanilla","-e",
    setupFactors+"\nwriteLines(eval(parse(text="+JSON.stringify(factorSource.queries[0])+")))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(factorResult.status,0,factorResult.stderr);
  assert.deepEqual(await session(factorResult.stdout.trim().split(/\r?\n/))
    .r.exportVariable("frame",{forSnapshot:true}),
    {ok:true,value:factorTable,origin:"dataframe",factorColumns,rowNames});
  const factorTarget=session(["ok"]);
  assert.equal((await factorTarget.r.importVariable("frame",factorTable,
    {asFactorColumns:factorColumns,asRowNames:rowNames})).ok,true);
  const factorRestored=spawnSync("Rscript",["--vanilla","-e",
    factorTarget.queries[0]+"\nstopifnot(is.ordered(frame$rating), "+
    "identical(levels(frame$rating),c('low','middle','high')), "+
    "identical(rownames(frame),c('alpha','βeta')))"],
    {encoding:"utf8",timeout:20000});
  assert.equal(factorRestored.status,0,factorRestored.stderr);
  const ordinary=spawnSync("Rscript",["--vanilla","-e",
    setup+"\nwriteLines(eval(parse(text="+JSON.stringify(
      (await session(encoded).r.exportVariable("frame")).output || query)+")))"],
    {encoding:"utf8",timeout:20000});
  // Ordinary transfer is intentionally not allowed to discard row-name identity.
  // The same query with forSnapshot=FALSE must reject the nondefault labels.
  const ordinarySource=session(encoded);
  await ordinarySource.r.exportVariable("frame");
  const rejected=spawnSync("Rscript",["--vanilla","-e",
    setup+"\nwriteLines(eval(parse(text="+JSON.stringify(ordinarySource.queries[0])+")))"],
    {encoding:"utf8",timeout:20000});
  assert.notEqual(rejected.status,0);
});
