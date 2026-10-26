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
    execute:async (code, language) => {calls.push([code, language]);return execute(code, language);},
    onCell:entry => entries.push(entry), notice:()=>{}});
  return {runner, calls, entries};
}
test("caret executes only current and subsequent mixed-language cells", async () => {
  const source = "# %% [python]\nprint('earlier')\n# %% [markdown]\n# Explanation\n# %% [r]\nx <- 40\n# %% [python]\nprint(42)\n";
  const f = fixture();
  const startIndex = cellAt(source, source.indexOf("x <- 40")).index;
  assert.deepEqual(await f.runner.run(source, "python", {startIndex}), {ok:true, executed:2});
  assert.deepEqual(f.calls, [["x <- 40\n", "r"], ["print(42)\n", "python"]]);
  assert.deepEqual(f.entries.map(entry => entry.index), [2,3]);
});
test("markdown caret renders Markdown but only executes following code", async () => {
  const source = "# %% [python]\nprint('earlier')\n# %% [markdown]\n## Heading\n# %% [r]\ncat(42)\n";
  const f = fixture();
  assert.equal((await f.runner.run(source, "python",
    {startIndex:cellAt(source, source.indexOf("Heading")).index})).executed, 1);
  assert.deepEqual(f.calls, [["cat(42)\n", "r"]]);
  assert.deepEqual(f.entries.map(entry => entry.kind), ["markdown", "code"]);
});
test("native Flow preflight considers only selected cells", async () => {
  const source = "# %% [flow]\nfunction main() -> i32 { return 0 }\n# %% [python]\nprint(42)";
  const f = fixture(false);
  assert.equal((await f.runner.run(source, "python", {startIndex:1})).ok, true);
  assert.deepEqual(f.calls, [["print(42)", "python"]]);
  assert.match((await f.runner.run(source, "python", {startIndex:0})).error,
    /explicitly enabled native Flow/);
});
test("invalid indices and no remaining code do not contact interpreters", async () => {
  const source = "# %% [r]\ncat(42)\n# %% [markdown]\n# End";
  const f = fixture();
  for (const startIndex of [-1, 2.5, NaN, Infinity, 3, "1"])
    assert.match((await f.runner.run(source, "r", {startIndex})).error, /outside the source buffer/);
  assert.match((await f.runner.run(source, "r", {startIndex:1})).error, /No executable source cells/);
  assert.equal(f.calls.length, 0);
});
test("partial run stops at first error without replaying prior cells", async () => {
  const source = "# %% [r]\ncat('earlier')\n# %% [r]\nstop('bad')\n# %% [r]\ncat('unreachable')";
  const f = fixture(false, async code => ({ok:!code.includes("stop"), output:"observed"}));
  const result = await f.runner.run(source, "r", {startIndex:1});
  assert.equal(result.ok, false);
  assert.equal(result.executed, 1);
  assert.equal(result.failedIndex, 1);
  assert.deepEqual(f.calls, [["stop('bad')\n", "r"]]);
});
test("browser toolbar connects real caret to partial notebook execution", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="runFromCell"/);
  assert.match(html, /"runFromCell", "checkSyntax"/);
  assert.match(html, /FlowStudioSourceCells\.cellAt\(currentSource, \$\("source"\)\.selectionStart\)\.index/);
  assert.match(html, /notebookRunner\.run\(currentSource, language, \{startIndex\}\)/);
  assert.match(html, /\$\("runFromCell"\)\.addEventListener\("click", \(\) => \{ void runNotebook\(true\); \}\)/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline[1]));
});
