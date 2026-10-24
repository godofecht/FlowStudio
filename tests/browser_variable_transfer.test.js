"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");
const {create:rCreate} = require("../docs/app/r_session.js");
const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const routes = fs.readFileSync(path.join(__dirname, "../src/data_routes.flow"), "utf8");

test("transfer wire protocol rejects objects, mixed vectors, unsafe numbers and invalid Unicode", () => {
  const ok = {kind:"vector",type:"string",values:["é", "line\nbreak", ""]};
  assert.equal(transfer.validate(ok), ok);
  for (const packet of [
    {kind:"scalar",type:"number",values:[]},
    {kind:"vector",type:"number",values:[NaN]},
    {kind:"vector",type:"number",values:[Number.MAX_SAFE_INTEGER + 1]},
    {kind:"vector",type:"number",values:[1, "2"]},
    {kind:"vector",type:"string",values:["a".repeat(513)]},
    {kind:"vector",type:"string",values:["\uD800"]},
    {kind:"vector",type:"string",values:["\0"]},
    {kind:"vector",type:"number",values:new Array(257).fill(1)},
    {kind:"scalar",type:"boolean",values:[true], extra:1}
  ]) assert.throws(() => transfer.validate(packet));
  assert.equal(transfer.validName("value_12"), true);
  assert.equal(transfer.validName("__proto__"), false);
  assert.equal(transfer.validName("x;stop()"), false);
});

function control(value="") {
  return {value,disabled:false,listeners:new Map(),
    addEventListener(type,fn){this.listeners.set(type,fn);}};
}
test("UI copies typed values in both directions and refreshes the destination", async () => {
  const direction=control("python-to-r"), source=control("measure"), destination=control("");
  const button=control(), calls=[], notices=[], refreshed=[];
  let busy=false, epoch=0;
  const packet={kind:"vector",type:"number",values:[1.25,2.5]};
  const r={
    async importVariable(name,value){calls.push(["r-import",name,value]);return {ok:true};},
    async exportVariable(name){calls.push(["r-export",name]);return {ok:true,value:packet};}
  };
  const controller=transfer.create({direction,source,destination,button,
    python:async(op,name,value)=>{calls.push(["python",op,name,value]);return op==="export"?{ok:true,value:packet}:{ok:true};},
    rSession:()=>r,notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},
    generation:()=>epoch,refresh:async lang=>refreshed.push(lang)});
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls.map(x=>x[0]),["python","r-import"]);
  assert.deepEqual(refreshed,["r"]);
  assert.match(notices.at(-1),/Transferred measure/);
  direction.value="r-to-python";destination.value="copied";
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls.slice(2).map(x=>x[0]),["r-export","python"]);
  assert.equal(calls.at(-1)[2],"copied");
  assert.deepEqual(refreshed,["r","python"]);
  assert.equal(busy,false);
  assert.equal(button.disabled,false);
});

test("reset between export and import prevents destination mutation", async () => {
  const direction=control("python-to-r"), source=control("x"), destination=control("y"), button=control();
  let epoch=0, imported=0, busy=false;
  const controller=transfer.create({direction,source,destination,button,
    python:async()=>{epoch++;return {ok:true,value:{kind:"scalar",type:"number",values:[3]}};},
    rSession:()=>({importVariable:async()=>{imported++;return {ok:true};}}),
    notice:()=>{},isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>epoch});
  assert.equal(await controller.transfer(),false);
  assert.equal(imported,0);
  assert.equal(button.disabled,false);
});

function mockR(reply) {
  const queries=[];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(code,type) {queries.push([code,type]);return reply(code);}
  }
  return {queries,session:rCreate({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
test("R export validates classless atomic wire values and import uses base assign", async () => {
  const m=mockR(code=>code.includes("base::assign")?["ok"]:["double","1.2500000000000000e+00","2.5000000000000000e+00"]);
  const exported=await m.session.exportVariable("measure");
  assert.deepEqual(exported,{ok:true,value:{kind:"vector",type:"number",values:[1.25,2.5]}});
  assert.match(m.queries[0][0],/bindingIsActive/);
  assert.match(m.queries[0][0],/is\.finite/);
  assert.match(m.queries[0][0],/format\(v, digits=17L/);
  assert.equal((await m.session.importVariable("copied",exported.value)).ok,true);
  assert.match(m.queries[1][0],/base::assign\(n, base::c\(1\.25,2\.5\), envir=\.GlobalEnv\)/);
  assert.match(m.queries[1][0],/bindingIsLocked/);
  assert.equal((await m.session.importVariable("bad;stop()",exported.value)).ok,false);
  assert.equal(m.queries.length,2);
});
test("R transfer decodes strings and rejects malformed interpreter values", async () => {
  const m=mockR(()=>["character","hello%20world","%C3%A9"]);
  assert.deepEqual((await m.session.exportVariable("labels")).value,
    {kind:"vector",type:"string",values:["hello world","é"]});
  const broken=mockR(()=>["double","NaN"]);
  assert.equal((await broken.session.exportVariable("bad")).ok,false);
});

function mockWorker(result) {
  const replies=[], queries=[];
  const py={async runPythonAsync(code){queries.push(code);return result(code);}};
  const self={postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {replies,queries,send:(id,op,code,value)=>self.onmessage({data:{id,op,code,value}})};
}
async function waitReply(h,n) {
  for(let i=0;i<100 && h.replies.length<n;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,n);
}
test("Pyodide worker export/import stays serialized and rejects unsafe packets before interpreter", async () => {
  const packet={kind:"vector",type:"boolean",values:[true,false]};
  const h=mockWorker(code=>code.includes("_fs_transfer_json.dumps")?JSON.stringify(packet):"ok");
  h.send(1,"export","flags");
  h.send(2,"import","copied",packet);
  h.send(3,"import","bad;code",packet);
  await waitReply(h,3);
  assert.deepEqual(h.replies.slice().sort((a,b)=>a.id-b.id).map(x=>x.ok),[true,true,false]);
  assert.equal(h.replies.find(x=>x.id===1).value.kind,"vector");
  assert.equal(h.queries.length,2);
  assert.match(h.queries[0],/type\(_fs_transfer_obj\) in \(list, tuple\)/);
  assert.match(h.queries[1],/globals\(\)\["copied"\]/);
  assert.ok(h.queries[0].includes("\n"));
});
test("generated Python transfer source executes under real CPython", async t => {
  const py=spawnSync("python3",["--version"],{encoding:"utf8"});
  if (py.error) return t.skip("python3 unavailable");
  const packet={kind:"vector",type:"string",values:["é", "line\nbreak"]};
  const h=mockWorker(code=>code.includes("_fs_transfer_json.dumps")?JSON.stringify(packet):"ok");
  h.send(1,"export","values");
  h.send(2,"import","copied",packet);
  await waitReply(h,2);
  const exportLines=h.queries[0].split("\n");
  exportLines[exportLines.length-1]="print("+exportLines.at(-1)+")";
  const exported=spawnSync("python3",["-c",'values = ["é", "line\\nbreak"]\n'+exportLines.join("\n")],{encoding:"utf8"});
  assert.equal(exported.status,0,exported.stderr);
  assert.deepEqual(JSON.parse(exported.stdout),packet);
  const imported=spawnSync("python3",["-c",h.queries[1]+'\nprint(copied == ["é", "line\\nbreak"])'],{encoding:"utf8"});
  assert.equal(imported.status,0,imported.stderr);
  assert.equal(imported.stdout.trim(),"True");
});
test("generated R transfer expressions execute under real Rscript when installed", async t => {
  const available=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (available.error) return t.skip("Rscript unavailable in local environment");
  const m=mockR(code=>code.includes("base::assign")?["ok"]:["double","1.25e+00","2.5e+00"]);
  const packet=(await m.session.exportVariable("measure")).value;
  await m.session.importVariable("copied",packet);
  const exportQuery=m.queries[0][0], importQuery=m.queries[1][0];
  const exported=spawnSync("Rscript",["--vanilla","-e",
    'measure <- c(1.25, 2.5)\nresult <- '+exportQuery+
    '\ncat(paste(result, collapse="\\n"))'],{encoding:"utf8"});
  assert.equal(exported.status,0,exported.stderr);
  const rows=exported.stdout.trim().split("\n");
  assert.equal(rows[0],"double");
  assert.deepEqual(rows.slice(1).map(x=>Number(decodeURIComponent(x))),[1.25,2.5]);
  const imported=spawnSync("Rscript",["--vanilla","-e",
    importQuery+'\nstopifnot(is.numeric(copied), identical(copied, c(1.25, 2.5)))'],{encoding:"utf8"});
  assert.equal(imported.status,0,imported.stderr);
  const active=spawnSync("Rscript",["--vanilla","-e",
    'makeActiveBinding("measure", function() stop("side effect"), .GlobalEnv)\n'+
    exportQuery],{encoding:"utf8"});
  assert.notEqual(active.status,0);
  assert.match(active.stderr,/Unknown or active R binding/);
});
test("browser and Flow router expose real transfer controls and asset", () => {
  for(const id of ["transferDirection","transferSource","transferDestination","transferVariable"])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/FlowStudioVariableTransfer\.create/);
  assert.match(html,/worker\.postMessage\(\{id, op, code, value\}\)/);
  assert.match(routes,/url == "\/app\/variable_transfer\.js"/);
  const start=html.indexOf("<script>"),end=html.indexOf("</script>",start);
  assert.doesNotThrow(()=>new vm.Script(html.slice(start+8,end)));
});
