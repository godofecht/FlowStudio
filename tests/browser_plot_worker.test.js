"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
function workerFixture() {
  const replies = [], calls = [];
  const python = {
    FS: {writeFile: () => calls.push("write")},
    loadPackagesFromImports: async () => calls.push("packages"),
    setStdout: () => {}, setStderr: () => {},
    runPythonAsync: async code => {
      if (code.includes("_fs_plot_capture.prepare()")) {calls.push("prepare"); return null;}
      if (code.includes("_fs_plot_capture.capture()")) {calls.push("capture"); return "[]";}
      if (code.includes("_fs_json.dumps")) {calls.push("inspect"); return JSON.stringify({variables:[],truncated:false});}
      calls.push("execute"); return 42;
    }
  };
  const self = {postMessage: response => replies.push(response)};
  vm.runInNewContext(source, {self, TextEncoder, importScripts: () => {},
    loadPyodide: async () => python,
    fetch: async () => ({ok:true, text:async () => "# helper"})});
  return {self, replies, calls};
}
async function wait(replies, count) {
  for (let i=0; i<100 && replies.length<count; i++)
    await new Promise(resolve => setImmediate(resolve));
  assert.equal(replies.length, count);
}
test("plot capture follows source execution", async () => {
  const {self,replies,calls} = workerFixture();
  self.onmessage({data:{id:1,op:"run",code:"x=42"}});
  await wait(replies,1);
  assert.equal(replies[0].ok,true);
  assert.ok(calls.indexOf("execute") < calls.indexOf("capture"));
});
test("inspection cannot overtake plotting", async () => {
  const {self,replies,calls} = workerFixture();
  self.onmessage({data:{id:1,op:"run",code:"x=42"}});
  self.onmessage({data:{id:2,op:"inspect"}});
  await wait(replies,2);
  assert.ok(calls.indexOf("capture") < calls.indexOf("inspect"));
});
