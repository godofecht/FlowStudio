"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {decode} = require("../docs/app/notebook_rmarkdown_import.js");
const {encode} = require("../docs/app/notebook_rmarkdown.js");
const {parseCells} = require("../docs/app/source_cells.js");
const FENCE = "`".repeat(3);
function chunk(header, code) {
  return FENCE + header + "\n" + code + "\n" + FENCE + "\n";
}
test("named R and Python chunks retain labels through import and export", () => {
  const input = chunk("{r Setup.1}", "x <- 42") +
    chunk("{python fig-example_2, eval=TRUE}", "print(3)");
  const decoded = decode(input, parseCells);
  const cells = parseCells(decoded.source);
  assert.deepEqual(cells.map(cell => cell.label), ["Setup.1", "fig-example_2"]);
  assert.match(decoded.source, /# %% \[r\] label=Setup\.1/);
  const exported = encode(decoded.source, decoded.language, parseCells);
  assert.match(exported, /\{r Setup\.1\}/);
  assert.match(exported, /\{python fig-example_2\}/);
  assert.deepEqual(parseCells(decode(exported, parseCells).source)
    .filter(cell => cell.kind === "code").map(cell => cell.label),
    ["Setup.1", "fig-example_2"]);
});
test("disabled named chunks remain inert and retain their exact header", () => {
  const input = chunk("{r never-run, eval=FALSE}", "stop('inert')") +
    chunk("{r safe-run}", "print(1)");
  const decoded = decode(input, parseCells);
  assert.deepEqual(parseCells(decoded.source).map(cell => cell.kind), ["markdown", "code"]);
  const output = encode(decoded.source, "r", parseCells);
  assert.match(output, /\{r never-run, eval=FALSE\}/);
  assert.match(output, /\{r safe-run\}/);
});
test("duplicate chunk labels are rejected including disabled chunks", () => {
  assert.throws(() => decode(chunk("{r a}", "1") +
    chunk("{python a, eval=FALSE}", "2"), parseCells), /Duplicate R Markdown chunk label/);
  assert.throws(() => encode("# %% [r] label=a\n1\n# %% [r] label=a\n2\n",
    "r", parseCells), /Duplicate R Markdown chunk label/);
});
test("malformed and executable R expressions in chunk labels are rejected", () => {
  for (const label of ["1bad", "a/b", "a;system('x')", "a b", "a".repeat(81)]) {
    assert.throws(() => decode(chunk("{r " + label + "}", "1"), parseCells),
      /Unsupported R Markdown chunk/);
  }
  assert.throws(() => encode("# %% [r] label=bad/slash\nprint(1)\n",
    "r", parseCells), /Invalid R Markdown chunk label/);
});
test("unnamed source-cell contract and default language remain unchanged", () => {
  const cells = parseCells("# %% [r]\ncat(1)\n# %% [python]\nprint(1)");
  assert.ok(!Object.hasOwn(cells[0], "label"));
  assert.ok(!Object.hasOwn(cells[1], "label"));
  assert.match(encode("# %% [r]\ncat(1)", "r", parseCells), /\{r\}/);
});
