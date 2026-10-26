"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const report = require("../docs/app/notebook_report.js");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");

const source = "# %% [markdown]\\n# Flow & R <script>\\n# %% [python]\\nprint('py')\\n" +
  "# %% [r]\\ncat('r')\\n# %% [flow]\\nfunction main() -> i32 { return 0 }\\n";
const entries = [
  {index:1,language:"python",ok:true,output:"py <tag>",truncated:false,plots:[]},
  {index:2,language:"r",ok:false,output:"R <error>",truncated:true,plots:[]},
  {index:3,language:"flow",ok:true,output:"Flow ok",truncated:false,plots:[]}
];

test("renders actual Flow, R and Python cells with runtime labels and escaped outputs", () => {
  const bundle = format.encodeBundle(source,"python",entries,parseCells);
  const html = report.renderBundle(bundle,format,parseCells,"Study & Results");
  assert.match(html, /Cell 2 \\(Python\\)/);
  assert.match(html, /Cell 3 \\(R\\)/);
  assert.match(html, /Cell 4 \\(Flow\\)/);
  assert.match(html, /Flow &amp; R &lt;script&gt;/);
  assert.match(html, /py &lt;tag&gt;/);
  assert.match(html, /R &lt;error&gt;/);
  assert.match(html, /Flow ok/);
  assert.match(html, /FlowStudio output was truncated/);
  assert.match(html, /<title>Study &amp; Results<\\/title>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /default-src 'none'/);
});

test("renders default Flow cells and mixed tagged cells without claiming Jupyter kernels", () => {
  const code = "# %%\\nfunction main() -> i32 { return 0 }\\n# %% [python]\\nprint(2)\\n";
  const html = report.renderBundle(format.encodeBundle(code,"flow",[],parseCells),format,parseCells);
  assert.match(html,/Cell 1 \\(Flow\\)/);
  assert.match(html,/Cell 2 \\(Python\\)/);
  assert.doesNotMatch(html,/kernelspec/);
});

test("retains validated PNG output and rejects injected plot URLs", () => {
  const png = "iVBORw0KGgoAAAA=";
  const valid = [{...entries[0],plots:[{png}]}];
  const json = format.encodeBundle(source,"python",valid,parseCells);
  assert.match(report.renderBundle(json,format,parseCells),/src="data:image\\/png;base64,iVBORw0KGgoAAAA="/);
  const forged = JSON.parse(json);
  forged.results[0].plots[0].png = 'x" onerror="alert(1)';
  assert.throws(()=>report.renderBundle(JSON.stringify(forged),format,parseCells),/PNG/);
});

test("rejects corrupt bundles, oversized output and missing codec", () => {
  assert.throws(()=>report.renderBundle("{",format,parseCells),/not valid JSON/);
  assert.throws(()=>report.renderBundle("{}",format,parseCells),/not a supported FlowStudio notebook/i);
  assert.throws(()=>report.renderBundle("{}",null,parseCells),/decoder/);
  assert.throws(()=>format.encodeBundle(source,"python",
    [{...entries[0],output:"x".repeat(131073)}],parseCells),/Notebook output/);
});

test("single-kernel Python and R report export remains available", () => {
  for (const language of ["python","r"]) {
    const json = format.encode("# %%\\nprint(2)\\n",language,[],parseCells);
    const html = report.render(json,"Standard");
    assert.match(html,/Cell 1<\\/h2>/);
    assert.doesNotMatch(html,/Cell 1 \\(Flow\\)/);
  }
});

test("actual browser report action dispatches .fsnb for Flow/mixed source", () => {
  const html = fs.readFileSync(path.join(__dirname,"../docs/app/index.html"),"utf8");
  assert.match(html,/selectedLanguage === "flow"/);
  assert.match(html,/parsed\\.some\\(cell => cell\\.kind === "code"/);
  assert.match(html,/FlowStudioNotebookFormat\\.encodeBundle\\(currentSource/);
  assert.match(html,/FlowStudioNotebookReport\\.renderBundle\\(json/);
  assert.match(html,/notebookExecutionSource === currentSource/);
  assert.match(html,/notebookExecutionLanguage === selectedLanguage/);
  const match = html.match(/<script>\\s*([\\s\\S]*?)<\\/script>/);
  assert.ok(match);
  assert.doesNotThrow(()=>new vm.Script(match[1]));
});
