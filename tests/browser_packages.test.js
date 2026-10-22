"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");

function harness(options = {}) {
  const replies = [], calls = [];
  let active = 0, maxActive = 0;
  const python = {
    FS: {writeFile() {}},
    setStdout() {}, setStderr() {},
    loadPackagesFromImports: async () => {},
    loadPackage: async name => { calls.push(["load", name]); },
    runPythonAsync: async code => {
      active++; maxActive = Math.max(maxActive, active);
      calls.push(["python", code]);
      try {
        await new Promise(resolve => setImmediate(resolve));
        if (code.includes("_fs_md.distributions()"))
          return options.invalidInventory ? "{}" : JSON.stringify([{name:"numpy",version:"2.1.0"}]);
        if (code.includes("_fs_micropip.install(")) {
          if (options.installFailure) throw Error("Package unavailable");
          return null;
        }
        if (code.includes("_fs_json.dumps")) return "[]";
        if (code.includes("_fs_plot_capture.capture()")) return "[]";
        return null;
      } finally { active--; }
    }
  };
  const self = {postMessage: data => replies.push(data)};
  vm.runInNewContext(source, {self, TextEncoder,
    importScripts: () => {}, loadPyodide: async () => python,
    fetch: async () => ({ok:true, text:async () => "# capture helper"})});
  async function wait(n) {
    for (let i=0;i<200 && replies.length<n;i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(replies.length,n);
  }
  return {self, replies, calls, wait, get maxActive() {return maxActive;}};
}

test("lists installed Python distributions from the live interpreter", async () => {
  const h = harness();
  h.self.onmessage({data:{id:1,op:"packages"}});
  await h.wait(1);
  assert.equal(h.replies[0].ok,true);
  assert.equal(h.replies[0].packages[0].name,"numpy");
  assert.ok(h.calls.some(([,code]) => code.includes("importlib.metadata")));
});

test("installs a pinned package via micropip without evaluating user input as Python", async () => {
  const h = harness();
  h.self.onmessage({data:{id:2,op:"install",code:"attrs==25.1.0"}});
  await h.wait(1);
  assert.equal(h.replies[0].ok,true);
  assert.deepEqual(h.calls[0],["load","micropip"]);
  assert.match(h.calls[1][1], /_fs_micropip\.install\("attrs==25\.1\.0"\)/);
});

test("rejects injection, URLs and overly long package names before initializing Python", async () => {
  const h = harness();
  for (const code of ["os;import sys", "https://example.org/pkg.whl", "-bad", "x".repeat(200)])
    h.self.onmessage({data:{id:h.replies.length+1,op:"install",code}});
  await h.wait(4);
  assert.ok(h.replies.every(r => r.ok === false));
  assert.equal(h.calls.length,0);
});

test("rejects malformed package inventory", async () => {
  const h = harness({invalidInventory:true});
  h.self.onmessage({data:{id:3,op:"packages"}});
  await h.wait(1);
  assert.equal(h.replies[0].ok,false);
  assert.match(h.replies[0].output,/Invalid Python package inventory/);
});

test("installation failures are surfaced without claiming success", async () => {
  const h = harness({installFailure:true});
  h.self.onmessage({data:{id:4,op:"install",code:"missing-package"}});
  await h.wait(1);
  assert.equal(h.replies[0].ok,false);
  assert.match(h.replies[0].output,/Package unavailable/);
});

test("install, inspect and package inventory cannot overlap", async () => {
  const h = harness();
  h.self.onmessage({data:{id:5,op:"install",code:"attrs"}});
  h.self.onmessage({data:{id:6,op:"inspect"}});
  h.self.onmessage({data:{id:7,op:"packages"}});
  await h.wait(3);
  assert.equal(h.maxActive,1);
  assert.deepEqual(h.replies.map(x=>x.id),[5,6,7]);
  assert.ok(h.replies.every(x=>x.ok));
});
