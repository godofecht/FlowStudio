"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const rmd = require("../docs/app/notebook_rmarkdown.js");
const {parseCells} = require("../docs/app/source_cells.js");
const TICK = String.fromCharCode(96);

test("exports Markdown, R and Python as executable R Markdown chunks", () => {
  const source = "# %% [markdown]\n# Analysis\n\nText & symbols\n" +
    "# %% [r]\nx <- 1\nprint(x)\n" +
    "# %% [python]\nprint('hello')\n";
  const output = rmd.encode(source, "r", parseCells);
  assert.match(output, /^---\ntitle: "FlowStudio notebook"\noutput: html_document\n---/);
  assert.match(output, /# Analysis\n\nText & symbols/);
  assert.ok(output.includes(TICK.repeat(3) + "{r}\nx <- 1\nprint(x)\n" + TICK.repeat(3)));
  assert.ok(output.includes(TICK.repeat(3) + "{python}\nprint('hello')\n" + TICK.repeat(3)));
  assert.doesNotMatch(output, /# %%/);
});

test("default R and Python runtimes produce matching chunk engines", () => {
  assert.ok(rmd.encode("# %%\ncat('ok')", "r", parseCells).includes(TICK.repeat(3) + "{r}"));
  assert.ok(rmd.encode("# %%\nprint(2)", "python", parseCells).includes(TICK.repeat(3) + "{python}"));
});

test("rejects Flow rather than pretending knitr can execute Flow", () => {
  assert.throws(() => rmd.encode("function main() -> i32 {}", "flow", parseCells), /Flow chunks/);
  assert.throws(() => rmd.encode("# %% [flow]\nfunction main() -> i32 {}", "r", parseCells), /cannot execute Flow/);
});

test("longer Pandoc fences protect embedded backticks", () => {
  const source = "# %% [r]\ncat('" + TICK.repeat(4) + "')\n";
  const output = rmd.encode(source, "r", parseCells);
  assert.ok(output.includes(TICK.repeat(5) + "{r}\n"));
  assert.ok(output.includes("\n" + TICK.repeat(5) + "\n\n"));
  assert.ok(output.includes("cat('" + TICK.repeat(4) + "')"));
});

test("normalizes CRLF and preserves Unicode and Markdown", () => {
  const source = "# %% [markdown]\r\n# Résumé\r\n# %% [r]\r\nprint('μ')\r\n";
  const output = rmd.encode(source, "r", parseCells);
  assert.ok(output.includes("# Résumé\n"));
  assert.ok(output.includes("print('μ')\n"));
  assert.ok(!output.includes("\r"));
});

test("rejects invalid inputs and cell/byte limits", () => {
  assert.throws(() => rmd.encode("x", "r", null), /parser/);
  assert.throws(() => rmd.encode("x\0", "r", parseCells), /NUL/);
  assert.throws(() => rmd.encode("x".repeat(rmd.MAX_SOURCE_BYTES + 1), "r", parseCells), /2 MiB/);
  assert.throws(() => rmd.encode("x", "r", () => Array(257).fill({kind:"code",code:"x"})), /256/);
  assert.throws(() => rmd.encode("x", "r", () => [{kind:"code",code:"x".repeat(65537)}]), /64 KiB/);
  assert.throws(() => rmd.encode("x", "r", () => [{kind:"raw",code:"x"}]), /Invalid source cell/);
});

test("browser action downloads .Rmd without executing notebook source", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="exportRMarkdown"/);
  assert.match(html, /src="\.\/notebook_rmarkdown\.js"/);
  assert.match(html, /FlowStudioRMarkdown\.encode\(currentSource, selectedLanguage/);
  assert.match(html, /notebookRunner\?\.isRunning\(\)/);
  assert.match(html, /anchor\.download = reportName \+ "\.Rmd"/);
  assert.match(html, /text\/markdown;charset=utf-8/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline[1]));
});
