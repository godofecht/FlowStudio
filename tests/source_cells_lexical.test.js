"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCells, cellAt } = require("../web/source_cells.js");

test("Python triple-quoted docstrings do not introduce false cells", () => {
  const source = 'text = """\n# %% not a cell\n"""\n# %%\nprint(text)\n';
  assert.deepEqual(parseCells(source).map(cell => cell.code),
    ['text = """\n# %% not a cell\n"""\n', 'print(text)\n']);
  assert.equal(cellAt(source, source.indexOf("not a cell")).index, 0);
});

test("R multiline strings and backtick names cannot introduce false cells", () => {
  const source = 'x <- "one\n# %% inside a string\ntwo"\n`key\n# %% still name` <- 3\n# %%\ny <- 4\n';
  assert.deepEqual(parseCells(source).map(cell => cell.code),
    ['x <- "one\n# %% inside a string\ntwo"\n`key\n# %% still name` <- 3\n', 'y <- 4\n']);
});

test("block-comment-like text is conservatively ignored", () => {
  const source = '/*\n# %% comment\n*/\n# %%\nprintln(3)\n';
  assert.equal(parseCells(source).length, 2);
});

test("quoted delimiter-looking text in a comment does not swallow later markers", () => {
  const source = '# """\n# %%\nx = 1\n';
  assert.deepEqual(parseCells(source).map(x => x.code), ['# """\n', 'x = 1\n']);
});

test("escaped quotes and triple-quote terminators restore marker recognition", () => {
  const source = 'x = """escaped \\" quote\n# %% literal\n"""\n# %% [markdown]\n# Intro\n# %%\nprint(1)';
  assert.deepEqual(parseCells(source).map(x => x.kind), ["code", "markdown", "code"]);
});

test("markdown text is not lexed as code and cannot hide the next marker", () => {
  const source = '# %% [markdown]\n"""\n# %%\nprint(1)';
  assert.deepEqual(parseCells(source).map(x => x.kind), ["markdown", "code"]);
});

test("CRLF markers and trailing empty cells retain exact source offsets", () => {
  const source = 'a = """\r\n# %% hidden\r\n"""\r\n# %%\r\n';
  const cells = parseCells(source);
  assert.equal(cells.length, 2);
  assert.equal(cells[1].code, "");
  assert.equal(cellAt(source, source.length).index, 1);
});

test("cell count is bounded even for small input", () => {
  const source = "# %%\n".repeat(10001);
  assert.throws(() => parseCells(source), /10,000-cell limit/);
});
