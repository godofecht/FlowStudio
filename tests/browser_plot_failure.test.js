"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function setup(options = {}) {
  const calls = [], replies = [];
  let stdout = () => {};
  const python = {
    FS: {writeFile: () => calls.push("write")},
    loadPackagesFromImports: async () => calls.push("packages"),
    setStdout: ({batched}) => { stdout = batched; },
    setStderr: () => {},
    runPythonAsync: async code => {
      if (code.includes("_fs_plot_capture.prepare()")) { calls.push("prepare"); return null; }
      if (code.includes("_fs_plot_capture.capture()")) {
        calls.push("capture");
        if (options.captureError) throw new Error("PNG encoding failed");
        if (options.malformed) return "{}";
        return JSON.stringify([{number:2, png:PNG}]);
      }
      if (code.includes("_fs_json.dumps")) { calls.push("inspect"); return "[]"; }
      calls.push("execute");
      stdout("printed before error");
      if (code.includes("explode")) throw new Error("user exception");
      return 7;
    }
  };
  const self = {postMessage: reply => replies.push(reply)};
  vm.runInNewContext(source, {self, TextEncoder,
    importScripts: () => {}, loadPyodide: async () => python,
    fetch: async () => ({ok:true, text:async () => "# capture helper"})});
  async function wait(count) {
    for (let i=0;i<100 && replies.length<count;i++)
      await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length,count);
  }
  return {self,calls,replies,wait};
}

test("captures figures even when user code raises", async () => {
  const {self,calls,replies,wait} = setup();
  self.onmessage({data:{id:1,op:"run",code:"explode"}});
  await wait(1);
  assert.equal(replies[0].ok,false);
  assert.match(replies[0].output,/printed before error/);
  assert.match(replies[0].output,/user exception/);
  assert.equal(replies[0].plots[0].png,PNG);
  assert.ok(calls.indexOf("execute") < calls.indexOf("capture"));
});

test("capture failure preserves the original source exception", async () => {
  const {self,replies,wait} = setup({captureError:true});
  self.onmessage({data:{id:2,op:"run",code:"explode"}});
  await wait(1);
  assert.equal(replies[0].ok,false);
  assert.match(replies[0].output,/user exception/);
  assert.match(replies[0].plotWarning,/PNG encoding failed/);
  assert.equal(replies[0].plots.length,0);
});

test("malformed plot responses are rejected without discarding successful source output", async () => {
  const {self,replies,wait} = setup({malformed:true});
  self.onmessage({data:{id:3,op:"run",code:"x=7"}});
  await wait(1);
  assert.equal(replies[0].ok,true);
  assert.equal(replies[0].plots.length,0);
  assert.match(replies[0].plotWarning,/not an array/);
  assert.match(replies[0].output,/printed before error/);
});

test("inspection after a source exception remains serialized and successful", async () => {
  const {self,calls,replies,wait} = setup();
  self.onmessage({data:{id:4,op:"run",code:"explode"}});
  self.onmessage({data:{id:5,op:"inspect"}});
  await wait(2);
  assert.equal(replies[0].ok,false);
  assert.equal(replies[1].ok,true);
  assert.ok(calls.indexOf("capture") < calls.indexOf("inspect"));
});

test("invalid requests cannot trigger plot capture", async () => {
  const {self,calls,replies,wait} = setup();
  self.onmessage({data:{id:6,op:"run",code:"x".repeat(65537)}});
  await wait(1);
  assert.equal(replies[0].ok,false);
  assert.equal(calls.length,0);
});
