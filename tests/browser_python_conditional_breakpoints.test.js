"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const panel = require("../docs/app/python_debug_panel.js");
const native = require("../docs/app/native_flow.js");

const paused = {state:"paused",ok:true,stack:[{line:2,function:"<module>",
  locals:{i:{type:"int",value:"3"}}}],output:"",message:""};

test("browser source line accounting matches CPython splitlines including terminal separators", () => {
  const fixtures = [
    ["",0], ["x = 1",1], ["x = 1\n",1], ["x = 1\n\n",2],
    ["x = 1\r\n",1], ["x = 1\r\nx = 2\r\n",2],
    ["x = 1\r",1], ["x = 1\u2028",1], ["x = 1\u2028x = 2",2],
    ["x = 1\v",1], ["x = 1\f",1], ["x = 1\u0085",1],
    ["\n",1], ["\n\n",2], ["x = 1\r\n\n",2]
  ];
  for (const [source, expected] of fixtures)
    assert.equal(panel.pythonLineCount(source), expected, JSON.stringify(source));
  assert.throws(() => panel.parseBreakpoints("2", panel.pythonLineCount("x = 1\n")),
    /outside source/);
  assert.deepEqual(panel.parseBreakpoints("2", panel.pythonLineCount("x = 1\n\n")), [2]);
});

test("conditional breakpoint parser preserves plain lines and typed conditions", () => {
  assert.deepEqual(panel.parseBreakpoints("2?i>=3, 4 6?x<0.5", 6),
    [{line:2,condition:"i>=3"},4,{line:6,condition:"x<0.5"}]);
  assert.deepEqual(panel.parseBreakpoints("2,4", 6), [2,4]);
  assert.deepEqual(panel.parseBreakpoints("2?residual<=1e-3, 4?delta>=-2.5E+3 6?epsilon>.5e-8", 6),
    [{line:2,condition:"residual<=1e-3"}, {line:4,condition:"delta>=-2.5E+3"},
      {line:6,condition:"epsilon>.5e-8"}]);
  assert.deepEqual(panel.parseBreakpoints("2?epsilon<1e-320 4?zero==0e+0", 6),
    [{line:2,condition:"epsilon<1e-320"}, {line:4,condition:"zero==0e+0"}]);
  for (const invalid of ["2?i>=3,2", "2?i>=3,2?i<4", "2?i.__class__==3",
    "2?i==nan", "2?i>=1e+", "2?i>=1e99999", "2?i>=.e-3",
    "2?i>=+1e-3", "2?i>=1e-3;evil", "2?i>3;4", "7?i>=3", "2?i>=3 7"]) {
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
    const scientific = panel.parseBreakpoints("2?residual<=1e-3", 3);
    await native.debugPythonStart("residual = 0.0005\nprint(residual)\n", scientific);
    assert.deepEqual(calls[1], {url:"/api/debug/python/start",
      body:{source:"residual = 0.0005\nprint(residual)\n",
        breakpoints:[{line:2,condition:"residual<=1e-3"}]}, intent:"run"});
    for (const invalid of [
      [{line:2,condition:"__import__('os')"}],
      [{line:2,condition:"i>=3",extra:true}],
      [{line:2,condition:"i>=3"},2],
      [{line:99,condition:"i>=3"}],
      [{line:2,condition:"i>=1e+"}],
      [{line:2,condition:"i>=1e99999"}],
    ]) {
      await assert.rejects(native.debugPythonStart("i = 3\nprint(i)\n", invalid));
    }
    for (const source of ["x = 1\n", "x = 1\r\n", "x = 1\u2028"]) {
      await assert.rejects(native.debugPythonStart(source, [2]),
        /valid breakpoint lines/);
    }
    await native.debugPythonStart("x = 1\n\n", [2]);
    assert.deepEqual(calls[2], {url:"/api/debug/python/start",
      body:{source:"x = 1\n\n",breakpoints:[2]}, intent:"run"});
    assert.equal(calls.length, 3, "Invalid requests must not reach HTTP");
  } finally {
    if (oldLocation === undefined) delete globalThis.location;
    else globalThis.location = oldLocation;
    globalThis.fetch = oldFetch;
  }
});
