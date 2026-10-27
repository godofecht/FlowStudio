"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
function harness(execute) {
  const replies = [], calls = [];
  let active = 0, maxActive = 0;
  const py = {
    FS: {writeFile: () => {}},
    loadPackagesFromImports: async () => {},
    setStdout({batched}) {this.stdout = batched;},
    setStderr({batched}) {this.stderr = batched;},
    async runPythonAsync(code) {
      if (code.includes("_fs_plot_capture.prepare()")) return undefined;
      if (code.includes("_fs_plot_capture.capture()")) return "[]";
      if (code.includes("_fs_json.dumps")) return JSON.stringify({variables:[],truncated:false});
      active++; maxActive = Math.max(active, maxActive);
      try { return await execute(code, this); }
      finally {active--;}
    }
  };
  const self = {postMessage: reply => replies.push(reply)};
  vm.runInNewContext(source, {self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>"# helper"})});
  return {send:(id,op,code)=>self.onmessage({data:{id,op,code}}),
    replies,calls,get maxActive(){return maxActive;}};
}
async function waitFor(h, n) {
  for(let i=0;i<300 && h.replies.length<n;i++) await new Promise(r=>setTimeout(r,1));
  assert.equal(h.replies.length,n);
}
test("queued execution and inspection never reenter the interpreter",async()=>{
  const h=harness(async code=>{await new Promise(r=>setTimeout(r,2));return code;});
  h.send(1,"run","first");h.send(2,"inspect");h.send(3,"run","last");
  await waitFor(h,3);
  assert.deepEqual(h.replies.map(r=>r.id),[1,2,3]);
  assert.equal(h.maxActive,1);
  assert.equal(h.replies[2].output,"last");
});
test("queue rejects overflow and drains accepted work",async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const h=harness(async()=>{await gate;return "ok";});
  for(let id=1;id<=34;id++) h.send(id,"run","x");
  await waitFor(h,2);
  assert.deepEqual(h.replies.map(r=>r.id),[33,34]);
  assert.ok(h.replies.every(r=>!r.ok && /queue is full/.test(r.output)));
  release();
  await waitFor(h,34);
  assert.equal(h.replies.filter(r=>r.ok).length,32);
  assert.equal(h.maxActive,1);
});
test("stdout and stderr stay bounded while source produces excessive output",async()=>{
  const h=harness(async (code,py)=>{
    for(let i=0;i<500;i++){py.stdout("x".repeat(1024));py.stderr("y".repeat(1024));}
    return "z".repeat(200000);
  });
  h.send(1,"run","print(1)");await waitFor(h,1);
  assert.equal(h.replies[0].ok,true);
  assert.equal(h.replies[0].output.length,131072);
});
test("a failed execution does not poison subsequent queued requests",async()=>{
  const h=harness(async code=>{if(code==="bad")throw Error("boom");return "recovered";});
  h.send(1,"run","bad");h.send(2,"run","good");await waitFor(h,2);
  assert.equal(h.replies[0].ok,false);
  assert.match(h.replies[0].output,/boom/);
  assert.equal(h.replies[1].output,"recovered");
});
