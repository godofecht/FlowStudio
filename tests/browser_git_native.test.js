"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../docs/app/native_flow.js");
test("Git client uses only fixed native routes and explicit intent", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch = async (url, options) => {
    calls.push({url,options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>url};
  };
  try {
    assert.equal((await native.gitStatus()).output,"/api/git/status");
    assert.equal((await native.gitDiff()).output,"/api/git/diff");
    for (const call of calls) {
      assert.equal(call.options.method,"POST");
      assert.equal(call.options.body,"");
      assert.equal(call.options.headers["X-FlowStudio-Intent"],"run");
      assert.equal(call.options.credentials,"omit");
      assert.equal(call.options.redirect,"error");
    }
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
test("Git client never contacts localhost from hosted Pages", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  globalThis.location = new URL("https://godofecht.github.io/FlowStudio/app/");
  globalThis.fetch = () => {throw Error("unexpected network request");};
  try {
    await assert.rejects(native.gitStatus(),/native FlowStudio server/);
    await assert.rejects(native.gitDiff(),/native FlowStudio server/);
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
