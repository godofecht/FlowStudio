"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../docs/app/notebook_report.js");
const nb = cells => JSON.stringify({nbformat:4,cells});

test("renders GFM pipe tables with fixed alignment classes and safe code spans", () => {
  const html = report.markdown("| Name | Result |\n| :--- | ---: |\n| x | \`a|b\` |\n| y | <script> |");
  assert.match(html, /<table><thead><tr><th class="align-left">Name<\/th><th class="align-right">Result<\/th>/);
  assert.match(html, /<td class="align-right"><code>a\|b<\/code><\/td>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|onclick=/);
});

test("escaped pipes, Unicode, short rows and center alignment preserve values", () => {
  const html = report.markdown("| Label | Data |\n| :---: | --- |\n| α\\|β | ✓ |\n| short |");
  assert.match(html, /<th class="align-center">Label<\/th>/);
  assert.match(html, /<td class="align-center">α\|β<\/td>/);
  assert.match(html, /<td>✓<\/td>/);
  assert.match(html, /<td><\/td>/);
});

test("invalid delimiter and excess columns remain inert literal Markdown", () => {
  for (const value of ["| A | B |\n| --- | nope |\n| x | y |",
                       "| A | B |\n| --- | --- |\n| x | y | z |"]) {
    const html = report.markdown(value);
    if (value.includes("nope")) assert.doesNotMatch(html, /<table>/);
    assert.doesNotMatch(html, /<script>|<a href=/);
  }
  const wide = Array(17).fill("x").join(" | ");
  assert.doesNotMatch(report.markdown(wide + "\n" + Array(17).fill("---").join(" | ")), /<table>/);
});

test("table parser never treats fenced code as a table", () => {
  const html = report.markdown("~~~r\n| a | b |\n| --- | --- |\n~~~");
  assert.match(html, /<pre><code class="language-r">\| a \| b \|\n\| --- \| --- \|<\/code><\/pre>/);
  assert.doesNotMatch(html, /<table>/);
});

test("Markdown MIME and portable report use identical inert table rendering", () => {
  const content = "| <img src=x onerror=1> | Value |\n| --- | ---: |\n| a | [external](https://example.invalid) |";
  const html = report.render(nb([{cell_type:"code",source:"x",outputs:[
    {output_type:"display_data",data:{"text/markdown":content}}
  ]}]));
  assert.match(html, /<div class="markdown-output"><table>/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(html, /<img|<a href=|<script>/);
  assert.match(html, /default-src 'none'/);
});

test("report output retains bounded HTML and static table styling", () => {
  const html = report.render(nb([{cell_type:"markdown",source:"| x | y |\n| --- | --- |\n| 1 | 2 |"}]));
  assert.match(html, /<table>/);
  assert.match(html, /table\{border-collapse:collapse/);
  assert.match(html, /<td>2<\/td>/);
});
