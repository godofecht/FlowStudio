"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");
const {create} = require("../docs/app/notebook_io.js");

function ipynb(cells, language = "python") {
  return JSON.stringify({nbformat:4, nbformat_minor:4,
    metadata:{language_info:{name:language}}, cells});
}
function code(source, outputs = []) {
  return {cell_type:"code", metadata:{}, source, execution_count:7, outputs};
}
const stream = (text, name = "stdout") => ({output_type:"stream", name, text});
const png = "iVBORw0KGgoAAA==";

test("imports real Jupyter stdout, stderr, display text and PNG without executing", () => {
  const data = format.decode(ipynb([code("print(42)", [
    stream(["42", "\n"]), stream("warning\n", "stderr"),
    {output_type:"execute_result", data:{"text/plain":["[1] 42"]}},
    {output_type:"display_data", data:{"image/png":png}}
  ])]));
  assert.equal(data.entries.length, 1);
  assert.deepEqual(data.entries[0], {index:0, kind:"code", language:"python",
    ok:true, output:"42\nwarning\n[1] 42", truncated:false,
    plots:[{png}], images:[]});
  assert.equal(data.ignoredOutputs, false);
  assert.equal(data.hadOutputs, true);
});

test("imports traceback as inert failed-cell text, not a resumed interpreter", () => {
  const data = format.decode(ipynb([code("raise ValueError()", [
    {output_type:"error", ename:"ValueError", evalue:"bad",
      traceback:["Traceback", "<script>alert(1)</script>"]}
  ])]));
  assert.equal(data.entries[0].ok, false);
  assert.equal(data.entries[0].output, "Traceback\n<script>alert(1)</script>");
  assert.equal(data.entries[0].images.length, 0);
});

test("does not import active HTML, SVG, JS, widget data or arbitrary URLs", () => {
  const data = format.decode(ipynb([code("display(x)", [
    {output_type:"display_data", data:{"text/plain":"safe",
      "text/html":"<img src=x onerror=alert(1)>",
      "image/svg+xml":"<svg onload=alert(1)>",
      "application/vnd.jupyter.widget-view+json":{model_id:"unsafe"}}}
  ])]));
  assert.equal(data.entries[0].output, "safe");
  assert.equal(data.entries[0].plots.length, 0);
  assert.equal(data.ignoredOutputs, true);
});

test("rejects corrupt PNG data without producing an image URL", () => {
  const data = format.decode(ipynb([code("plot()", [
    {output_type:"display_data", data:{"image/png":'x" onerror="alert(1)'}}
  ])]));
  assert.deepEqual(data.entries, []);
  assert.equal(data.ignoredOutputs, true);
});

test("preserves cell indices across markdown and empty cells", () => {
  const data = format.decode(ipynb([
    {cell_type:"markdown", source:"## A\n"},
    code("x = 1", []), code("print(x)", [stream("1")])
  ]));
  assert.deepEqual(data.entries.map(e => e.index), [2]);
  assert.match(data.source, /# %% \[markdown\]/);
  assert.match(data.source, /# %%\nx = 1/);
});

test("UTF-8 output truncation does not split astral characters", () => {
  const data = format.decode(ipynb([code("x", [stream("a".repeat(131071) + "🦊")])]));
  assert.equal(data.entries[0].output, "a".repeat(131071));
  assert.equal(data.entries[0].truncated, true);
  assert.equal(data.ignoredOutputs, true);
});

test("bounds total imported text to one MiB", () => {
  const data = format.decode(ipynb(Array.from({length:9}, (_, i) =>
    code("x" + i, [stream("a".repeat(131072))]))));
  assert.equal(data.entries.length, 8);
  assert.equal(data.entries.reduce((sum, e) => sum + e.output.length, 0), 1048576);
  assert.equal(data.ignoredOutputs, true);
});

test("caps saved result entries at 128 and reports loss", () => {
  const data = format.decode(ipynb(Array.from({length:129}, (_, i) =>
    code("x" + i, [stream(String(i))]))));
  assert.equal(data.entries.length, 128);
  assert.equal(data.entries.at(-1).index, 127);
  assert.equal(data.ignoredOutputs, true);
});

test("caps per-cell outputs and image count without unbounded allocation", () => {
  const images = Array.from({length:9}, () =>
    ({output_type:"display_data", data:{"image/png":png}}));
  const data = format.decode(ipynb([code("plot()", images)]));
  assert.equal(data.entries[0].plots.length, 8);
  assert.equal(data.ignoredOutputs, true);
  const many = format.decode(ipynb([code("x", Array.from({length:65}, () => stream("a")))]));
  assert.equal(many.entries[0].output.length, 64);
  assert.equal(many.ignoredOutputs, true);
});

test("round-trip export retains safe snapshots without fabricating execution counts", () => {
  const original = format.decode(ipynb([code("print(42)", [stream("42\n")])], "r"));
  const exported = JSON.parse(format.encode(original.source, "r", original.entries, parseCells));
  assert.equal(exported.cells[0].execution_count, null);
  assert.equal(exported.cells[0].outputs[0].text, "42\n");
  assert.equal(exported.cells[0].outputs[0].output_type, "stream");
});

test("browser import renders saved output provenance notice and never calls execution", async () => {
  function control() {
    const listeners = {};
    return {addEventListener(type, fn) {listeners[type] = fn;},
      change(files) {return listeners.change({target:{files, value:"old"}});},
      click() {return listeners.click?.();}};
  }
  const openButton = control(), fileInput = control(), saveButton = control();
  const messages = [], imported = [];
  const json = ipynb([code("print(42)", [stream("42")])]);
  create({openButton, fileInput, saveButton, source:{value:""}, language:{value:"python"},
    format, parseCells, isBusy:()=>false, canReplace:()=>true,
    onImported:async value=>imported.push(value), onExport:()=>{},
    getResults:()=>[], getFilename:()=>"x.py", notice:text=>messages.push(text)});
  await fileInput.change([{name:"x.ipynb", size:json.length, text:async()=>json}]);
  assert.equal(imported[0].entries[0].output, "42");
  assert.match(messages.at(-1), /display-only saved outputs/);
  assert.match(messages.at(-1), /interpreter state/);
});

test("real browser renderer uses inert text and only validated PNG data", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /output\.textContent = entry\.kind/);
  assert.match(html, /image\.src = "data:image\/png;base64," \+ plot\.png/);
  assert.match(html, /imported\.entries\.length > 0 \|\| imported\.hadOutputs === undefined/);
});
