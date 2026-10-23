"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cells = require("../docs/app/source_cells.js");
test("cell parser isolates active Python code", () => {
  const source = "x=1\n# %%\nprint(x)\n";
  assert.equal(cells.cellAt(source, source.indexOf("print")).code, "print(x)\n");
});
test("markdown cells are non-executable", () => {
  const source = "# %% [markdown]\n# Title\n# %%\nx=1";
  assert.equal(cells.cellAt(source, 5).kind, "markdown");
});