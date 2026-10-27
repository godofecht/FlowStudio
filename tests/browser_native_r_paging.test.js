"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../docs/app/native_flow.js");
const localhost = new URL("http://127.0.0.1:8751/app/");
function response(body, status = 200) {
  return {ok:status === 200, status, headers:{get:()=>null}, text:async()=>body};
}
async function withBrowser(fetch, work) {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  globalThis.location = localhost;
  globalThis.fetch = fetch;
  try { await work(); }
  finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
}
const page = {columns:["n"], rows:[["201"],["202"]], totalRows:202,
  offset:200, nextOffset:null, truncated:true};

test("native R table paging sends a literal name and decimal offset over Flow", async () => {
  const calls = [];
  await withBrowser(async (route, options) => {
    calls.push([route, options]);
    return response(JSON.stringify(page));
  }, async () => {
    const session = native.createRSession();
    assert.deepEqual(await session.table("data", 200), {ok:true, table:page});
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/table/r");
  assert.equal(calls[0][1].body, "data\t200");
  assert.equal(calls[0][1].headers["X-FlowStudio-Intent"], "run");
});

test("native R table paging rejects invalid offsets before HTTP", async () => {
  await withBrowser(() => { throw Error("Unexpected fetch"); }, async () => {
    const session = native.createRSession();
    for (const offset of [-1, 1.5, NaN, Infinity, "200", 10000000000]) {
      const result = await session.table("data", offset);
      assert.equal(result.ok, false, String(offset));
    }
  });
});

test("native R table paging rejects stale, mismatched and malformed slices", async () => {
  const bad = [
    {...page, offset:199},
    {...page, nextOffset:201},
    {...page, nextOffset:202},
    {...page, totalRows:201},
    {...page, rows:[["201"],["202"],["203"]]},
    {...page, offset:undefined},
    {...page, nextOffset:undefined}
  ];
  for (const payload of bad) {
    await withBrowser(async () => response(JSON.stringify(payload)), async () => {
      await assert.rejects(native.createRSession().table("data", 200),
        /Invalid native R table/);
    });
  }
});

test("native R table page with remaining rows validates next offset", async () => {
  const first = {columns:["n"], rows:[["1"],["2"]], totalRows:300,
    offset:0, nextOffset:2, truncated:true};
  await withBrowser(async () => response(JSON.stringify(first)), async () => {
    assert.deepEqual((await native.createRSession().table("data")).table, first);
  });
});
