"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");
const sourceCells = require("../web/source_cells.js");
const exporter = require("../web/notebook_export.js");
const importer = require("../web/notebook_import.js");

function fixture() {
  const nodes = new Map();
  for (const id of ["source", "language", "status", "importFile", "export"])
    nodes.set(id, { value: "", textContent: "", addEventListener(type, fn) { this[type] = fn; } });
  const doc = { getElementById: id => nodes.get(id), createElement: () => ({click() {}}) };
  const ctx = vm.createContext({document: doc, FlowStudioSourceCells: sourceCells,
    FlowStudioNotebookExport: exporter, FlowStudioNotebookImport: importer,
    Blob, URL: {createObjectURL() {return "blob:local";}, revokeObjectURL() {}}, setTimeout() {}});
  vm.runInContext(fs.readFileSync(path.join(root, "web/notebook_page.js"), "utf8"), ctx);
  return { nodes, importSource: vm.runInContext("importSource", ctx) };
}

function file(name, data) {
  return {name, size: Buffer.byteLength(data), text: async () => data};
}

test("standalone page imports R notebook cells and reports omitted outputs", async () => {
  const f = fixture();
  const nb = JSON.stringify({nbformat: 4, metadata: {kernelspec: {name: "ir", language: "R"}},
    cells: [{cell_type: "code", source: ["x <- 5\n"], outputs: [{output_type: "stream", text: "5"}]}]});
  await f.importSource(file("report.ipynb", nb));
  assert.equal(f.nodes.get("language").value, "r");
  assert.equal(f.nodes.get("source").value, "# %%\nx <- 5\n");
  assert.match(f.nodes.get("status").textContent, /discarded 1 saved outputs/);
});

test("invalid notebook leaves current editor untouched", async () => {
  const f = fixture();
  f.nodes.get("source").value = "keep me";
  f.nodes.get("language").value = "python";
  await assert.rejects(f.importSource(file("bad.ipynb", "{}")), /Jupyter v4/);
  assert.equal(f.nodes.get("source").value, "keep me");
  assert.equal(f.nodes.get("language").value, "python");
});

test("Python source import still works without notebook metadata", async () => {
  const f = fixture();
  await f.importSource(file("a.py", "print(7)\n"));
  assert.equal(f.nodes.get("language").value, "python");
  assert.equal(f.nodes.get("source").value, "print(7)\n");
});
