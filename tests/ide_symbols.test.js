"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const symbols = require("../web/ide_symbols.js");
const root = path.join(__dirname, "..");

test("Flow files list structs and functions in line order", () => {
  const source = fs.readFileSync(path.join(root, "src", "stats.flow"), "utf8");
  const list = symbols.parse("flow", source);
  assert.deepEqual(list.map(item => item.name),
    ["NumericSummary", "summary_empty", "summary_add", "summary_variance", "summary_merge"]);
  assert.deepEqual(list.map(item => item.kind), ["struct", "function", "function", "function", "function"]);
  assert.equal(list[0].line, 4);
  for (let index = 1; index < list.length; index++)
    assert.ok(list[index].line > list[index - 1].line);
  assert.equal(list[1].column, "export function ".length + 1);
  assert.equal(list[1].depth, 0);
  assert.match(list[1].detail, /^\(\)\s*->\s*NumericSummary/);
});

test("Flow locals and comments are not reported as symbols", () => {
  const source = [
    "# function commented_out() -> i32 {",
    "export function outer(x: i32) -> i32 {",
    "    let local: i32 = x + 1",
    "    return local",
    "}",
    "export let counter: i32 = 0",
    ""
  ].join("\n");
  const list = symbols.parse("flow", source);
  assert.deepEqual(list.map(item => item.name), ["outer", "counter"]);
  assert.deepEqual(list.map(item => item.kind), ["function", "value"]);
});

test("Python structure keeps nesting depth and module constants", () => {
  const source = [
    "import os",
    "",
    "MAX_RETRIES = 3",
    "",
    "class Client:",
    "    def __init__(self, host):",
    "        self.host = host",
    "",
    "    async def fetch(self, url):",
    "        return url",
    "",
    "def helper(a, b=2):",
    "    local = a + b",
    "    return local"
  ].join("\n");
  const list = symbols.parse("python", source);
  assert.deepEqual(list.map(item => item.name),
    ["MAX_RETRIES", "Client", "__init__", "fetch", "helper"]);
  assert.deepEqual(list.map(item => item.depth), [0, 0, 1, 1, 0]);
  assert.deepEqual(list.map(item => item.kind),
    ["value", "class", "function", "function", "function"]);
  assert.equal(list[2].line, 6);
  assert.equal(list[2].column, "    def ".length + 1);
  assert.match(list[3].detail, /^\(self, url\)/);
});

test("R files list functions, R6/S4 classes and top-level bindings", () => {
  const source = [
    "library(stats)",
    "",
    "fit <- function(data, ...) {",
    "  total <- sum(data)",
    "  total",
    "}",
    "",
    "Model <- R6Class(\"Model\", public = list())",
    "",
    "threshold <- 0.5",
    "setClass(\"Point\", representation(x = \"numeric\"))"
  ].join("\n");
  const list = symbols.parse("r", source);
  assert.deepEqual(list.map(item => item.name), ["fit", "Model", "threshold", "Point"]);
  assert.deepEqual(list.map(item => item.kind),
    ["function", "class", "value", "class"]);
  assert.equal(list[0].line, 3);
  assert.match(list[0].detail, /^\(data/);
});

test("unknown languages fall back to Flow scanning", () => {
  const list = symbols.parse("julia", "function sample() -> i32 {\n return 0\n}\n");
  assert.deepEqual(list.map(item => item.name), ["sample"]);
});

test("symbol output is bounded and very long lines are skipped", () => {
  const many = Array.from({ length: 500 }, (_, index) => "function f" + index + "() -> i32 {").join("\n");
  assert.equal(symbols.parse("flow", many).length, symbols.MAX_SYMBOLS);
  const long = "x".repeat(symbols.MAX_LINE + 50) + " function hidden() -> i32 {";
  assert.deepEqual(symbols.parse("flow", long), []);
  assert.equal(symbols.parse("flow", "function visible() -> i32 {").length, 1);
});

test("invalid outline input is rejected explicitly", () => {
  assert.throws(() => symbols.parse("flow", 42), /must be a string/);
  assert.throws(() => symbols.parse("flow", "a".repeat(symbols.MAX_SOURCE + 1)),
    /2 MiB outline limit/);
  assert.deepEqual(symbols.parse("flow", ""), []);
});

test("kind glyphs are stable single characters", () => {
  for (const kind of ["function", "class", "struct", "enum", "value", "import"])
    assert.equal([...symbols.glyph(kind)].length, 1);
  assert.equal(symbols.glyph("unknown-kind"), "\u2022");
});
