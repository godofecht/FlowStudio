"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
global.FlowStudioSourceCells = require("../web/source_cells.js");
const {buildNotebook} = require("../web/notebook_export.js");
const {importNotebook} = require("../web/notebook_import.js");
const nb = (cells, lang = "python") => JSON.stringify({
  nbformat: 4, nbformat_minor: 5,
  metadata: {kernelspec: {name: lang === "r" ? "ir" : "python3", language: lang}, language_info: {name: lang}},
  cells
});
const code = source => ({cell_type: "code", source, outputs: [], execution_count: null});
const md = source => ({cell_type: "markdown", source});

test("imports Jupyter code and markdown cells and roundtrips source", () => {
  const result = importNotebook(nb([code(["x = 1\n", "print(x)\n"]), md(["# Title\n", "\n", "**bold**"]), code("print('end')\n")]));
  assert.equal(result.language, "python");
  assert.equal(result.cells, 3);
  const roundtrip = buildNotebook(result.source, "python");
  assert.deepEqual(roundtrip.cells.map(c => c.cell_type), ["code", "markdown", "code"]);
  assert.equal(roundtrip.cells[0].source, "x = 1\nprint(x)\n");
  assert.equal(roundtrip.cells[1].source, "# Title\n\n**bold**\n");
  assert.equal(roundtrip.cells[2].source, "print('end')\n");
});

test("R notebook is inferred without guessing from filename", () => {
  const result = importNotebook(nb([code("x <- 2\n")], "r"));
  assert.equal(result.language, "r");
  assert.equal(buildNotebook(result.source, "r").metadata.kernelspec.name, "ir");
});

test("execution outputs are never imported as source", () => {
  const result = importNotebook(nb([{...code("x=1"), outputs: [{output_type: "stream", text: ["secret"]}]}]));
  assert.equal(result.discardedOutputs, 1);
  assert.ok(!result.source.includes("secret"));
});

test("rejects unknown or conflicting kernels", () => {
  const data = JSON.parse(nb([code("x=1")], "r"));
  data.metadata.language_info.name = "python";
  assert.throws(() => importNotebook(JSON.stringify(data)), /unambiguous/);
  data.metadata.kernelspec.language = "julia";
  assert.throws(() => importNotebook(JSON.stringify(data)), /unambiguous/);
});

test("rejects unsupported raw cells and malformed source", () => {
  assert.throws(() => importNotebook(nb([{cell_type: "raw", source: "x"}])), /Unsupported/);
  assert.throws(() => importNotebook(nb([code(["valid", 42])])), /source must/);
  assert.throws(() => importNotebook("{"), /Invalid notebook JSON/);
  assert.throws(() => importNotebook("[]"), /Jupyter v4/);
});

test("rejects code markers that would alter notebook cell structure", () => {
  assert.throws(() => importNotebook(nb([code("# %%\nprint(1)")])), /would change cell structure/);
});

test("enforces notebook size and cell-count limits", () => {
  assert.throws(() => importNotebook("x".repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  assert.throws(() => importNotebook(nb(Array.from({length: 1001}, () => code("")))), /1000-cell/);
  assert.throws(() => importNotebook(nb([])), /no cells/);
});
