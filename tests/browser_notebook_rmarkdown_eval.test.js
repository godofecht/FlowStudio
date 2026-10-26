"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {decode} = require("../docs/app/notebook_rmarkdown_import.js");
const {encode} = require("../docs/app/notebook_rmarkdown.js");
const {parseCells} = require("../docs/app/source_cells.js");
const {create} = require("../docs/app/notebook_runner.js");
const FENCE = "`".repeat(3);

function chunk(header, source) {
  return FENCE + header + "\n" + source + "\n" + FENCE + "\n";
}
function imported(input) {
  return decode(input, parseCells);
}

test("literal eval=FALSE R and Python chunks remain inert Markdown", () => {
  const input = chunk("{r, eval=FALSE}", "stop('never execute')") +
    chunk("{python, eval = FALSE}", "raise Exception('never execute')") +
    chunk("{r}", "cat(42)");
  const result = imported(input);
  const cells = parseCells(result.source);
  assert.deepEqual(cells.map(cell => cell.kind), ["markdown", "markdown", "code"]);
  assert.deepEqual(cells.map(cell => cell.language), [null, null, "r"]);
  assert.match(cells[0].code, /\{r, eval=FALSE\}/);
  assert.match(cells[1].code, /\{python, eval = FALSE\}/);
  assert.match(cells[2].code, /cat\(42\)/);
});

test("literal eval=TRUE chunks are executable with their original language", () => {
  const result = imported(chunk("{r, eval=TRUE}", "x <- 1") +
    chunk("{python, eval = TRUE}", "print(2)"));
  assert.deepEqual(parseCells(result.source).map(cell => [cell.kind, cell.language]),
    [["code", "r"], ["code", "python"]]);
});

test("disabled chunk stays disabled across R Markdown export and reimport", () => {
  const source = imported(chunk("{r, eval=FALSE}", "stop('inert')") +
    chunk("{r}", "print(7)")).source;
  const exported = encode(source, "r", parseCells);
  assert.match(exported, /\{r, eval=FALSE\}/);
  const roundtrip = parseCells(imported(exported).source);
  assert.deepEqual(roundtrip.map(cell => cell.kind), ["markdown", "markdown", "code"]);
  assert.match(roundtrip[0].code, /title: "FlowStudio notebook"/);
  assert.match(roundtrip[1].code, /stop\('inert'\)/);
});

test("notebook execution never sends imported eval=FALSE chunks to R or Python", async () => {
  const source = imported(chunk("{r, eval=FALSE}", "stop('inert')") +
    chunk("{python, eval=FALSE}", "raise Exception('inert')") +
    chunk("{r}", "cat(19)")).source;
  const calls = [], displayed = [];
  const runner = create({
    parseCells,
    execute: async (code, language) => {
      calls.push({code, language});
      return {ok:true, output:"19"};
    },
    onCell:entry => displayed.push(entry),
    notice:() => {}
  });
  const result = await runner.run(source, "r");
  assert.equal(result.ok, true);
  assert.equal(result.executed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].language, "r");
  assert.match(calls[0].code, /cat\(19\)/);
  assert.deepEqual(displayed.map(entry => entry.kind), ["markdown", "markdown", "code"]);
});

test("rejects nonliteral eval, other knitr options and malformed disabled chunks", () => {
  for (const header of ["{r, eval=F}", "{r, eval=1}", "{r, eval=FALSE, echo=TRUE}",
    "{python, echo=FALSE}", "{r, eval = false}", "{bash, eval=FALSE}",
    "{r, eval=TRUE || FALSE}"]) {
    assert.throws(() => imported(chunk(header, "print(1)")), /Unsupported R Markdown chunk/);
  }
  assert.throws(() => imported(FENCE + "{r, eval=FALSE}\nstop('inert')"),
    /Unterminated/);
});

test("disabled chunk retains existing size and percent-marker rejection", () => {
  assert.throws(() => imported(chunk("{r, eval=FALSE}", "# %% [r]\nprint(1)")),
    /percent-cell marker/);
  assert.throws(() => imported(chunk("{r, eval=FALSE}", "x".repeat(65537))),
    /64 KiB/);
});
