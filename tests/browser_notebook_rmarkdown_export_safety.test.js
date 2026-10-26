"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {encode} = require("../docs/app/notebook_rmarkdown.js");
const {decode} = require("../docs/app/notebook_rmarkdown_import.js");
const {parseCells} = require("../docs/app/source_cells.js");
const tick = String.fromCharCode(96);
const slash = String.fromCharCode(92);
const fence = tick.repeat(3);
const markdown = body => "# %% [markdown]\n" + body;

test("R Markdown export refuses executable chunks hidden in inert Markdown", () => {
  for (const info of ["{r}", "{python}", "{bash}", "{r, eval=TRUE}",
    "{r, eval=F}", "{r, eval=FALSE, child='other.Rmd'}",
    "{r, eval=FALSE, echo=TRUE}"]) {
    const source = markdown(fence + info + "\nstop('unexpected')\n" + fence + "\n");
    assert.throws(() => encode(source, "r", parseCells),
      /Executable or unsupported R Markdown chunk/);
  }
  assert.throws(() => encode(markdown("~~~{r}\nprint(1)\n~~~\n"), "r", parseCells),
    /Executable or unsupported R Markdown chunk/);
});

test("R Markdown export refuses inline knitr R execution in inert Markdown", () => {
  assert.throws(() => encode(markdown("Answer: " + tick + "r 1 + 2" + tick + ".\n"),
    "r", parseCells), /Executable inline R/);
  assert.throws(() => encode(markdown("Value: " + tick + "r stop('side effect')" + tick),
    "python", parseCells), /Executable inline R/);
});

test("literal eval=FALSE chunks survive export without becoming executable", () => {
  const inert = fence + "{r, eval=FALSE}\nstop('never')\n" + fence + "\n" +
    "~~~{python setup, eval = FALSE}\nraise Exception('never')\n~~~\n";
  const exported = encode(markdown(inert), "r", parseCells);
  assert.ok(exported.includes(inert.trim()));
  const imported = decode(exported, parseCells);
  assert.ok(parseCells(imported.source).every(cell => cell.kind === "markdown"));
});

test("ordinary fenced code and escaped inline examples remain inert", () => {
  const inert = fence + "json\n" + tick + "r 1 + 2" + tick + "\n" + fence + "\n" +
    "Literal " + slash + tick + "r 1 + 2" + slash + tick + " and " + tick + "code" + tick + ".\n";
  const exported = encode(markdown(inert), "r", parseCells);
  assert.ok(exported.includes(inert.trim()));
  const normal = encode("# %% [markdown]\n# Analysis\n# %% [r]\nprint(42)\n", "r", parseCells);
  assert.ok(normal.includes(fence + "{r}\nprint(42)\n" + fence));
});
