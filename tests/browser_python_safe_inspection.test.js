"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const worker = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const helper = fs.readFileSync(path.join(__dirname, "../docs/app/environment_capture.py"), "utf8");

function harness(snapshot) {
  const messages = [], writes = [], queries = [];
  let fetches = 0;
  const py = {
    FS:{writeFile(name, contents) {writes.push([name, contents]);}},
    async runPythonAsync(query) {
      queries.push(query);
      return typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
    }
  };
  const context = {
    self:{postMessage:message=>messages.push(message)},
    TextEncoder,
    importScripts:()=>{},
    loadPyodide:async()=>py,
    fetch:async()=>{fetches++;return {ok:true,text:async()=>helper};}
  };
  vm.runInNewContext(worker, context, {filename:"python-worker.js"});
  async function send(id) {
    context.self.onmessage({data:{id,op:"inspect"}});
    for(let i=0;i<100 && messages.length<id;i++)
      await new Promise(resolve=>setImmediate(resolve));
    assert.equal(messages.length,id);
    return messages[id-1];
  }
  return {send, writes, queries, get fetches(){return fetches;}};
}

test("real browser worker loads the bounded Python helper and returns nested metadata",async()=>{
  const snapshot = {variables:[{name:"records",type:"list",preview:"1 item(s)",shape:[1],
    children:[{name:"[0]",type:"int",preview:"42",shape:null}]}],truncated:false};
  const h=harness(snapshot);
  const result=await h.send(1);
  assert.equal(result.ok,true);
  assert.equal(result.variables[0].children[0].preview,"42");
  assert.equal(result.truncated,false);
  assert.equal(h.writes.length,1);
  assert.equal(h.writes[0][0],"flowstudio_environment_capture.py");
  assert.equal(h.writes[0][1],helper);
  assert.match(h.queries[0],/flowstudio_environment_capture\.capture\(globals\(\)\)/);
  assert.doesNotMatch(h.queries[0],/repr\(v\)/);
  await h.send(2);
  assert.equal(h.fetches,1);
});

test("browser rejects malformed, oversized and overdeep environment responses",async()=>{
  const invalid=[
    "not json",
    JSON.stringify({variables:[],truncated:"no"}),
    JSON.stringify({variables:[{name:"x",type:"list",preview:"x",shape:null,
      children:[{name:"a",type:"list",preview:"x",shape:null,
        children:[{name:"b",type:"list",preview:"x",shape:null,
          children:[{name:"c",type:"int",preview:"0",shape:null}]}]}]}],truncated:false}),
    JSON.stringify({variables:[{name:"x",type:"str",preview:"a".repeat(161),shape:null}],truncated:false}),
    "x".repeat(65537)
  ];
  for (const response of invalid) {
    const h=harness(response);
    const result=await h.send(1);
    assert.equal(result.ok,false);
    assert.match(result.output,/Invalid Python environment|64 KiB|JSON|Unexpected token|not valid JSON/);
  }
});
