"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/r_session.js");

function fixture({inventory = ["base\t4.6.0", "ggplot2\t4.0.0"]} = {}) {
  const calls = [], instances = [];
  let holdInstall = null;
  class WebR {
    constructor(options) { this.options = options; this.closed = false; instances.push(this); }
    async init() { calls.push("init"); }
    close() { this.closed = true; calls.push("close"); }
    Shelter = class {
      async captureR(code) { calls.push(["run", code]); return {output:[],images:[]}; }
      async purge() {}
    };
    async evalRRaw(code, type) {
      calls.push(["inventory", code, type]);
      return inventory;
    }
    async installPackages(names) {
      calls.push(["install", names]);
      if (holdInstall) await holdInstall;
    }
  }
  const session = create({load: async () => ({WebR, ChannelType: {PostMessage:"post"}})});
  return {session,calls,instances,blockInstall(promise){holdInstall=promise;}};
}

test("lists installed webR packages using real R inventory expression", async () => {
  const f=fixture();
  const result=await f.session.packages();
  assert.deepEqual(result,{ok:true,packages:[{name:"base",version:"4.6.0"},{name:"ggplot2",version:"4.0.0"}]});
  assert.match(f.calls[1][1],/installed\.packages\(\)/);
  assert.equal(f.calls[1][2],"string[]");
});

test("webR package installation uses documented API and existing persistent session", async () => {
  const f=fixture();
  await f.session.run("x <- 42");
  const result=await f.session.installPackage("ggplot2");
  assert.equal(result.ok,true);
  assert.deepEqual(f.calls.find(x=>Array.isArray(x)&&x[0]==="install"),["install",["ggplot2"]]);
  assert.equal((await f.session.packages()).ok,true);
  assert.equal(f.instances.length,1);
});

test("rejects R package injection, URLs, versions, empty names and invalid dots without loading webR", async () => {
  const f=fixture();
  for (const name of ["", "ggplot2==1.0", "a;system('x')", "https://example.com/x", "a..b", "a.", "_bad", "a".repeat(81), "a\ncat('x')"]) {
    assert.equal((await f.session.installPackage(name)).ok,false,name);
  }
  assert.equal(f.instances.length,0);
});

test("rejects malformed R inventory without rendering untrusted metadata", async () => {
  for (const inventory of [["a\tb\tc"], ["a%ZZ\t1"], ["bad..name\t1"], ["a\t"], Array(1001).fill("x\t1")]) {
    const f=fixture({inventory});
    const result=await f.session.packages();
    assert.equal(result.ok,false,JSON.stringify(inventory.slice(0,1)));
    assert.match(result.output,/Invalid|URI malformed/);
  }
});

test("serializes package installation, R execution and package inventory", async () => {
  const f=fixture();
  let release;
  f.blockInstall(new Promise(resolve => {release=resolve;}));
  const install=f.session.installPackage("Matrix");
  const run=f.session.run("x <- 42");
  const inventory=f.session.packages();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.filter(x=>Array.isArray(x)).length,1);
  release();
  assert.equal((await install).ok,true);
  assert.equal((await run).ok,true);
  assert.equal((await inventory).ok,true);
  assert.deepEqual(f.calls.filter(x=>Array.isArray(x)).map(x=>x[0]),["install","run","inventory"]);
});

test("reset invalidates in-flight install results and next call gets a fresh webR runtime", async () => {
  const f=fixture();
  let release;
  f.blockInstall(new Promise(resolve=>{release=resolve;}));
  const pending=f.session.installPackage("Matrix");
  await new Promise(resolve=>setImmediate(resolve));
  f.session.reset();
  release();
  assert.match((await pending).output,/reset/);
  assert.equal(f.instances[0].closed,true);
  assert.equal((await f.session.packages()).ok,true);
  assert.equal(f.instances.length,2);
});

test("installation failures are reported without a false success or inventory update", async () => {
  const calls=[];
  class WebR {
    async init() {}
    async installPackages(names) {calls.push(names);throw Error("Wasm repository unavailable");}
    close() {}
  }
  const r=create({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  const result=await r.installPackage("Matrix");
  assert.equal(result.ok,false);
  assert.match(result.output,/Wasm repository unavailable/);
  assert.deepEqual(calls,[["Matrix"]]);
});

test("package metadata percent-escapes roundtrip without HTML interpretation",async()=>{
  const f=fixture({inventory:["pkg.name\t1.2-3"]});
  assert.deepEqual((await f.session.packages()).packages,[{name:"pkg.name",version:"1.2-3"}]);
});

test("failed webR initialization closes its partially initialized runtime",async()=>{
  let closed=0, initialized=0;
  class WebR {
    async init(){initialized++;throw Error("Wasm unavailable");}
    close(){closed++;}
  }
  const session=create({load:async()=>({WebR,ChannelType:{PostMessage:"post"}})});
  const result=await session.packages();
  assert.equal(result.ok,false);
  assert.match(result.output,/Wasm unavailable/);
  assert.equal(initialized,1);
  assert.equal(closed,1);
});
