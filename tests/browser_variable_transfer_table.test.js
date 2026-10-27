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

const table = {kind:"table",columns:[
  {name:"score",type:"number",values:[1.25,null,2.5]},
  {name:"flag",type:"boolean",values:[true,null,false]},
  {name:"label",type:"string",values:["@NA@",null,"é"]}
]};

test("bounded typed table protocol validates names, shape, types and payload size", () => {
  assert.equal(transfer.validate(table), table);
  assert.equal(transfer.validate({kind:"table",columns:[{name:"empty",type:"number",values:[]}]}).kind,"table");
  const invalid = [
    {kind:"table",columns:[]},
    {kind:"table",columns:Array(17).fill(table.columns[0])},
    {kind:"table",columns:[table.columns[0],table.columns[0]]},
    {kind:"table",columns:[table.columns[0],{name:"bad",type:"number",values:[1]}]},
    {kind:"table",columns:[{name:"bad-name",type:"string",values:["a"]}]},
    {kind:"table",columns:[{name:"x",type:"number",values:[NaN]}]},
    {kind:"table",columns:[{name:"x",type:"number",values:[Infinity]}]},
    {kind:"table",columns:[{name:"x",type:"string",values:["\uD800"]}]},
    {kind:"table",columns:[{name:"x",type:"boolean",values:[0]}]},
    {kind:"table",columns:[{name:"x",type:"string",values:["a".repeat(513)]}]},
    {kind:"table",columns:[{name:"x",type:"string",values:Array(129).fill("a")}]},
    {kind:"table",columns:[{name:"x",type:"string",values:Array(128).fill("a".repeat(512))}]},
    {...table, extra:1}
  ];
  for (const packet of invalid) assert.throws(() => transfer.validate(packet));
});

test("controller transfers typed tables through the existing serialized kernel callbacks", async () => {
  const control=value=>({value,disabled:false,addEventListener(){}});
  const direction=control("python-to-r"),source=control("data"),destination=control("copy"),button=control("");
  const calls=[],messages=[]; let busy=false;
  const controller=transfer.create({direction,source,destination,button,
    python:async(op,name,packet)=>{calls.push(["python",op,name,packet]);return op==="export"?{ok:true,value:table}:{ok:true};},
    rSession:()=>({exportVariable:async name=>{calls.push(["r-export",name]);return {ok:true,value:table};},
      importVariable:async(name,packet)=>{calls.push(["r-import",name,packet]);return {ok:true};}}),
    notice:m=>messages.push(m),isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>0});
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls[1],["r-import","copy",table]);
  direction.value="r-to-python";
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls[3],["python","import","copy",table]);
  assert.match(messages.at(-1),/3 table columns/);
});

function mockR(reply) {
  const queries=[];
  class WebR {
    async init() {}
    close() {}
    async evalRRaw(query,type) {queries.push(query);assert.equal(type,"string[]");return reply(query);}
  }
  return {queries,session:rCreate({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})})};
}
const tableRows = ["@TABLE@","3","3",
  "score","double","1.25e+00","@NA@","2.5e+00",
  "flag","logical","TRUE","@NA@","FALSE",
  "label","character","%40NA%40","@NA@","%C3%A9"];
test("webR exports real table columns and imports a data.frame expression", async () => {
  const h=mockR(q=>q.includes("base::assign")?["ok"]:tableRows);
  assert.deepEqual(await h.session.exportVariable("data"),{ok:true,value:table});
  assert.match(h.queries[0],/base::is.data.frame\(v\)/);
  assert.match(h.queries[0],/base::is.null\(base::attributes\(col\)\)/);
  assert.match(h.queries[0],/base::rownames\(v\)/);
  assert.equal((await h.session.importVariable("copy",table)).ok,true);
  assert.match(h.queries[1],/base::as.data.frame\(base::structure\(base::list\(/);
  assert.match(h.queries[1],/NA_real_/);
  assert.match(h.queries[1],/NA_character_/);
  assert.match(h.queries[1],/%40NA%40/);
  assert.match(h.queries[1],/bindingIsLocked/);
  const broken=mockR(()=>["@TABLE@","2","3","x","double","1","2","3"]);
  assert.equal((await broken.session.exportVariable("bad")).ok,false);
});

function worker() {
  const replies=[],queries=[];
  const py={async runPythonAsync(query) {
    queries.push(query);
    return query.includes("_fs_transfer_json.dumps") ? JSON.stringify(table) : "ok";
  }};
  const self={postMessage:m=>replies.push(m)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {queries,replies,send:(id,op,code,value)=>self.onmessage({data:{id,op,code,value}})};
}
async function replies(h,count) {
  for(let i=0;i<100 && h.replies.length<count;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,count);
}
test("Pyodide worker validates table packets before interpreter mutation", async () => {
  const h=worker();
  h.send(1,"export","data");
  h.send(2,"import","copy",table);
  h.send(3,"import","bad",{kind:"table",columns:[{name:"x",type:"number",values:[NaN]}]});
  h.send(4,"import","bad",{kind:"table",columns:[{name:null,type:"number",values:[1]}]});
  await replies(h,4);
  assert.deepEqual(h.replies.map(x=>x.ok),[true,true,false,false]);
  assert.equal(h.queries.length,2);
  assert.match(h.queries[0],/type\(_fs_transfer_obj\) is dict/);
  assert.match(h.queries[1],/for c in _fs_transfer_packet\['columns'\]/);
});

function runPython(source) {
  return spawnSync("python3",["-c",source],{encoding:"utf8"});
}
test("generated Python code exports and imports actual typed column dictionaries", async t => {
  if (runPython("pass").error) return t.skip("python3 unavailable");
  const h=worker();
  h.send(1,"export","data");
  h.send(2,"import","copy",table);
  await replies(h,2);
  const lines=h.queries[0].split("\n");
  lines[lines.length-1]="print("+lines.at(-1)+")";
  const original="data = {'score': [1.25, None, 2.5], 'flag': [True, None, False], 'label': ['@NA@', None, 'é']}\n";
  const result=runPython(original+lines.join("\n"));
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),table);
  const imported=runPython(h.queries[1]+"\nprint(copy == "+JSON.stringify({
    score:[1.25,null,2.5],flag:[true,null,false],label:["@NA@",null,"é"]
  }).replace(/null/g,"None").replace(/true/g,"True").replace(/false/g,"False")+")");
  assert.equal(imported.status,0,imported.stderr);
  assert.equal(imported.stdout.trim(),"True");
  for (const invalid of [
    "data = {'x': [1, 2], 'y': [3]}\n",
    "data = {'x': [None, None]}\n",
    "data = {'bad-name': [1]}\n",
    "class Sneaky(list):\n    def __iter__(self): raise RuntimeError('unexpected iterator')\ndata = {'x': Sneaky([1])}\n"
  ]) {
    const rejected=runPython(invalid+lines.join("\n"));
    assert.notEqual(rejected.status,0);
    assert.doesNotMatch(rejected.stderr,/unexpected iterator/);
  }
});

test("real Rscript round-trip preserves typed columns and rejects classed data", async t => {
  const version=spawnSync("Rscript",["--version"],{encoding:"utf8"});
  if (version.error) return t.skip("Rscript unavailable locally; required in native CI");
  const h=mockR(q=>q.includes("base::assign")?["ok"]:tableRows);
  await h.session.exportVariable("copy");
  await h.session.importVariable("copy",table);
  const exportQuery=h.queries[0],importQuery=h.queries[1];
  const result=spawnSync("Rscript",["--vanilla","-e",
    "invisible("+importQuery+")\nstopifnot(is.data.frame(copy), identical(names(copy), c('score','flag','label')), identical(copy$score, c(1.25, NA_real_, 2.5)), identical(copy$flag, c(TRUE, NA, FALSE)), identical(copy$label, c('@NA@', NA_character_, 'é')))\n"+
    "result <- "+exportQuery+"\ncat(paste(result, collapse='\\n'))"],{encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  const outputRows=result.stdout.trim().split("\n");
  assert.deepEqual(outputRows.slice(0,5),["@TABLE@","3","3","score","double"]);
  assert.equal(Number(decodeURIComponent(outputRows[5])),1.25);
  assert.equal(outputRows[6],"@NA@");
  assert.equal(Number(decodeURIComponent(outputRows[7])),2.5);
  assert.deepEqual(outputRows.slice(8),tableRows.slice(8));
  for (const invalid of [
    "copy <- data.frame(x=factor(c('a','b')))",
    "copy <- data.frame(x=1:2); rownames(copy) <- c('a','b')",
    "copy <- data.frame(x=c(Inf,1))",
    "copy <- data.frame(x=1:129)"
  ]) {
    const rejected=spawnSync("Rscript",["--vanilla","-e",invalid+"\n"+exportQuery],{encoding:"utf8"});
    assert.notEqual(rejected.status,0);
  }
});
