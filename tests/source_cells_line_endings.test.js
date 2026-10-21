"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCells, cellAt } = require("../web/source_cells.js");

test("CR-only source markers preserve exact code and cursor offsets", () => {
  const source = "a <- 1\r# %%\rb <- 2\r# %% [markdown]\r# text\r# %%\rc <- 3\r";
  const cells = parseCells(source);
  assert.deepEqual(cells.map(c => c.kind), ["code", "code", "markdown", "code"]);
  assert.deepEqual(cells.map(c => c.code), ["a <- 1\r", "b <- 2\r", "# text\r", "c <- 3\r"]);
  assert.equal(cellAt(source, source.indexOf("b <- 2")).index, 1);
});

test("mixed CR/LF/CRLF markers preserve byte-exact slices", () => {
  const source = "x = 1\r# %%\ny = 2\r\n# %%\rz = 3\n";
  const cells = parseCells(source);
  assert.deepEqual(cells.map(c => c.code), ["x = 1\r", "y = 2\r\n", "z = 3\n"]);
  assert.equal(cells[2].start, source.indexOf("# %%\rz"));
});

test("CR-only false markers inside multiline R and Python strings stay ignored", () => {
  const source = "x = '''\r# %% hidden\r'''\r# %%\rprint(x)\r";
  assert.deepEqual(parseCells(source).map(c => c.code), ["x = '''\r# %% hidden\r'''\r", "print(x)\r"]);
});
