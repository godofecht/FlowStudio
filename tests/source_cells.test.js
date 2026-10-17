"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCells, cellAt } = require("../web/source_cells.js");

test("unmarked source is one executable cell", () => {
  const source = "a = 1\nb = 2\n";
  assert.deepEqual(parseCells(source).map(x => x.code), [source]);
  assert.equal(cellAt(source, 5).index, 0);
});
test("marker belongs to the following cell", () => {
  const source = "a = 1\n# %%\nb = 2\n# %% third\nc = 3\n";
  assert.deepEqual(parseCells(source).map(x => x.code), ["a = 1\n", "b = 2\n", "c = 3\n"]);
  assert.equal(cellAt(source, source.indexOf("# %%")).index, 1);
  assert.equal(cellAt(source, source.indexOf("third")).index, 2);
  assert.equal(cellAt(source, source.length).index, 2);
});
test("initial marker does not create an empty cell", () => {
  const cells = parseCells("# %%\nprint(1)\n# %%\nprint(2)");
  assert.equal(cells.length, 2);
  assert.equal(cells[0].code, "print(1)\n");
  assert.equal(cells[1].code, "print(2)");
});
test("CRLF, indentation and Unicode preserve exact payload", () => {
  const source = "  # %% title\r\nprint('π')\r\n\t# %%\r\nprint('λ')\r\n";
  assert.deepEqual(parseCells(source).map(x => x.code), ["print('π')\r\n", "print('λ')\r\n"]);
});
test("markdown cells are classified", () => {
  const cells = parseCells("# %% [markdown]\n# Hello\n# %% [md] text\n# More\n# %%\nx = 1");
  assert.deepEqual(cells.map(x => x.kind), ["markdown", "markdown", "code"]);
});
test("ordinary comments are not cell delimiters", () => {
  assert.equal(parseCells("# % almost\n# %%notebook\nx = 1\n").length, 1);
});
test("empty trailing cell never falls back to whole buffer", () => {
  const source = "x = 1\n# %%\n";
  assert.equal(cellAt(source, source.length).code, "");
});
test("source and cursor limits are enforced", () => {
  assert.throws(() => parseCells("x".repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  assert.throws(() => cellAt("x", -1), RangeError);
  assert.throws(() => cellAt("x", 2), RangeError);
});
