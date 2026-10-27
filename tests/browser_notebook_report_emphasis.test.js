"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const report = require("../docs/app/notebook_report.js");

test("renders inline strong, emphasis, deletion and nested formatting", () => {
  assert.equal(report.markdown("**bold** and *italic* and ~~old~~"),
    "<p><strong>bold</strong> and <em>italic</em> and <del>old</del></p>");
  assert.equal(report.markdown("**outer *inner* outer**"),
    "<p><strong>outer <em>inner</em> outer</strong></p>");
  assert.equal(report.markdown("__bold__ and _italic_"),
    "<p><strong>bold</strong> and <em>italic</em></p>");
});

test("code spans, escaped marks, intraword underscores and unmatched marks stay literal", () => {
  const bt = String.fromCharCode(96);
  assert.equal(report.markdown(bt + "**code**" + bt + " and **real**"),
    "<p><code>**code**</code> and <strong>real</strong></p>");
  assert.equal(report.markdown("\\*escaped\\* and word_mid_word and **unclosed"),
    "<p>*escaped* and word_mid_word and **unclosed</p>");
  assert.equal(report.markdown("a " + bt + "\\*not emphasis*" + bt + " b"),
    "<p>a <code>\\*not emphasis*</code> b</p>");
});

test("raw HTML and external links remain inert within emphasis", () => {
  const html = report.markdown("**<img src=x onerror=alert(1)>** and *[link](https://evil.invalid)*");
  assert.match(html, /<strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/);
  assert.doesNotMatch(html, /<img|<a href=|<script/);
});

test("Jupyter Markdown MIME and table cells share inert inline formatting", () => {
  const nb = JSON.stringify({nbformat:4,cells:[{cell_type:"code",source:"x",outputs:[
    {output_type:"display_data",data:{"text/markdown":"**Result** and ~~old~~"}}
  ]}]});
  assert.match(report.render(nb), /<div class="markdown-output"><p><strong>Result<\/strong> and <del>old<\/del><\/p>/);
  const bt = String.fromCharCode(96);
  const table = report.markdown("| Name | Value |\n| --- | --- |\n| **x** | " + bt + "*literal*" + bt + " |");
  assert.match(table, /<td><strong>x<\/strong><\/td>/);
  assert.match(table, /<td><code>\*literal\*<\/code><\/td>/);
});

test("large adversarial unmatched delimiters remain bounded and inert", () => {
  const output = report.markdown("*_~".repeat(40000));
  assert.ok(output.startsWith("<p>"));
  assert.ok(output.length < 140000);
  assert.doesNotMatch(output, /<script|<a href=/);
});
