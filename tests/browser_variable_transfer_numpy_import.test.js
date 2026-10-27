"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {spawnSync} = require("node:child_process");
const transfer = require("../docs/app/variable_transfer.js");

const workerSource = fs.readFileSync(path.join(__dirname, "../docs/app/python-worker.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
const numberPacket = {kind:"vector",type:"number",values:[1.25,null,2.5]};
const boolPacket = {kind:"vector",type:"boolean",values:[true,false]};
const control = value => ({value,disabled:false,addEventListener(){}});
function harness(options={}) {
  const queries=[], loaded=[], replies=[];
  const py = {
    async loadPackage(name) {
      loaded.push(name);
      if (options.loadError) throw Error("NumPy package unavailable");
    },
    async runPythonAsync(query) {queries.push(query);return options.ack || "ok";}
  };
  const self = {postMessage:reply=>replies.push(reply)};
  vm.runInNewContext(workerSource,{self,TextEncoder,importScripts:()=>{},
    loadPyodide:async()=>py,fetch:async()=>({ok:true,text:async()=>""})});
  return {queries,loaded,replies,send:(id,op,name,value)=>self.onmessage({data:{id,op,code:name,value}})};
}
async function wait(h,n) {
  for (let i=0;i<100 && h.replies.length<n;i++)
    await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(h.replies.length,n,"worker did not respond");
}
function python(source) {return spawnSync("python3",["-c",source],{encoding:"utf8"});}
function requireNumpy(t) {
  const probe=python("import numpy");
  if (probe.status===0) return true;
  if (process.env.FLOWSTUDIO_REQUIRE_PANDAS==="1")
    assert.fail("NumPy required by pinned pandas CI acceptance: "+(probe.stderr||probe.error));
  t.skip("NumPy not installed; no real ndarray acceptance claimed");
  return false;
}

test("NumPy destination is opt-in and wired to the actual browser workspace", () => {
  assert.match(html,/id="transferAsNumpy" type="checkbox"/);
  assert.match(html,/numpy:\$\("transferAsNumpy"\)/);
  assert.match(html,/R vector → NumPy ndarray/);
});

test("controller routes only R vectors to NumPy and preserves ordinary transfers", async () => {
  const direction=control("r-to-python"),source=control("values"),destination=control("copy");
  const button=control(""),numpy={checked:true},pandas={checked:false},calls=[],notices=[];
  let busy=false;
  const controller=transfer.create({direction,source,destination,button,numpy,pandas,
    rSession:()=>({exportVariable:async name=>{calls.push(["r-export",name]);return {ok:true,value:numberPacket};},
      importVariable:async(name,value)=>{calls.push(["r-import",name,value]);return {ok:true};}}),
    python:async(op,name,value)=>{calls.push(["python",op,name,value]);return {ok:true,value:numberPacket};},
    notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>0});
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls[1],["python","import-numpy","copy",numberPacket]);
  assert.match(notices.at(-1),/as NumPy ndarray/);
  numpy.checked=false;
  assert.equal(await controller.transfer(),true);
  assert.equal(calls[3][1],"import");
  numpy.checked=true;direction.value="python-to-r";
  assert.equal(await controller.transfer(),true);
  assert.equal(calls[4][1],"export");
  assert.equal(calls[5][0],"r-import");
  assert.equal(busy,false);
  assert.equal(button.disabled,false);
});

test("controller rejects incompatible NumPy modes before Python destination mutation", async () => {
  for (const [packet,pandas,expected] of [
    [numberPacket,true,/either pandas or NumPy/],
    [{kind:"scalar",type:"number",values:[3]},false,/nonempty numeric/],
    [{kind:"table",columns:[{name:"x",type:"number",values:[3]}]},false,/nonempty numeric/],
    [{kind:"vector",type:"string",values:["x"]},false,/nonempty numeric/],
    [{kind:"vector",type:"number",values:[]},false,/nonempty numeric/],
    [{kind:"vector",type:"boolean",values:[true,null]},false,/nonempty numeric/]
  ]) {
    let imported=0,busy=false;const notices=[];
    const controller=transfer.create({direction:control("r-to-python"),source:control("x"),
      destination:control("copy"),button:control(""),numpy:{checked:true},pandas:{checked:pandas},
      rSession:()=>({exportVariable:async()=>({ok:true,value:packet})}),
      python:async()=>{imported++;return {ok:true};},
      notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>0});
    assert.equal(await controller.transfer(),false);
    assert.equal(imported,0);
    assert.match(notices.at(-1),expected);
    assert.equal(busy,false);
  }
});

test("worker rejects invalid NumPy requests before loading Python and serializes valid imports", async () => {
  const h=harness();
  h.send(1,"import-numpy","copy",numberPacket);
  h.send(2,"import-numpy","flags",boolPacket);
  h.send(3,"import-numpy","copy",{kind:"vector",type:"boolean",values:[null,true]});
  h.send(4,"import-numpy","copy",{kind:"vector",type:"string",values:["x"]});
  h.send(5,"import-numpy","copy",{kind:"scalar",type:"number",values:[1]});
  h.send(6,"import-numpy","bad-name",numberPacket);
  h.send(7,"import-numpy","copy",{kind:"vector",type:"number",values:[Infinity]});
  await wait(h,7);
  assert.deepEqual(h.replies.slice().sort((a,b)=>a.id-b.id).map(x=>x.ok),
    [true,true,false,false,false,false,false]);
  assert.deepEqual(h.loaded,["numpy","numpy"]);
  assert.equal(h.queries.length,2);
  assert.match(h.queries[0],/dtype=_fs_transfer_dtype/);
  assert.match(h.queries[0],/globals\(\)\["copy"\] = _fs_transfer_array/);
});

test("real CPython constructs bounded NumPy arrays, preserving NaN and booleans", async t => {
  if (!requireNumpy(t)) return;
  const h=harness();
  h.send(1,"import-numpy","copied",numberPacket);
  h.send(2,"import-numpy","flags",boolPacket);
  await wait(h,2);
  const result=python(h.queries.join("\n")+
    "\nimport numpy as np"+
    "\nassert type(copied) is np.ndarray and copied.shape == (3,)"+
    "\nassert copied.dtype == np.dtype('float64')"+
    "\nassert copied[0] == 1.25 and np.isnan(copied[1]) and copied[2] == 2.5"+
    "\nassert type(flags) is np.ndarray and flags.dtype == np.dtype('bool')"+
    "\nassert flags.tolist() == [True,False]");
  assert.equal(result.status,0,result.stderr);
});

test("NumPy import errors and nonacknowledgement leave destination unchanged", async t => {
  const missing=harness({loadError:true});
  missing.send(1,"import-numpy","copy",numberPacket);
  await wait(missing,1);
  assert.equal(missing.replies[0].ok,false);
  assert.equal(missing.queries.length,0);
  const rejected=harness({ack:"unexpected"});
  rejected.send(2,"import-numpy","copy",numberPacket);
  await wait(rejected,1);
  assert.equal(rejected.replies[0].ok,false);
  assert.match(rejected.replies[0].output,/did not acknowledge/);
  if (!requireNumpy(t)) return;
  const h=harness();
  h.send(1,"import-numpy","copy",numberPacket);
  await wait(h,1);
  const result=python("import numpy as np\ncopy = 'unchanged'\n"+
    "def fail(*args, **kwargs): raise RuntimeError('constructor failed')\n"+
    "np.asarray = fail\ntry:\n"+
    h.queries[0].split("\n").map(line=>"    "+line).join("\n")+
    "\nexcept RuntimeError:\n    pass\nassert copy == 'unchanged'");
  assert.equal(result.status,0,result.stderr);
});

test("R Unicode vectors are transferred to real NumPy Unicode ndarrays", async t => {
  const packet = {kind:"vector",type:"string",values:["café","東京","🙂",""]};
  const missing = {kind:"vector",type:"string",values:["safe",null]};
  const h = harness();
  h.send(1,"import-numpy","words",packet);
  h.send(2,"import-numpy","missing",missing);
  await wait(h,2);
  assert.equal(h.replies[0].ok,true);
  assert.equal(h.replies[1].ok,false);
  assert.equal(h.queries.length,1,"Missing strings must not reach Python");
  assert.deepEqual(h.loaded,["numpy"]);
  if (!requireNumpy(t)) return;
  const result=python(h.queries[0]+
    "\nimport numpy as np"+
    "\nassert type(words) is np.ndarray and words.ndim == 1"+
    "\nassert words.dtype.kind == 'U'"+
    "\nassert words.tolist() == ['café','東京','🙂','']");
  assert.equal(result.status,0,result.stderr);
});

test("controller accepts nonmissing R strings as NumPy but refuses missing strings", async () => {
  let packet={kind:"vector",type:"string",values:["élan","東京"]};
  const calls=[], notices=[];
  let busy=false;
  const controller=transfer.create({direction:control("r-to-python"),source:control("words"),
    destination:control("copy"),button:control(""),numpy:{checked:true},pandas:{checked:false},
    rSession:()=>({exportVariable:async()=>({ok:true,value:packet})}),
    python:async(op,name,value)=>{calls.push([op,name,value]);return {ok:true};},
    notice:s=>notices.push(s),isBusy:()=>busy,setBusy:v=>{busy=v;},generation:()=>0});
  assert.equal(await controller.transfer(),true);
  assert.deepEqual(calls,[["import-numpy","copy",packet]]);
  packet={kind:"vector",type:"string",values:["safe",null]};
  assert.equal(await controller.transfer(),false);
  assert.equal(calls.length,1,"Missing strings must not mutate destination");
  assert.ok(notices.at(-1).includes("nonmissing boolean/string"));
});
