"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const format = require("../docs/app/notebook_format.js");
const report = require("../docs/app/notebook_report.js");
const {parseCells} = require("../docs/app/source_cells.js");

function ipynb(outputs) {
  return JSON.stringify({nbformat:4, nbformat_minor:4,
    metadata:{language_info:{name:"python"}},
    cells:[{cell_type:"code", source:"display(value)", metadata:{},
      execution_count:9, outputs}]});
}
const display = data => ({output_type:"display_data", data, metadata:{}});
const unsafe = "# Result\n<script>alert(1)</script>\n[link](https://example.invalid)";

test("imports Markdown-only Jupyter display as inert text and preserves its MIME", () => {
  const imported = format.decode(ipynb([display({"text/markdown":unsafe})]));
  assert.equal(imported.ignoredOutputs, false);
  assert.equal(imported.entries.length, 1);
  assert.equal(imported.entries[0].output, unsafe);
  assert.deepEqual(imported.entries[0].jupyterOutputs,
    [{output_type:"display_data", metadata:{}, data:{"text/markdown":unsafe}}]);
  const exported = JSON.parse(format.encode(imported.source, "python", imported.entries, parseCells));
  assert.equal(exported.cells[0].execution_count, null);
  assert.deepEqual(exported.cells[0].outputs, imported.entries[0].jupyterOutputs);
  const html = report.render(JSON.stringify(exported));
  assert.match(html, /<h1>Result<\/h1>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<a href=/);
});

test("Markdown wins over plain text in the saved display snapshot", () => {
  const imported = format.decode(ipynb([{
    output_type:"execute_result", execution_count:17, metadata:{},
    data:{"text/plain":"PLAIN FALLBACK", "text/markdown":"## Markdown"}
  }]));
  assert.equal(imported.entries[0].output, "## Markdown");
  assert.equal(imported.ignoredOutputs, false);
  const output = JSON.parse(format.encode(imported.source, "python", imported.entries, parseCells))
    .cells[0].outputs[0];
  assert.deepEqual(output.data, {"text/plain":"PLAIN FALLBACK", "text/markdown":"## Markdown"});
  assert.equal(output.execution_count, null);
  const html = report.render(ipynb([output]));
  assert.match(html, /<h2>Markdown<\/h2>/);
  assert.doesNotMatch(html, /PLAIN FALLBACK/);
});

test("portable v2 retains Markdown MIME and renders it without active content", () => {
  const imported = format.decode(ipynb([display({"text/markdown":unsafe})]));
  const bundle = format.encodeBundle(imported.source, "python", imported.entries, parseCells);
  assert.equal(JSON.parse(bundle).version, 2);
  const decoded = format.decodeBundle(bundle, parseCells);
  assert.equal(decoded.entries[0].output, unsafe);
  const html = report.renderBundle(bundle, format, parseCells);
  assert.match(html, /<div class="markdown-output">/);
  assert.match(html, /<h1>Result<\/h1>/);
  assert.doesNotMatch(html, /<script>|<a href=/);
  assert.match(html, /default-src 'none'/);
});

test("unsupported active MIME drops verbatim provenance but retains inert Markdown text", () => {
  const imported = format.decode(ipynb([display({
    "text/markdown":"**safe**", "text/html":"<img src=x onerror=alert(1)>"
  })]));
  assert.equal(imported.entries[0].output, "**safe**");
  assert.equal(imported.ignoredOutputs, true);
  assert.equal(imported.entries[0].jupyterOutputs, undefined);
  const output = JSON.parse(format.encode(imported.source, "python", imported.entries, parseCells))
    .cells[0].outputs;
  assert.deepEqual(output, [{output_type:"stream", name:"stdout", text:"**safe**"}]);
});

test("invalid Markdown MIME uses plain text fallback and never preserves malformed records", () => {
  const imported = format.decode(ipynb([display({
    "text/markdown":{evil:"<script>"}, "text/plain":"safe fallback"
  })]));
  assert.equal(imported.entries[0].output, "safe fallback");
  assert.equal(imported.ignoredOutputs, true);
  assert.equal(imported.entries[0].jupyterOutputs, undefined);
});

test("altered Markdown display snapshot is rejected for .ipynb and .fsnb export", () => {
  const imported = format.decode(ipynb([display({"text/markdown":"# Original"})]));
  imported.entries[0].jupyterOutputs[0].data["text/markdown"] = "# Forged";
  assert.throws(() => format.encode(imported.source, "python", imported.entries, parseCells),
    /no longer match the displayed snapshot/);
  assert.throws(() => format.encodeBundle(imported.source, "python", imported.entries, parseCells),
    /no longer match the displayed snapshot/);
});

test("oversized Markdown snapshots are not exported as successful display records", () => {
  const imported = format.decode(ipynb([display({"text/markdown":"a".repeat(131073)})]));
  assert.equal(imported.ignoredOutputs, true);
  assert.equal(imported.entries.length, 0);
});

test("oversized plain fallback cannot hide behind a small Markdown representation", () => {
  const imported = format.decode(ipynb([display({
    "text/markdown":"# Short", "text/plain":"a".repeat(131073)
  })]));
  assert.equal(imported.entries[0].output, "# Short");
  assert.equal(imported.entries[0].jupyterOutputs, undefined);
  assert.equal(imported.ignoredOutputs, true);
  const exported = JSON.parse(format.encode(imported.source, "python", imported.entries, parseCells));
  assert.deepEqual(exported.cells[0].outputs,
    [{output_type:"stream", name:"stdout", text:"# Short"}]);
});
