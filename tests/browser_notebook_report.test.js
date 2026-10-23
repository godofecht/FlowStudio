"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const report = require("../docs/app/notebook_report.js");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");
const notebook = cells => JSON.stringify({nbformat:4, nbformat_minor:4, cells});
test("exports actual Python/R nbformat cells, escaped Markdown and stream output", () => {
  for (const language of ["python", "r"]) {
    const source = "# %% [markdown]\n# Result <script>\n- one\n# %%\nprint('<tag>')";
    const json = format.encode(source, language, [{index:1, kind:"code", ok:true,
      output:"<script>alert(1)</script>", plots:[]}], parseCells);
    const html = report.render(json, 'A & "B"');
    assert.match(html, /<h1>Result &lt;script&gt;<\/h1>/);
    assert.match(html, /<li>one<\/li>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /<title>A &amp; &quot;B&quot;<\/title>/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /https?:\/\//);
  }
});
test("preserves valid PNG plot data and ignores invalid image sources", () => {
  const png = "iVBORw0KGgoAAA==";
  const html = report.render(notebook([{cell_type:"code", source:"plot()", outputs:[
    {output_type:"display_data", data:{"image/png":png}},
    {output_type:"display_data", data:{"image/png":'x" onerror="alert(1)'}}
  ]}]));
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgoAAA=="/);
  assert.doesNotMatch(html, /onerror/);
});
test("rejects invalid notebooks and oversized output without generating a report", () => {
  assert.throws(() => report.render("{"), /Invalid notebook JSON/);
  assert.throws(() => report.render(notebook([{cell_type:"raw", source:"x"}])), /Unsupported notebook cell/);
  assert.throws(() => report.render(notebook([{cell_type:"code", source:"x", outputs:[
    {output_type:"stream", text:"x".repeat(131073)}
  ]}])), /Output exceeds 128 KiB/);
  assert.throws(() => report.render(notebook([{cell_type:"code", source:"x", outputs:"oops"}])), /Invalid notebook outputs/);
  assert.throws(() => report.render(notebook([]), "<".repeat(257)), /Invalid report title/);
});
test("browser UI loads report exporter and uses current-source outputs only", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /id="exportReport"/);
  assert.match(html, /src="\.\/notebook_report\.js"/);
  assert.ok(html.indexOf('src="./notebook_report.js"') < html.indexOf("\n<script>"));
  assert.match(html, /FlowStudioNotebookReport\.render\(json, reportName\)/);
  assert.match(html, /notebookExecutionSource === currentSource/);
  assert.match(html, /notebookExecutionLanguage === selectedLanguage/);
  assert.match(html, /new Blob\(\[html\], \{type:"text\/html;charset=utf-8"\}\)/);
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
