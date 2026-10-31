"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {create} = require("../docs/app/notebook_runner.js");
const {parseCells} = require("../docs/app/source_cells.js");

function harness() {
  const calls = [], entries = [];
  const runner = create({
    parseCells,
    execute: async (code, language) => {
      calls.push({code, language});
      return {ok:true, output:"executed:" + calls.length};
    },
    onCell: entry => entries.push(entry),
    notice: () => {}
  });
  return {runner, calls, entries};
}

test("513 selected markdown/code cells reject before interpreter or renderer side effects", async () => {
  const f = harness();
  const source = Array.from({length:513}, (_, index) =>
    index === 512 ? "# %% [python]\nprint(512)" : "# %% [markdown]\n# Section " + index).join("\n");
  const rejected = await f.runner.run(source, "python");
  assert.deepEqual(rejected, {ok:false, executed:0,
    error:"Notebook exceeds the 512 selected-cell execution limit."});
  assert.equal(f.calls.length, 0);
  assert.equal(f.entries.length, 0);
  assert.equal(f.runner.isRunning(), false);
  assert.deepEqual(await f.runner.run(source, "python", {startIndex:512, endIndex:512}),
    {ok:true, executed:1});
  assert.equal(f.calls.length, 1);
  assert.equal(f.entries.length, 1);
});

test("511 markdown cells and one Python cell execute at the exact selected-cell ceiling", async () => {
  const f = harness();
  const source = Array.from({length:512}, (_, index) =>
    index === 511 ? "# %% [python]\nprint(511)" : "# %% [markdown]\n# Section " + index).join("\n");
  assert.deepEqual(await f.runner.run(source, "python"), {ok:true, executed:1});
  assert.equal(f.entries.length, 512);
  assert.equal(f.calls.length, 1);
  assert.equal(f.entries[511].language, "python");
});

test("source UTF-8 byte ceiling rejects multibyte input before parsing or executing", async () => {
  const f = harness();
  const rejected = await f.runner.run("🧬".repeat(524289), "python");
  assert.deepEqual(rejected, {ok:false, executed:0,
    error:"Notebook source exceeds the 2 MiB UTF-8 execution limit."});
  assert.equal(f.calls.length, 0);
  assert.equal(f.entries.length, 0);
  assert.equal(f.runner.isRunning(), false);
});

test("invalid Unicode is rejected before Python, R or Flow dispatch", async () => {
  const f = harness();
  for (const language of ["python", "r", "flow"]) {
    const result = await f.runner.run("# %% [" + language + "]\nvalue = '\uD800'", language);
    assert.deepEqual(result, {ok:false, executed:0,
      error:"Notebook source contains invalid Unicode."});
  }
  assert.equal(f.calls.length, 0);
});

test("markdown truncation preserves complete Unicode code points and later code execution", async () => {
  const f = harness();
  const source = "# %% [markdown]\n" + "🦊".repeat(6000) +
    "\n# %% [r]\ncat(7)";
  assert.deepEqual(await f.runner.run(source, "r"), {ok:true, executed:1});
  assert.equal(f.entries[0].kind, "markdown");
  assert.equal(new TextEncoder().encode(f.entries[0].code).length, 16384);
  assert.equal(f.entries[0].code.includes("\uFFFD"), false);
  assert.equal(f.entries[1].language, "r");
  assert.equal(f.calls.length, 1);
});

test("detached markdown renderer returns a structured error and releases the run lock", async () => {
  let executions = 0;
  const runner = create({
    parseCells,
    execute: async () => { executions++; return {ok:true, output:"ok"}; },
    onCell: entry => { if (entry.kind === "markdown") throw Error("DOM detached"); },
    notice: () => {}
  });
  const source = "# %% [markdown]\n# Title\n# %% [python]\nprint(1)";
  assert.deepEqual(await runner.run(source, "python"),
    {ok:false, executed:0, error:"Notebook rendering failed: DOM detached"});
  assert.equal(executions, 0);
  assert.equal(runner.isRunning(), false);
  assert.deepEqual(await runner.run("print(2)", "python"), {ok:true, executed:1});
  assert.equal(executions, 1);
});
