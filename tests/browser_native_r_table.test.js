"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const native = require("../docs/app/native_flow.js");
const localhost = new URL("http://127.0.0.1:8751/app/");
function response(body, status = 200) {
  return {ok:status === 200, status, headers:{get:()=>null}, text:async()=>body};
}
async function withBrowser(location, fetch, work) {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  globalThis.location = location;
  globalThis.fetch = fetch;
  try { return await work(); }
  finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
}
const sample = {columns:["label", "score", "group"],
  rows:[["alpha", "42", "one"], ["beta", "", "two"]],
  totalRows:2, truncated:false};

test("native R table preview uses Flow-owned POST with intent and preserves typed strings", async () => {
  const calls = [];
  await withBrowser(localhost, async (route, options) => {
    calls.push([route, options]);
    return response(JSON.stringify(sample));
  }, async () => {
    const session = native.createRSession();
    assert.deepEqual(await session.table("native_table"), {ok:true, table:sample});
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/table/r");
  assert.equal(calls[0][1].body, "native_table");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers["X-FlowStudio-Intent"], "run");
  assert.equal(calls[0][1].credentials, "omit");
  assert.equal(calls[0][1].redirect, "error");
});

test("native R table rejects arbitrary expressions and disallowed browser origins", async () => {
  await withBrowser(localhost, () => { throw Error("Unexpected fetch"); }, async () => {
    const session = native.createRSession();
    for (const name of ["x;stop('bad')", ".GlobalEnv", "x..y", "x.", "x\nq", "x".repeat(121)]) {
      assert.equal((await session.table(name)).ok, false, name);
    }
  });
  await withBrowser(new URL("https://godofecht.github.io/FlowStudio/app/"),
    () => { throw Error("Unexpected fetch"); },
    async () => await assert.rejects(native.createRSession().table("data"), /native FlowStudio server/));
});

test("native R table rejects malformed, excessive or inconsistent JSON", async () => {
  const bad = [
    "{", "[]", "null",
    JSON.stringify({...sample, rows:[["one"]]}),
    JSON.stringify({...sample, columns:Array(33).fill("x")}),
    JSON.stringify({...sample, rows:Array(201).fill(["a","b","c"])}),
    JSON.stringify({...sample, totalRows:1}),
    JSON.stringify({...sample, truncated:"false"}),
    JSON.stringify({...sample, rows:[["a", null, "c"]]}),
    JSON.stringify({...sample, columns:["x".repeat(161), "b", "c"]})
  ];
  for (const body of bad) {
    await withBrowser(localhost, async () => response(body), async () =>
      await assert.rejects(native.createRSession().table("data"), /JSON|Invalid native R table/));
  }
});

test("native R table reports kernel errors and discards stale responses after reset", async () => {
  await withBrowser(localhost, async () => response("R table not found", 422), async () => {
    const result = await native.createRSession().table("missing");
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
  });
  let release;
  const calls = [];
  await withBrowser(localhost, async route => {
    calls.push(route);
    if (route === "/api/table/r") await new Promise(resolve => { release = resolve; });
    return response(route === "/api/reset/r" ? "R session reset." : JSON.stringify(sample));
  }, async () => {
    const session = native.createRSession();
    const pending = session.table("data");
    for (let i = 0; i < 8 && !release; i++) await Promise.resolve();
    assert.equal(typeof release, "function");
    const reset = session.reset();
    release();
    assert.equal((await pending).ok, false);
    assert.match((await pending).output, /discarded/);
    assert.equal((await reset).ok, true);
  });
  assert.deepEqual(calls, ["/api/table/r", "/api/reset/r"]);
});

test("native R table route is owned by Flow, not an eval-string client shim", () => {
  const root = path.join(__dirname, "..");
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  assert.match(read("src/main.flow"), /if eq\(path, "\/api\/table\/r"\) \{\s*send_r_table\(fs_body\(\)\)/);
  assert.match(read("src/r_session.c"), /fs_r_table\(const char \*name\) \{ return request_r\('T', name\); \}/);
  assert.match(read("src/r_kernel.R"), /table_snapshot <- function\(query\)/);
  assert.match(read("docs/app/index.html"), /await getRSession\(\)\.table\(name\)/);
});
