"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");
const {create: createRSession} = require("../docs/app/r_session.js");

const numeric = {kind:"table",columns:[
  {name:"V1",type:"number",values:[1.25,null]},
  {name:"V2",type:"number",values:[3,4]}
]};
const unicode = {kind:"table",columns:[
  {name:"V1",type:"string",values:["é","東京"]},
  {name:"V2",type:"string",values:["🙂",""]}
]};
function session(reply = ["ok"]) {
  const queries = [];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query, type) {
      assert.equal(type, "string[]");
      queries.push(query);
      return reply;
    }
  }
  return {queries, r:createRSession({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
function control(value = "") {
  return {value,checked:false,disabled:false,addEventListener(){}};
}
function controller(packet, asMatrix = true) {
  const direction=control("python-to-r"), source=control("source"), destination=control("target");
  const button=control(), rMatrix=control(), notices=[], imports=[];
  rMatrix.checked=asMatrix;
  let busy=false;
  const c=transfer.create({direction,source,destination,button,rMatrix,
    python:async op=>{assert.equal(op,"export");return {ok:true,value:packet};},
    rSession:()=>({async importVariable(...args){imports.push(args);return {ok:true};}}),
    notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},
    generation:()=>0});
  return {c,imports,notices};
}

test("opt-in Python 2D table reaches R matrix importer without changing default tables", async () => {
  const m=controller(numeric);
  assert.equal(await m.c.transfer(),true);
  assert.equal(m.imports.length,1);
  assert.deepEqual(m.imports[0],[ "target", numeric, {asMatrix:true} ]);
  assert.match(m.notices.at(-1),/as R matrix/);
  const ordinary=controller(numeric,false);
  assert.equal(await ordinary.c.transfer(),true);
  assert.equal(ordinary.imports[0][2],undefined);
});
test("R matrix option rejects heterogeneous, empty and non-table values before mutation", async () => {
  const bad=[
    {kind:"vector",type:"number",values:[1,2]},
    {kind:"table",columns:[{name:"V1",type:"number",values:[]}]},
    {kind:"table",columns:[
      {name:"V1",type:"number",values:[1]},
      {name:"V2",type:"string",values:["a"]}
    ]}
  ];
  for(const packet of bad) {
    const m=controller(packet);
    assert.equal(await m.c.transfer(),false);
    assert.equal(m.imports.length,0);
    assert.match(m.notices.at(-1),/matrix destination requires/);
    const r=session();
    assert.equal((await r.r.importVariable("target",packet,{asMatrix:true})).ok,false);
    assert.equal(r.queries.length,0);
  }
});
test("webR generates bounded column-major matrix expressions, preserving typed NA and Unicode", async () => {
  const m=session();
  assert.equal((await m.r.importVariable("numeric_matrix",numeric,{asMatrix:true})).ok,true);
  assert.match(m.queries[0],/base::matrix\(base::c\(1\.25,NA_real_,3,4\), nrow=2L, ncol=2L\)/);
  assert.match(m.queries[0],/bindingIsActive/);
  assert.match(m.queries[0],/bindingIsLocked/);
  assert.equal((await m.r.importVariable("text_matrix",unicode,{asMatrix:true})).ok,true);
  assert.match(m.queries[1],/base::matrix\(/);
  assert.match(m.queries[1],/utils::URLdecode\("%C3%A9"\)/);
  assert.match(m.queries[1],/utils::URLdecode\("%F0%9F%99%82"\)/);
  assert.equal((await m.r.importVariable("ordinary",numeric)).ok,true);
  assert.match(m.queries[2],/base::as.data.frame\(/);
  assert.doesNotMatch(m.queries[2],/base::matrix\(/);
  for(const options of [null,[],{asMatrix:"true"},{asMatrix:true,extra:true}])
    assert.equal((await m.r.importVariable("bad",numeric,options)).ok,false);
  assert.equal(m.queries.length,3);
});
test("real Rscript constructs numeric, boolean and Unicode matrices and protects active bindings", async t => {
  const probe=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if(probe.error) return t.skip("Rscript unavailable; native CI must execute this acceptance");
  const cases=[
    [numeric,"stopifnot(is.matrix(target), identical(dim(target),c(2L,2L)), "+
      "is.double(target), target[1,1]==1.25, is.na(target[2,1]), "+
      "target[1,2]==3, target[2,2]==4)"],
    [unicode,"stopifnot(is.matrix(target), identical(dim(target),c(2L,2L)), "+
      "identical(target[,1],c('é','東京')), identical(target[,2],c('🙂','')))"],
    [{kind:"table",columns:[
      {name:"V1",type:"boolean",values:[true,null]},
      {name:"V2",type:"boolean",values:[false,true]}
    ]},"stopifnot(is.matrix(target), is.logical(target), "+
      "identical(target[,1],c(TRUE,NA)), identical(target[,2],c(FALSE,TRUE)))"]
  ];
  for(const [packet,check] of cases) {
    const m=session();
    assert.equal((await m.r.importVariable("target",packet,{asMatrix:true})).ok,true);
    const result=spawnSync("Rscript",["--vanilla","-e",m.queries[0]+"\n"+check],{encoding:"utf8"});
    assert.equal(result.status,0,result.stderr);
  }
  const m=session();
  await m.r.importVariable("target",numeric,{asMatrix:true});
  const protectedBinding=spawnSync("Rscript",["--vanilla","-e",
    'makeActiveBinding("target",function(value) stop("side effect"),.GlobalEnv)\n'+m.queries[0]],
    {encoding:"utf8"});
  assert.notEqual(protectedBinding.status,0);
  assert.match(protectedBinding.stderr,/Cannot replace active or locked R binding/);
  assert.doesNotMatch(protectedBinding.stderr,/side effect/);
});
