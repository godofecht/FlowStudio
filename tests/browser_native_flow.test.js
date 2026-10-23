"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../docs/app/native_flow.js");

function withBrowser(location, fetch, callback) {
  const priorLocation = globalThis.location;
  const priorFetch = globalThis.fetch;
  globalThis.location = location;
  globalThis.fetch = fetch;
  return Promise.resolve().then(callback).finally(() => {
    if (priorLocation === undefined) delete globalThis.location;
    else globalThis.location = priorLocation;
    globalThis.fetch = priorFetch;
  });
}
const localhost = new URL("http://127.0.0.1:8751/app/");
test("native execution is limited to the exact loopback FlowStudio origin", async () => {
  assert.equal(native.available(localhost), true);
  assert.equal(native.available(new URL("http://localhost:8751/app/")), true);
  for (const url of [
    "https://godofecht.github.io/FlowStudio/app/",
    "http://localhost:8752/app/",
    "http://127.0.0.1.evil.invalid:8751/app/",
    "https://localhost:8751/app/"
  ]) assert.equal(native.available(new URL(url)), false, url);
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    () => { throw Error("Unexpected network request"); },
    async () => assert.rejects(native.run("println(1)"), /native FlowStudio server/));
});
test("native client sends exact source with intent header, no credentials and a deadline", async () => {
  let called = 0;
  await withBrowser(localhost, async (url, options) => {
    called++;
    assert.equal(url, "/api/run/flow");
    assert.equal(options.method, "POST");
    assert.equal(options.body, 'println("ok")');
    assert.equal(options.headers["X-FlowStudio-Intent"], "run");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return {ok:true, status:200, headers:{get:()=> "3"}, text:async()=> "ok\n"};
  }, async () => {
    assert.deepEqual(await native.run('println("ok")'), {ok:true, output:"ok\n", status:200});
  });
  assert.equal(called, 1);
});
test("compiler failures propagate without converting HTTP 422 into success", async () => {
  await withBrowser(localhost, async () => ({
    ok:false, status:422, headers:{get:()=> "6"}, text:async()=> "error!"
  }), async () => assert.deepEqual(await native.run("broken"), {
    ok:false, status:422, output:"error!"
  }));
});
test("oversized source is rejected before any network access", async () => {
  await withBrowser(localhost, () => { throw Error("Unexpected network request"); },
    async () => assert.rejects(native.run("x".repeat(65537)), /64 KiB/));
});
test("oversized native output is rejected", async () => {
  await withBrowser(localhost, async () => ({
    ok:true, status:200, headers:{get:()=> "131073"},
    text:async()=> { throw Error("Should not read oversized response"); }
  }), async () => assert.rejects(native.run("x"), /128 KiB/));
  await withBrowser(localhost, async () => ({
    ok:true, status:200, headers:{get:()=> null}, text:async()=> "x".repeat(131073)
  }), async () => assert.rejects(native.run("x"), /128 KiB/));
});


test("Flow check uses the strict nonexecuting endpoint and parses compiler locations", async () => {
  let count = 0;
  await withBrowser(localhost, async (url, options) => {
    count++;
    assert.equal(url, "/api/check/flow");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-FlowStudio-Intent"], "run");
    assert.equal(options.body, "function main( -> i32 {");
    return {ok:false, status:422, headers:{get:()=>null},
      text:async()=>"/tmp/flowstudio-source.flow:2:7: error: unexpected token"};
  }, async () => {
    assert.deepEqual(await native.checkSyntax("function main( -> i32 {"), {
      ok:false, output:"/tmp/flowstudio-source.flow:2:7: error: unexpected token",
      diagnostics:[{line:2, column:7, message:"unexpected token"}]
    });
  });
  assert.equal(count, 1);
});

test("Flow check success and compiler failures without locations are distinguished", async () => {
  await withBrowser(localhost, async () => ({ok:true, status:200, headers:{get:()=>null},
    text:async()=>"Flow compile check passed; source was not executed."}),
  async () => assert.deepEqual(await native.checkSyntax("function main() -> i32 { return 0 }"), {
    ok:true, output:"Flow compile check passed; source was not executed.", diagnostics:[]
  }));
  await withBrowser(localhost, async () => ({ok:false, status:503, headers:{get:()=>null},
    text:async()=>"Compiler unavailable"}),
  async () => assert.deepEqual(await native.checkSyntax("bad"), {
    ok:false, output:"Compiler unavailable", diagnostics:[]
  }));
});

test("Flow check rejects non-loopback requests before network access", async () => {
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    () => { throw Error("unexpected request"); },
    async () => assert.rejects(native.checkSyntax("function main() {}"), /native FlowStudio server/));
});
