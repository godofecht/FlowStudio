"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");
const {create:rCreate} = require("../docs/app/r_session.js");

const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");

test("typed vector protocol preserves missing values without admitting untyped scalars", () => {
  for (const packet of [
    {kind:"vector", type:"number", values:[1.25,null,2.5]},
    {kind:"vector", type:"boolean", values:[true,null,false]},
    {kind:"vector", type:"string", values:["@NA@",null,"é"]},
    {kind:"vector", type:"number", values:[null,null]}
  ]) assert.equal(transfer.validate(packet), packet);
  for (const packet of [
    {kind:"scalar", type:"number", values:[null]},
    {kind:"vector", type:"number", values:[null,NaN]},
    {kind:"vector", type:"number", values:[null,Infinity]},
    {kind:"vector", type:"boolean", values:[null,0]},
    {kind:"vector", type:"string", values:[null,"\uD800"]},
    {kind:"vector", type:"number", values:Array(257).fill(null)}
  ]) assert.throws(() => transfer.validate(packet));
});

test("transfer controller forwards missing values unchanged in both directions", async () => {
  const control=value=>({value,disabled:false,addEventListener(){}});
  const direction=control("python-to-r"), source=control("samples"),
    destination=control("copied"), button=control("");
  const packet={kind:"vector",type:"string",values:["@NA@",null,"é"]};
  const imports=[], notices=[];
  let busy=false;
  const controller=transfer.create({
    direction,source,destination,button,
    python:async(op,name,value)=>{
      if(op==="export") return {ok:true,value:packet};
      imports.push(["python",name,value]);return {ok:true};
    },
    rSession:()=>({
      exportVariable:async()=>({ok:true,value:packet}),
      importVariable:async(name,value)=>{imports.push(["r",name,value]);return {ok:true};}
    }),
    notice:message=>notices.push(message),isBusy:()=>busy,setBusy:value=>{busy=value;},
    generation:()=>0
  });
  assert.equal(await controller.transfer(),true);
  direction.value="r-to-python";
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(imports,[["r","copied",packet],["python","copied",packet]]);
  assert.equal(button.disabled,false);
  assert.equal(busy,false);
  assert.match(notices.at(-1),/Transferred samples/);
});

function workerHarness() {
  const replies=[], queries=[];
  const py={async runPythonAsync(code) {
    queries.push(code);
    return code.includes("_fs_transfer_json.dumps")
      ? JSON.stringify({kind:"vector",type:"number",values:[1,null,2.5]}) : "ok";
  }};
  const self={postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {replies,queries,send:(id,op,code,value)=>self.onmessage({data:{id,op,code,value}})};
}
async function waitReplies(h, count) {
  for(let i=0;i<100 && h.replies.length<count;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,count);
}
function pythonRun(source) {
  return spawnSync("python3",["-c",source],{encoding:"utf8"});
}
function printedPythonQuery(query) {
  const lines=query.split("\n");
  const last=lines.pop();
  return lines.join("\n")+"\nprint("+last+")";
}

test("Pyodide transfer imports null as None and exports typed missing vectors", async () => {
  const h=workerHarness();
  const packet={kind:"vector",type:"number",values:[1,null,2.5]};
  h.send(1,"export","measure");
  h.send(2,"import","copied",packet);
  h.send(3,"import","bad",{kind:"scalar",type:"number",values:[null]});
  await waitReplies(h,3);
  assert.deepEqual(h.replies.map(x=>x.ok),[true,true,false]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.replies[0].value)),packet);
  assert.equal(h.queries.length,2);
  assert.match(h.queries[0],/_fs_transfer_present/);
  assert.match(h.queries[0],/if v is not None/);
  assert.match(h.queries[1],/globals\(\)\["copied"\]/);
  const available=pythonRun("print('ok')");
  if (available.error) return;
  const exported=pythonRun("measure = [1, None, 2.5]\n"+printedPythonQuery(h.queries[0]));
  assert.equal(exported.status,0,exported.stderr);
  assert.deepEqual(JSON.parse(exported.stdout),packet);
  const imported=pythonRun(h.queries[1]+"\nprint(copied == [1, None, 2.5])");
  assert.equal(imported.status,0,imported.stderr);
  assert.equal(imported.stdout.trim(),"True");
  const allMissing=pythonRun("measure = [None, None]\n"+printedPythonQuery(h.queries[0]));
  assert.notEqual(allMissing.status,0);
  assert.match(allMissing.stderr,/homogeneous plain scalar/);
  const mixed=pythonRun("measure = [1, None, 'bad']\n"+printedPythonQuery(h.queries[0]));
  assert.notEqual(mixed.status,0);
  assert.match(mixed.stderr,/homogeneous plain scalar/);
  const subclass=pythonRun("class Sneaky(list):\n    def __iter__(self):\n        raise RuntimeError('must not iterate')\nmeasure = Sneaky([1,None])\n"+printedPythonQuery(h.queries[0]));
  assert.notEqual(subclass.status,0);
  assert.doesNotMatch(subclass.stderr,/must not iterate/);
});

function rHarness() {
  const queries=[];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(code) {
      queries.push(code);
      return code.includes("base::assign") ? ["ok"] :
        ["double","1.25e+00","@NA@","2.5e+00"];
    }
  }
  return {queries,session:rCreate({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
test("webR typed NA import/export preserves values and distinct literal strings", async () => {
  const m=rHarness();
  const result=await m.session.exportVariable("measure");
  assert.deepEqual(result,{ok:true,value:{kind:"vector",type:"number",values:[1.25,null,2.5]}});
  assert.match(m.queries[0],/is\.nan\(v\)/);
  assert.match(m.queries[0],/is\.na\(v\[\[i\]\]\)/);
  assert.match(m.queries[0],/URLencode\(s\[\[i\]\], reserved=TRUE\)/);
  assert.equal((await m.session.importVariable("copy",result.value)).ok,true);
  assert.match(m.queries[1],/base::c\(1\.25,NA_real_,2\.5\)/);
  assert.equal((await m.session.importVariable("flags",
    {kind:"vector",type:"boolean",values:[true,null,false]})).ok,true);
  assert.match(m.queries.at(-1),/base::c\(TRUE,NA,FALSE\)/);
  assert.equal((await m.session.importVariable("labels",
    {kind:"vector",type:"string",values:["@NA@",null,"é"]})).ok,true);
  assert.match(m.queries.at(-1),/NA_character_/);
  assert.match(m.queries.at(-1),/%40NA%40/);
  assert.equal((await m.session.importVariable("missing",
    {kind:"vector",type:"number",values:[null,null]})).ok,true);
  assert.match(m.queries.at(-1),/base::c\(NA_real_,NA_real_\)/);
});

test("actual Rscript distinguishes typed NA, NaN, Inf and literal sentinel", async t => {
  const version=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (version.error) return t.skip("Rscript unavailable; CI with R must exercise this");
  const m=rHarness();
  await m.session.exportVariable("measure");
  const query=m.queries[0];
  function run(prefix) {
    return spawnSync("Rscript",["--vanilla","-e",
      prefix+"\nresult <- "+query+"\ncat(paste(result,collapse='\\n'))"],{encoding:"utf8"});
  }
  const numeric=run("measure <- c(1.25, NA_real_, 2.5)");
  assert.equal(numeric.status,0,numeric.stderr);
  assert.deepEqual(numeric.stdout.trim().split("\n").map((s,i)=>i===0?s:s==="@NA@"?null:Number(decodeURIComponent(s))),
    ["double",1.25,null,2.5]);
  const labels=run("measure <- c('@NA@', NA_character_, 'é')");
  assert.equal(labels.status,0,labels.stderr);
  assert.deepEqual(labels.stdout.trim().split("\n").map((s,i)=>i===0?s:s==="@NA@"?null:decodeURIComponent(s)),
    ["character","@NA@",null,"é"]);
  for (const invalid of ["measure <- c(NaN, 1)","measure <- c(Inf, NA_real_)"]) {
    const result=run(invalid);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/not finite or safe/);
  }
  const m2=rHarness();
  await m2.session.importVariable("copy",
    {kind:"vector",type:"number",values:[1.25,null,2.5]});
  const imported=spawnSync("Rscript",["--vanilla","-e",m2.queries[0]+
    "\nstopifnot(identical(copy,c(1.25,NA_real_,2.5)))"],{encoding:"utf8"});
  assert.equal(imported.status,0,imported.stderr);
});
