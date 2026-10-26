"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const format = require("../docs/app/notebook_format.js");
const {parseCells} = require("../docs/app/source_cells.js");

const png = "iVBORw0KGgoAAA==";
function imported() {
  return format.decode(JSON.stringify({nbformat:4, nbformat_minor:4,
    metadata:{language_info:{name:"python"}}, cells:[{
      cell_type:"code", metadata:{}, source:"print('x')", execution_count:19,
      outputs:[
        {output_type:"stream", name:"stdout", text:"x\n"},
        {output_type:"stream", name:"stderr", text:"warning\n"},
        {output_type:"display_data", data:{"text/plain":"figure", "image/png":png}},
        {output_type:"error", ename:"ValueError", evalue:"bad",
          traceback:["Traceback", "ValueError: bad"]}
      ]
    }]}));
}
test("portable v2 preserves ordered Jupyter outputs for later .ipynb export", () => {
  const data = imported();
  const bundle = format.encodeBundle(data.source, "python", data.entries, parseCells);
  assert.equal(JSON.parse(bundle).version, 2);
  const decoded = format.decodeBundle(bundle, parseCells);
  assert.equal(decoded.entries[0].jupyterOutputs.length, 4);
  const ipynb = JSON.parse(format.encode(decoded.source, "python", decoded.entries, parseCells));
  assert.deepEqual(ipynb.cells[0].outputs, [
    {output_type:"stream", name:"stdout", text:"x\n"},
    {output_type:"stream", name:"stderr", text:"warning\n"},
    {output_type:"display_data", metadata:{}, data:{"text/plain":"figure", "image/png":png}},
    {output_type:"error", ename:"ValueError", evalue:"bad",
      traceback:["Traceback", "ValueError: bad"]}
  ]);
  assert.equal(ipynb.cells[0].execution_count, null);
});
test("portable v1 remains the default for ordinary execution snapshots", () => {
  const source = "# %% [python]\nprint(1)\n";
  const entries = [{index:0, kind:"code", language:"python", ok:true,
    output:"1\n", truncated:false, plots:[]}];
  const json = format.encodeBundle(source, "python", entries, parseCells);
  assert.equal(JSON.parse(json).version, 1);
  assert.deepEqual(format.decodeBundle(json, parseCells).entries[0].output, "1\n");
});
test("v2 refuses altered, active, noncanonical or mismatched Jupyter records", () => {
  const data = imported();
  const json = format.encodeBundle(data.source, "python", data.entries, parseCells);
  function reject(change) {
    const object = JSON.parse(json);
    change(object);
    assert.throws(() => format.decodeBundle(JSON.stringify(object), parseCells));
  }
  reject(o => {o.results[0].jupyterOutputs[0].text = "forged";});
  reject(o => {o.results[0].jupyterOutputs[2].data["text/html"] = "<script>unsafe</script>";});
  reject(o => {o.results[0].jupyterOutputs[0].extra = true;});
  reject(o => {o.results[0].jupyterOutputs.push({output_type:"stream",name:"stdout",text:"extra"});});
  reject(o => {o.version = 1;});
  reject(o => {o.results[0].extra = true;});
});
test("v2 export fails closed when a saved snapshot no longer matches", () => {
  const data = imported();
  data.entries[0].output = "changed";
  assert.throws(() => format.encodeBundle(data.source, "python", data.entries, parseCells),
    /no longer match the displayed snapshot/);
  const valid = imported();
  valid.entries[0].jupyterOutputs[0].metadata = {};
  assert.throws(() => format.encodeBundle(valid.source, "python", valid.entries, parseCells),
    /no longer match the displayed snapshot/);
});
test("Flow results cannot claim Jupyter output provenance", () => {
  const source = "# %% [flow]\nfunction main() -> i32 { return 0 }\n";
  const entry = {index:0, kind:"code", language:"flow", ok:true, output:"x",
    truncated:false, plots:[], jupyterOutputs:[{output_type:"stream", name:"stdout", text:"x"}]};
  assert.throws(() => format.encodeBundle(source, "flow", [entry], parseCells),
    /Python\/R/);
});
