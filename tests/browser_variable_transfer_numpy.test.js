"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");

const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const example = {kind:"vector",type:"number",values:[1.25,null,2.5]};

async function exportQuery() {
  const queries = [], replies = [];
  const py = {async runPythonAsync(query) {
    queries.push(query);
    return JSON.stringify(example);
  }};
  const self = {postMessage:message=>replies.push(message)};
  vm.runInNewContext(workerSource, {self, TextEncoder, importScripts:()=>{},
    loadPyodide:async()=>py, fetch:async()=>({ok:true,text:async()=>""})});
  self.onmessage({data:{id:1,op:"export",code:"data"}});
  for (let i=0; i<100 && !replies.length; i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(replies.length,1,"Python worker did not respond");
  assert.equal(replies[0].ok,true);
  assert.equal(queries.length,1);
  return queries[0];
}

function runPython(query, setup) {
  const lines = query.split("\n");
  lines[lines.length - 1] = "print(" + lines.at(-1) + ")";
  return spawnSync("python3",["-c",setup + "\n" + lines.join("\n")],
    {encoding:"utf8"});
}

function requireNumpy(t) {
  const probe = spawnSync("python3",["-c","import numpy"],{encoding:"utf8"});
  if (probe.status === 0) return true;
  if (process.env.FLOWSTUDIO_REQUIRE_PANDAS === "1")
    assert.fail("NumPy required by pinned pandas CI acceptance: " +
      (probe.stderr || probe.error || "import failed"));
  t.skip("NumPy not installed; no real array acceptance claimed");
  return false;
}

test("NumPy vector export retains existing typed packet and worker limits", async () => {
  const query = await exportQuery();
  assert.match(query,/type\(_fs_transfer_obj\) is _fs_transfer_np.ndarray/);
  assert.match(query,/NumPy vector requires 1-256 elements and exactly one dimension/);
  assert.match(query,/Unsupported NumPy vector dtype/);
  assert.match(query,/allow_nan=False/);
  assert.equal(transfer.validate(example),example);
});

test("real NumPy integer, floating, boolean arrays export as R-compatible vectors", async t => {
  if (!requireNumpy(t)) return;
  const query = await exportQuery();
  const examples = [
    ["np.array([-2, 3], dtype=np.int8)",{kind:"vector",type:"number",values:[-2,3]}],
    ["np.array([4, 5], dtype=np.uint64)",{kind:"vector",type:"number",values:[4,5]}],
    ["np.array([1.25, np.nan, 2.5], dtype=np.float32)",example],
    ["np.array([1.5, 2], dtype=np.float16)",{kind:"vector",type:"number",values:[1.5,2]}],
    ["np.array([True, False], dtype=np.bool_)",{kind:"vector",type:"boolean",values:[true,false]}],
    ["np.array(['café', '東京', '🙂'], dtype='U4')",{kind:"vector",type:"string",values:["café","東京","🙂"]}]
  ];
  for (const [expression, expected] of examples) {
    const result = runPython(query,"import numpy as np\ndata = " + expression);
    assert.equal(result.status,0,expression + ": " + result.stderr);
    const packet = JSON.parse(result.stdout);
    assert.deepEqual(packet,expected);
    assert.equal(transfer.validate(packet),packet);
  }
});

test("NumPy transfer rejects unsafe dimensions, types and values", async t => {
  if (!requireNumpy(t)) return;
  const query = await exportQuery();
  const invalid = [
    "np.array([], dtype=np.float64)",
    "np.ones((2,2,2), dtype=np.float64)",
    "np.array(3, dtype=np.int32)",
    "np.ones(257, dtype=np.float64)",
    "np.array([9007199254740992], dtype=np.uint64)",
    "np.array([float('inf')], dtype=np.float64)",
    "np.array([float('nan')], dtype=np.float64)",
    "np.array([1+2j], dtype=np.complex128)",
    "np.array([b'x'], dtype='S1')",
    "np.array(['x'], dtype='U513')",
    "np.array(['x\\x00y'], dtype='U3')",
    "np.array([None], dtype=object)",
    "np.array([(1,2)], dtype=[('a','i4'),('b','i4')])"
  ];
  for (const expression of invalid) {
    const result = runPython(query,"import numpy as np\ndata = " + expression);
    assert.notEqual(result.status,0,"Unexpectedly exported " + expression);
  }
});

test("NumPy subclasses and object arrays never invoke user-defined traversal", async t => {
  if (!requireNumpy(t)) return;
  const query = await exportQuery();
  const cases = [
    "class Trap(np.ndarray):\n def tolist(self): raise RuntimeError('unsafe traversal')\ndata = np.array([1,2]).view(Trap)",
    "class Trap:\n def __str__(self): raise RuntimeError('unsafe repr')\n def __float__(self): raise RuntimeError('unsafe coercion')\ndata = np.array([Trap()],dtype=object)"
  ];
  for (const setup of cases) {
    const result = runPython(query,"import numpy as np\n" + setup);
    assert.notEqual(result.status,0,"Unsafe object unexpectedly transferred");
    assert.doesNotMatch(result.stderr,/unsafe traversal|unsafe repr|unsafe coercion/);
  }
});

test("ordinary list transfer still works without importing NumPy", async () => {
  const query = await exportQuery();
  const result = runPython(query,
    "data = [1.25, None, 2.5]\nassert 'numpy' not in __import__('sys').modules");
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),example);
});
