"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const native = require("../web/source_cells.js");
const pages = require("../docs/app/source_cells.js");

const fixtures = [
  "a = 1\n# %%\nb = 2\n",
  'text = """\n# %% not a delimiter\n"""\n# %%\nprint(text)\n',
  'x <- "one\r\n# %% hidden\r\ntwo"\r\n# %% [markdown]\r\n# Title\r\n# %%\r\ny <- 4',
  '# %% [markdown]\n"""\n# %%\nprint(1)',
  '/*\n# %% hidden\n*/\n# %%\nprintln(2)',
  'x = "a\\\"b"\r# %%\ry = 2',
  '# %%\n# %%\n',
  'a = 1\r# %%\rb = 2',
];

test("native and GitHub Pages cell parsers return identical source offsets", () => {
  for (const source of fixtures) {
    assert.deepEqual(native.parseCells(source), pages.parseCells(source), source);
    for (let offset = 0; offset <= source.length; offset++) {
      assert.deepEqual(native.cellAt(source, offset), pages.cellAt(source, offset),
        "offset " + offset + " in " + JSON.stringify(source));
    }
  }
});

test("native editor loads the tested parser through Flow's explicit static route", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
  const routes = fs.readFileSync(path.join(root, "src/data_routes.flow"), "utf8");
  assert.match(html, /<script src="\/source_cells\.js"><\/script>/);
  assert.doesNotMatch(html, /BEGIN EMBEDDED SOURCE CELLS MODULE/);
  assert.match(routes, /if url == "\/source_cells\.js"\s*\{\s*return StaticAsset\s*\{\s*path: "web\/source_cells\.js"/);
});

test("native parser stays byte-for-byte aligned with browser workspace parser", () => {
  const root = path.join(__dirname, "..");
  assert.equal(fs.readFileSync(path.join(root, "web/source_cells.js"), "utf8"),
    fs.readFileSync(path.join(root, "docs/app/source_cells.js"), "utf8"));
});
