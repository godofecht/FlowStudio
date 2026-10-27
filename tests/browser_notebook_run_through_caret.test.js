"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {create} = require("../docs/app/notebook_runner.js");
const {parseCells, cellAt} = require("../docs/app/source_cells.js");

function fixture(allowNativeFlow = false, execute = async code => ({ok:true, output:code})) {
  const calls = [], entries = [];
  const runner = create({parseCells, allowNativeFlow,
    execute:async (code, language) => {
      calls.push([code, language]);
      return execute(code, language);
    },
    onCell:entry => entries.push(entry), notice:()=>{}});
  return {runner, calls, entries};
}

test("run through caret executes preceding mixed-language cells but never later cells", async () => {
  const source = "# %% [python]\nx = 1\n# %% [markdown]\n## Notes\n# %% [r]\ny <- 2\n# %% [python]\nprint('later')\n";
  const f = fixture();
  const endIndex = cellAt(source, source.indexOf("y <- 2")).index;
  assert.deepEqual(await f.runner.run(source, "python", {endIndex}), {ok:true, executed:2});
  assert.deepEqual(f.calls, [["x = 1\n", "python"], ["y <- 2\n", "r"]]);
  assert.deepEqual(f.entries.map(entry => [entry.index, entry.kind]),
    [[0, "code"], [1, "markdown"], [2, "code"]]);
});

test("run through a Markdown caret renders it but does not execute later code", async () => {
  const source = "# %% [r]\nx <- 1\n# %% [markdown]\n## Stop here\n# %% [r]\nstop('later')";
  const f = fixture();
  const endIndex = cellAt(source, source.indexOf("Stop here")).index;
  assert.equal((await f.runner.run(source, "r", {endIndex})).executed, 1);
  assert.deepEqual(f.calls, [["x <- 1\n", "r"]]);
  assert.equal(f.entries.at(-1).kind, "markdown");
});

test("native Flow preflight only inspects the inclusive selected range", async () => {
  const source = "# %% [python]\nprint(42)\n# %% [flow]\nfunction main() -> i32 { return 0 }";
  const f = fixture();
  assert.deepEqual(await f.runner.run(source, "python", {endIndex:0}),
    {ok:true, executed:1});
  assert.deepEqual(f.calls, [["print(42)\n", "python"]]);
  assert.match((await f.runner.run(source, "python", {endIndex:1})).error,
    /explicitly enabled native Flow/);
  assert.equal(f.calls.length, 1);
});

test("invalid or reversed notebook ranges reject before interpreter execution", async () => {
  const source = "# %% [r]\ncat(1)\n# %% [r]\ncat(2)";
  const f = fixture();
  for (const endIndex of [-1, 1.5, NaN, Infinity, 2, "1"])
    assert.match((await f.runner.run(source, "r", {endIndex})).error,
      /outside the selected source range/);
  assert.match((await f.runner.run(source, "r", {startIndex:1, endIndex:0})).error,
    /outside the selected source range/);
  assert.equal(f.calls.length, 0);
});

test("range with no executable cells is rejected without contacting kernels", async () => {
  const source = "# %% [markdown]\n# Only prose\n# %% [r]\ncat(42)";
  const f = fixture();
  assert.match((await f.runner.run(source, "r", {endIndex:0})).error,
    /No executable source cells/);
  assert.equal(f.calls.length, 0);
});

test("run through caret preserves stop-on-error and does not run later cells", async () => {
  const source = "# %% [r]\nx <- 1\n# %% [r]\nstop('bad')\n# %% [r]\ncat('unreachable')";
  const f = fixture(false, async code => ({ok:!code.includes("stop"), output:"observed"}));
  const result = await f.runner.run(source, "r", {endIndex:2});
  assert.equal(result.ok, false);
  assert.equal(result.executed, 2);
  assert.equal(result.failedIndex, 1);
  assert.deepEqual(f.calls.map(([code]) => code.trim()), ["x <- 1", "stop('bad')"]);
});

test("default full execution and inclusive last-cell range remain equivalent", async () => {
  const source = "# %% [python]\na=1\n# %% [python]\nb=2";
  const first = fixture(), second = fixture();
  assert.deepEqual(await first.runner.run(source, "python"),
    await second.runner.run(source, "python", {startIndex:0, endIndex:1}));
  assert.deepEqual(first.calls, second.calls);
});

test("browser exposes bounded run-through-caret action with real source-cell lookup", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="runThroughCell"/);
  assert.match(html, /"transferVariable", "runThroughCell"/);
  assert.match(html, /FlowStudioSourceCells\.cellAt\(currentSource, \$\("source"\)\.selectionStart\)\.index/);
  assert.match(html, /notebookRunner\.run\(currentSource, language, \{startIndex, endIndex\}\)/);
  assert.match(html, /\$\("runThroughCell"\)\.addEventListener\("click", \(\) => \{ void runNotebook\(false, true\); \}\)/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline[1]));
});
