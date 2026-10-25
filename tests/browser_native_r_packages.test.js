"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const native = require("../docs/app/native_flow.js");
const localhost = new URL("http://127.0.0.1:8751/app/");
const inventory = {packages:[{name:"stats",version:"4.5.1"},{name:"utils",version:"4.5.1"}],truncated:false};
function response(body, status=200) {
  return {ok:status===200,status,headers:{get:()=>null},text:async()=>body};
}
async function withBrowser(location, fetch, work) {
  const previousLocation=globalThis.location, previousFetch=globalThis.fetch;
  globalThis.location=location; globalThis.fetch=fetch;
  try { return await work(); }
  finally {
    if (previousLocation===undefined) delete globalThis.location;
    else globalThis.location=previousLocation;
    globalThis.fetch=previousFetch;
  }
}
test("native R package inventory uses Flow-owned intent-gated route",async()=>{
  const calls=[];
  await withBrowser(localhost,async(route,options)=>{
    calls.push([route,options]);
    return response(JSON.stringify(inventory));
  },async()=>{
    assert.deepEqual(await native.createRSession().packages(),{ok:true,...inventory});
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/api/packages/r");
  assert.equal(calls[0][1].body,"");
  assert.equal(calls[0][1].method,"POST");
  assert.equal(calls[0][1].headers["X-FlowStudio-Intent"],"run");
  assert.equal(calls[0][1].credentials,"omit");
  assert.equal(calls[0][1].redirect,"error");
});
test("native R package inventory rejects malformed and oversized payloads",async()=>{
  const invalid=["{","[]","null",JSON.stringify({packages:[]}),
    JSON.stringify({packages:[],truncated:"no"}),
    JSON.stringify({packages:[{name:"a;system",version:"1"}],truncated:false}),
    JSON.stringify({packages:[{name:"stats",version:4}],truncated:false}),
    JSON.stringify({packages:[{name:"stats",version:"x".repeat(101)}],truncated:false}),
    JSON.stringify({packages:Array(1001).fill({name:"stats",version:"1"}),truncated:false})];
  for(const body of invalid) {
    await withBrowser(localhost,async()=>response(body),async()=>{
      await assert.rejects(native.createRSession().packages(),/JSON|Invalid native R package/);
    });
  }
});
test("native R inventory cannot reach localhost from Pages",async()=>{
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    ()=>{throw Error("Unexpected network");},async()=>{
      await assert.rejects(native.createRSession().packages(),/native FlowStudio server/);
    });
});
test("native R inventory is serialized with reset and discards stale data",async()=>{
  let release;
  const calls=[];
  await withBrowser(localhost,async(route)=>{
    calls.push(route);
    if(route==="/api/packages/r") await new Promise(resolve=>{release=resolve;});
    return response(route==="/api/reset/r"?"R session reset.":JSON.stringify(inventory));
  },async()=>{
    const session=native.createRSession();
    const pending=session.packages();
    for(let i=0;i<8&&!release;i++) await Promise.resolve();
    assert.equal(typeof release,"function");
    const reset=session.reset();
    release();
    const result=await pending;
    assert.equal(result.ok,false);
    assert.match(result.output,/discarded/);
    assert.equal((await reset).ok,true);
  });
  assert.deepEqual(calls,["/api/packages/r","/api/reset/r"]);
});
test("native R loads only valid installed package names over the Flow route",async()=>{
  const calls=[];
  await withBrowser(localhost,async(route,options)=>{
    calls.push([route,options]);
    return response("Loaded installed R package splines.");
  },async()=>{
    const session=native.createRSession();
    for(const name of ["", "splines;stop(1)", "../splines", "a..b", "a.", "x".repeat(81)]) {
      const result=await session.loadPackage(name);
      assert.equal(result.ok,false,name);
      assert.match(result.output,/Invalid installed R package name/);
    }
    const loaded=await session.loadPackage("splines");
    assert.equal(loaded.ok,true);
    assert.match(loaded.output,/Loaded installed R package splines/);
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/api/packages/r/load");
  assert.equal(calls[0][1].body,"splines");
  assert.equal(calls[0][1].headers["X-FlowStudio-Intent"],"run");
});
test("native R package load is unavailable on Pages",async()=>{
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    ()=>{throw Error("Unexpected network");},async()=>{
      await assert.rejects(native.createRSession().loadPackage("splines"),/native FlowStudio server/);
    });
});
test("native R package load serializes with reset and discards stale results",async()=>{
  let release;
  const calls=[];
  await withBrowser(localhost,async route=>{
    calls.push(route);
    if(route==="/api/packages/r/load") await new Promise(resolve=>{release=resolve;});
    return response(route==="/api/reset/r"?"R session reset.":"Loaded installed R package splines.");
  },async()=>{
    const session=native.createRSession();
    const pending=session.loadPackage("splines");
    for(let i=0;i<8&&!release;i++) await Promise.resolve();
    assert.equal(typeof release,"function");
    const reset=session.reset();
    release();
    assert.match((await pending).output,/discarded/);
    assert.equal((await reset).ok,true);
  });
  assert.deepEqual(calls,["/api/packages/r/load","/api/reset/r"]);
});
test("native R package install is explicitly unsupported",async()=>{
  const result=await native.createRSession().installPackage("ggplot2");
  assert.equal(result.ok,false);
  assert.match(result.output,/not available for native R/);
});
test("Flow routes installed-library inventory through real R IPC",()=>{
  const root=path.join(__dirname,"..");
  const read=name=>fs.readFileSync(path.join(root,name),"utf8");
  assert.match(read("src/main.flow"),/if eq\(path, "\/api\/packages\/r"\) \{\s*send_r_packages\(\)/);
  assert.match(read("src/r_session.c"),/fs_r_packages\(void\) \{ return request_r\('K', ""\); \}/);
  assert.match(read("src/r_kernel.R"),/package_snapshot <- function\(\)/);
  assert.match(read("src/main.flow"),/if eq\(path, "\/api\/packages\/r\/load"\) \{\s*send_r_package_load\(fs_body\(\)\)/);
  assert.match(read("src/r_session.c"),/fs_r_load_package\(const char \*name\) \{ return request_r\(\x27L\x27, name\); \}/);
  assert.match(read("src/r_kernel.R"),/load_installed_package <- function\(name\)/);
  assert.match(read("docs/app/index.html"),/rNative:nativeRSelected/);
});