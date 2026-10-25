"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const native = require("../docs/app/native_flow.js");

const local = new URL("http://127.0.0.1:8751/app/");
async function withBrowser(location, fetch, callback) {
  const oldLocation = globalThis.location;
  const oldFetch = globalThis.fetch;
  globalThis.location = location;
  globalThis.fetch = fetch;
  try { return await callback(); }
  finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
}

test("native R check sends exact source through Flow-owned intent-gated route", async () => {
  let calls = 0;
  await withBrowser(local, async (url, options) => {
    calls++;
    assert.equal(url, "/api/check/r");
    assert.equal(options.method, "POST");
    assert.equal(options.body, "x <- 1; stop('never run')");
    assert.equal(options.headers["X-FlowStudio-Intent"], "run");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    return {ok:true, status:200, headers:{get:()=>null},
      text:async()=>"R syntax valid; source was not executed."};
  }, async () => assert.deepEqual(await native.checkRSyntax("x <- 1; stop('never run')"), {
    ok:true, output:"R syntax valid; source was not executed.", diagnostics:[]
  }));
  assert.equal(calls, 1);
});

test("native R parser errors preserve real line and column without evaluation", async () => {
  const output = "R syntax error: <text>:2:4: unexpected ')'";
  await withBrowser(local, async () => ({ok:false, status:422, headers:{get:()=>null},
    text:async()=>output}), async () => assert.deepEqual(
    await native.checkRSyntax("x <- 1\nx <- )"), {
      ok:false, output, diagnostics:[{line:2, column:4, message:"unexpected ')'"}]
    }));
});

test("native R syntax transport failures are not reported as grammar errors", async () => {
  await withBrowser(local, async () => ({ok:false, status:503, headers:{get:()=>null},
    text:async()=>"R kernel unavailable"}), async () => assert.deepEqual(
    await native.checkRSyntax("x <- 1"), {
      ok:false, output:"R kernel unavailable", diagnostics:[]
    }));
});

test("native R syntax check rejects remote origins and oversized input", async () => {
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    () => { throw Error("Unexpected network request"); },
    async () => assert.rejects(native.checkRSyntax("x <- 1"), /native FlowStudio server/));
  await withBrowser(local, () => { throw Error("Unexpected network request"); },
    async () => assert.rejects(native.checkRSyntax("x".repeat(65537)), /64 KiB/));
});

test("IDE prefers native R parser but retains webR fallback on GitHub Pages", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /FlowStudioNativeFlow\.checkRSyntax\(code\)/);
  assert.match(html, /getRSession\(\)\.checkSyntax\(code\)/);
  assert.match(html, /FlowStudioNativeFlow\?\.available\?\.\(\)/);
});
