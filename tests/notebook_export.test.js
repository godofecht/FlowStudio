"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
global.FlowStudioSourceCells = require("../web/source_cells.js");
const {buildNotebook, exportFilename} = require("../web/notebook_export.js");

test("Python notebook preserves cell boundaries and code exactly", () => {
  const src = "# %%\r\nx = 'π'\r\n# %% [markdown]\r\n# # Heading\r\n# More text\r\n# %%\r\nprint(x)\r\n";
  const notebook = buildNotebook(src, "python");
  assert.equal(notebook.nbformat, 4);
  assert.equal(notebook.nbformat_minor, 5);
  assert.equal(notebook.metadata.kernelspec.name, "python3");
  assert.deepEqual(notebook.cells.map(c => c.cell_type), ["code", "markdown", "code"]);
  assert.deepEqual(notebook.cells.map(c => c.id), ["cell-1", "cell-2", "cell-3"]);
  assert.equal(notebook.cells[0].source, "x = 'π'\r\n");
  assert.equal(notebook.cells[1].source, "# Heading\nMore text\n");
  assert.equal(notebook.cells[2].source, "print(x)\r\n");
  assert.deepEqual(notebook.cells[2].outputs, []);
  assert.equal(notebook.cells[2].execution_count, null);
});

test("R uses IRkernel metadata, not Python", () => {
  const notebook = buildNotebook("x <- 1\n", "r");
  assert.equal(notebook.metadata.kernelspec.name, "ir");
  assert.equal(notebook.metadata.language_info.name, "r");
  assert.equal(notebook.cells[0].source, "x <- 1\n");
});

test("Markdown conversion preserves non-comment text and blank lines", () => {
  const nb = buildNotebook("# %% [md]\n# First\n#\nraw\n# # Heading\n", "python");
  assert.equal(nb.cells[0].source, "First\n\nraw\n# Heading\n");
});

test("Unknown runtime is rejected rather than claiming Flow kernel support", () => {
  assert.throws(() => buildNotebook("function main() -> i32 {}", "flow"), /Flow Jupyter kernel/);
});

test("Oversized source and malformed input are rejected by existing parser", () => {
  assert.throws(() => buildNotebook("x".repeat(2 * 1024 * 1024 + 1), "python"), /2 MiB/);
  assert.throws(() => buildNotebook(null, "python"), /2 MiB/);
});

test("Source content is JSON encoded without executing or evaluating it", () => {
  const code = "print('</script><img src=x onerror=alert(1)>')\n";
  const nb = JSON.parse(JSON.stringify(buildNotebook(code, "python")));
  assert.equal(nb.cells[0].source, code);
  assert.equal(nb.cells[0].outputs.length, 0);
});

test("Filename is normalized to a local .ipynb name", () => {
  assert.equal(exportFilename("project/notebook.py"), "notebook.ipynb");
  assert.equal(exportFilename("C:\\temp\\my file.R"), "my_file.ipynb");
  assert.equal(exportFilename("../.."), "notebook.ipynb");
});
