"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const panel = require("../docs/app/python_debug_panel.js");
const native = require("../docs/app/native_flow.js");

const paused = {state:"paused",ok:true,stack:[{line:2,function:"<module>",
  locals:{i:{type:"int",value:"3"}}}],output:"",message:""};

test("conditional breakpoint parser preserves plain lines and typed conditions", () => {
  assert.deepEqual(panel.parseBreakpoints("2?i>=3, 4 6?x<0.5", 6),
    [{line:2,condition:"i>=3"},4,{line:6,condition:"x<0.5"}]);
  assert.deepEqual(panel.parseBreakpoints("2,4", 6), [2,4]);
  for (const invalid of ["2?i>=3,2", "2?i>=3,2?i<4", "2?i.__class__==3",
    "2?i==nan", "2?i>=1e6", "2?i>3;4", "7?i>=3", "2?i>=3 7"]) {
    assert.throws(() => panel.parseBreakpoints(invalid, 6), invalid);
  }
});

test("native debugger transmits conditions to the real Flow-owned route", async () => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.location = new URL("http://127.0.0.1:8751/app/");
  globalThis.fetch = async (url, options) => {
    calls.push({url, body:JSON.parse(options.body),
      intent:options.headers["X-FlowStudio-Intent"]});
    return {ok:true,status:200,headers:{get:()=>null},
      text:async()=>JSON.stringify(paused)};
  };
  try {
    const points = panel.parseBreakpoints("2?i>=3", 3);
    const result = await native.debugPythonStart("i = 3\nprint(i)\n", points);
    assert.deepEqual(result, paused);
    assert.deepEqual(calls, [{url:"/api/debug/python/start",
      body:{source:"i = 3\nprint(i)\n",breakpoints:[{line:2,condition:"i>=3"}]},
      intent:"run"}]);
    for (const invalid of [
      [{line:2,condition:"__import__('os')"}],
      [{line:2,condition:"i>=3",extra:true}],
      [{line:2,condition:"i>=3"},2],
      [{line:99,condition:"i>=3"}],
      [{line:2,condition:"i>=1e9"}],
    ]) {
      await assert.rejects(native.debugPythonStart("i = 3\nprint(i)\n", invalid));
    }
    assert.equal(calls.length, 1, "Invalid requests must not reach HTTP");
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
