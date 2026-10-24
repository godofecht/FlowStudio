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

test("Git staging and committing send only bounded literal inputs", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>""};
  };
  try {
    await native.gitStagedDiff();
    await native.gitStage("folder/a b[1].flow");
    await native.gitCommit("Implement a real feature");
    assert.deepEqual(calls.map(x=>[x.url,x.options.body]), [
      ["/api/git/diff/staged",""], ["/api/git/stage","folder/a b[1].flow"],
      ["/api/git/commit","Implement a real feature"]
    ]);
    for (const {options} of calls) {
      assert.equal(options.headers["X-FlowStudio-Intent"],"run");
      assert.equal(options.credentials,"omit");
      assert.equal(options.redirect,"error");
    }
    for (const path of ["", ".", "..", "/", " ".repeat(4), "x".repeat(513)])
      await assert.rejects(native.gitStage(path), /Git path/);
    for (const message of ["", "  ", "x".repeat(513)])
      await assert.rejects(native.gitCommit(message), /commit message/);
    assert.equal(calls.length,3);
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
test("hosted Pages rejects all Git write and staged-read routes", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  globalThis.location = new URL("https://godofecht.github.io/FlowStudio/app/");
  globalThis.fetch = () => { throw Error("unexpected network request"); };
  try {
    await assert.rejects(native.gitStagedDiff(), /native FlowStudio server/);
    await assert.rejects(native.gitStage("a.py"), /native FlowStudio server/);
    await assert.rejects(native.gitCommit("change"), /native FlowStudio server/);
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
