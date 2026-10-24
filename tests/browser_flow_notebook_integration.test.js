"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../docs/app/native_flow.js");
const {create} = require("../docs/app/notebook_runner.js");
const {parseCells} = require("../docs/app/source_cells.js");

const source = 'function main() -> i32 { println("first"); return 0 }\n' +
  '# %%\nfunction main() -> i32 { println("second"); return 0 }\n' +
  '# %%\nfunction main() -> i32 { println("third"); return 0 }\n';

async function withOrigin(origin, fetch, action) {
  const previousLocation = globalThis.location;
  const previousFetch = globalThis.fetch;
  globalThis.location = new URL(origin);
  globalThis.fetch = fetch;
  try { return await action(); }
  finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    globalThis.fetch = previousFetch;
  }
}

test("Flow notebook dispatches separate real native client requests in source order", async () => {
  const calls = [], entries = [];
  await withOrigin("http://127.0.0.1:8751/app/", async (url, options) => {
    calls.push({url, options});
    const number = calls.length;
    return {ok:true, status:200, headers:{get:()=>null},
      text:async()=>["first", "second", "third"][number - 1] + "\n"};
  }, async () => {
    const runner = create({parseCells, execute:(code, language) => {
      assert.equal(language, "flow");
      return native.run(code);
    }, onCell:entry=>entries.push(entry), notice:()=>{}, allowNativeFlow:native.available()});
    assert.deepEqual(await runner.run(source, "flow"), {ok:true, executed:3});
  });
  assert.equal(calls.length, 3);
  const parsed = parseCells(source).map(cell => cell.code);
  for (let i = 0; i < calls.length; i++) {
    assert.equal(calls[i].url, "/api/run/flow");
    assert.equal(calls[i].options.body, parsed[i]);
    assert.equal(calls[i].options.headers["X-FlowStudio-Intent"], "run");
    assert.equal(calls[i].options.credentials, "omit");
  }
  assert.deepEqual(entries.map(x=>x.output), ["first\n", "second\n", "third\n"]);
});

test("Flow notebook stops on compiler failure and never executes later cells", async () => {
  const calls = [], entries = [];
  await withOrigin("http://localhost:8751/app/", async (_url, options) => {
    calls.push(options.body);
    return calls.length === 2 ?
      {ok:false,status:422,headers:{get:()=>null},text:async()=>"compile error"} :
      {ok:true,status:200,headers:{get:()=>null},text:async()=>"ok"};
  }, async () => {
    const runner = create({parseCells,execute:code=>native.run(code),
      onCell:entry=>entries.push(entry),notice:()=>{},allowNativeFlow:true});
    assert.deepEqual(await runner.run(source, "flow"),
      {ok:false, executed:2, failedIndex:1, error:"Cell execution failed."});
  });
  assert.equal(calls.length, 2);
  assert.equal(entries[1].ok, false);
  assert.match(entries[1].output, /compile error/);
});

test("hosted Pages cannot run Flow notebook even if a caller opts in", async () => {
  let calls = 0;
  await withOrigin("https://godofecht.github.io/FlowStudio/app/",
    async () => { calls++; throw Error("Unexpected HTTP"); }, async () => {
      const runner = create({parseCells,execute:code=>native.run(code),
        onCell:()=>{},notice:()=>{},allowNativeFlow:native.available()});
      const result = await runner.run(source, "flow");
      assert.equal(result.ok, false);
      assert.match(result.error, /native Flow/);
    });
  assert.equal(calls, 0);
});
