"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../docs/app/notebook_rmarkdown_import.js");
require("../docs/app/notebook_rmarkdown.js");
const quarto = require("../docs/app/notebook_quarto.js");
const {parseCells} = require("../docs/app/source_cells.js");
const fence = String.fromCharCode(96).repeat(3);

test("exports executable R and Python chunks as real Quarto HTML source", () => {
  const source = "# %% [markdown]\n# Report\n\nText\n" +
    "# %% [r] label=summary\nprint(1)\n" +
    "# %% [python]\nprint('ready')\n";
  const qmd = quarto.encode(source, "r", parseCells);
  assert.match(qmd, /^---\ntitle: "FlowStudio notebook"\nformat: html\n---/);
  assert.ok(qmd.includes(fence + "{r summary}\nprint(1)\n" + fence));
  assert.ok(qmd.includes(fence + "{python}\nprint('ready')\n" + fence));
  assert.doesNotMatch(qmd, /output: html_document|# %%/);
  const restored = quarto.decode(qmd, parseCells);
  assert.deepEqual(parseCells(restored.source).map(cell => [cell.kind,cell.language]),
    [["markdown",null],["code","r"],["code","python"]]);
  assert.equal(parseCells(restored.source)[1].label, "summary");
});

test("preserves supported scalar Quarto YAML and Unicode through roundtrip", () => {
  const qmd = "---\ntitle: 'Résumé'\nauthor: Ada\nformat: html\n---\n\n" +
    fence + "{r analysis}\ncat('μ')\n" + fence + "\n";
  const restored = quarto.decode(qmd, parseCells);
  assert.equal(restored.language, "r");
  assert.equal(restored.metadataDiscarded, false);
  const exported = quarto.encode(restored.source, "r", parseCells);
  assert.match(exported, /^---\ntitle: 'Résumé'\nauthor: Ada\nformat: html\n---/);
  assert.match(exported, /cat\('μ'\)/);
  assert.equal((exported.match(/format:/g) || []).length, 1);
});

test("accepts Quarto documents without YAML using default HTML", () => {
  const restored = quarto.decode("# Heading\n\n" + fence + "{python}\nprint(2)\n" + fence, parseCells);
  assert.equal(restored.language, "python");
  assert.match(quarto.encode(restored.source, "python", parseCells), /format: html/);
});

test("rejects unsupported YAML and executable Quarto options", () => {
  for (const yaml of [
    "---\nformat: pdf\n---\n",
    "---\nformat:\n  html: default\n---\n",
    "---\nexecute: false\nformat: html\n---\n",
    "---\noutput: html_document\n---\n",
    "---\nformat: html\nformat: html\n---\n"
  ]) assert.throws(() => quarto.decode(yaml + fence + "{r}\n1\n" + fence, parseCells));
  assert.throws(() => quarto.decode(fence + "{r}\n#| eval: false\nstop('bad')\n" + fence, parseCells), /chunk options/);
  assert.throws(() => quarto.encode("# %% [r]\n#| eval: false\n1\n", "r", parseCells), /chunk options/);
});

test("refuses Quarto shortcodes and executable inline engines", () => {
  for (const content of ["{{< include _secret.qmd >}}", "{{% if true %}}",
    String.fromCharCode(96) + "{r} 1+1" + String.fromCharCode(96)]) {
    assert.throws(() => quarto.decode(content, parseCells), /shortcodes|inline/);
    assert.throws(() => quarto.encode("# %% [markdown]\n" + content, "r", parseCells), /shortcodes|inline/);
  }
});

test("rejects Flow chunks, unsafe knitr options and oversized inputs", () => {
  assert.throws(() => quarto.encode("# %% [flow]\nfunction main() -> i32 { return 0 }", "r", parseCells), /Flow/);
  assert.throws(() => quarto.decode(fence + "{flow}\n1\n" + fence, parseCells), /Unsupported R Markdown chunk/);
  assert.throws(() => quarto.decode(fence + "{r, echo=FALSE}\n1\n" + fence, parseCells), /Unsupported R Markdown chunk/);
  assert.throws(() => quarto.decode("x".repeat(4 * 1024 * 1024 + 1), parseCells), /4 MiB/);
});

test("browser has wired import/export controls and syntactically valid script", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  for (const id of ["openQuarto","quartoFile","exportQuarto"])
    assert.ok(html.includes('id="' + id + '"'));
  assert.match(html, /src="\.\/notebook_quarto\.js"/);
  assert.match(html, /quarto:FlowStudioQuarto/);
  assert.match(html, /FlowStudioQuarto\.encode\(currentSource, selectedLanguage/);
  assert.match(html, /anchor\.download = reportName \+ "\.qmd"/);
  const inline = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(inline);
  assert.doesNotThrow(() => new vm.Script(inline[1]));
});
