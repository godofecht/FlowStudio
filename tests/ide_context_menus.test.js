"use strict";
/* The pure parts of the panel menus (web/ide_context_menus.js). */
const test = require("node:test");
const assert = require("node:assert/strict");
const menus = require("../web/ide_context_menus.js");

const docs = [
  { id: "a", dirty: false }, { id: "b", dirty: true }, { id: "c", dirty: false },
  { id: "d", dirty: false }, { id: "e", dirty: true }
];
const ids = list => list.map(doc => doc.id);

test("pinned tabs come first, each group in open order", () => {
  assert.deepEqual(ids(menus.visualOrder(docs, new Set(["d", "b"]))), ["b", "d", "a", "c", "e"]);
});

test("close commands pick the right tabs and leave pinned ones", () => {
  const none = new Set();
  assert.deepEqual(ids(menus.closeTargets("close", docs, "c", none)), ["c"]);
  assert.deepEqual(ids(menus.closeTargets("others", docs, "c", none)), ["a", "b", "d", "e"]);
  assert.deepEqual(ids(menus.closeTargets("right", docs, "c", none)), ["d", "e"]);
  assert.deepEqual(ids(menus.closeTargets("saved", docs, "c", none)), ["a", "c", "d"]);
  assert.deepEqual(ids(menus.closeTargets("all", docs, "c", none)), ["a", "b", "c", "d", "e"]);
  const pinned = new Set(["a", "e"]);
  assert.deepEqual(ids(menus.closeTargets("others", docs, "c", pinned)), ["b", "d"]);
  assert.deepEqual(ids(menus.closeTargets("all", docs, "c", pinned)), ["b", "c", "d"]);
  assert.deepEqual(ids(menus.closeTargets("right", docs, "a", pinned)), ["b", "c", "d"], "right of a pinned tab, in shown order");
  assert.deepEqual(ids(menus.closeTargets("close", docs, "a", pinned)), ["a"], "Close names a pinned tab directly");
  assert.deepEqual(ids(menus.closeTargets("right", docs, "missing", none)), []);
});

test("variable actions build safe Python and R code", () => {
  assert.equal(menus.variableCode("python", "value", "frame_1"), "print(repr(frame_1))");
  assert.equal(menus.variableCode("python", "remove", "x"), "del x");
  assert.equal(menus.variableCode("r", "value", "my.data"), "print(my.data)");
  assert.equal(menus.variableCode("r", "remove", "df"), "rm(df)");
  assert.throws(() => menus.variableCode("python", "remove", "x; import os"), /not a Python name/);
  assert.throws(() => menus.variableCode("r", "remove", "x); system('id'"), /not an R name/);
  assert.throws(() => menus.variableCode("r", "value", ".2bad"), /not an R name/);
  assert.throws(() => menus.variableCode("flow", "remove", "x"), /Unsupported/);
});

test("relative paths drop the folder name", () => {
  assert.equal(menus.relativePath("proj/src/main.flow", "proj"), "src/main.flow");
  assert.equal(menus.relativePath("other/main.flow", "proj"), "other/main.flow");
  assert.equal(menus.relativePath(null, "proj"), "");
});
