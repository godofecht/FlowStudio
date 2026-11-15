"use strict";
/* Python and R blocks in the editor (web/flow_blocks.js): the same reading
 * of blocks as src/flow_blocks.py, pinned by the shared cases, and the
 * language server view that maps positions both ways. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Blocks = require("../web/flow_blocks.js");
const Session = require("../web/ide_flow_session.js");
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "flow_blocks_cases.json"), "utf8"));

function shape(block) {
  return {
    language: block.language, line: block.line, column: block.column, endLine: block.endLine,
    endColumn: block.endColumn, inline: block.inline,
    arguments: block.arguments.map(a => ({ name: a.name, expression: a.expression, column: a.column })),
    result: block.result, code: block.code, firstLine: block.firstLine
  };
}

test("the shared cases hold for the browser reader", () => {
  assert.ok(CASES.length >= 25);
  for (const item of CASES) {
    if (item.error) {
      assert.throws(() => Blocks.find(item.source), error => {
        assert.ok(error instanceof Blocks.BlockError, item.name);
        assert.equal(error.line, item.error.line, item.name);
        assert.equal(error.column, item.error.column, item.name);
        assert.equal(error.message, item.error.message, item.name);
        return true;
      }, item.name);
    } else {
      assert.deepEqual(Blocks.find(item.source).map(shape), item.blocks, item.name);
    }
  }
});

const SCRIPT = [
  "let xs: array<f64, 3> = [1.0, 2.0, 3.0]",
  "let m: f64 = python(xs, k = 2) {",
  "    d = {\"a\": (1,",
  "    2)}",
  "    sum(xs) * k",
  "}",
  "println(m)"
].join("\n");

test("the view keeps every line and replaces the block with a typed extern call", () => {
  const view = Blocks.view(SCRIPT);
  const lines = view.text.split("\n");
  assert.equal(lines[0], "let xs: array<f64, 3> = [1.0, 2.0, 3.0]");
  assert.equal(lines[1], "let m: f64 = flowstudio_view_0(0, xs, 2");
  assert.deepEqual(lines.slice(2, 5), ["", "", ""]);
  assert.equal(lines[5], ")");
  assert.equal(lines[6], "println(m)");
  assert.deepEqual(lines.slice(7), ["extern {", "    function flowstudio_view_0(flowstudio_n: i32, ...) -> f64", "}"]);
});

test("positions of passed values map both ways", () => {
  const view = Blocks.view(SCRIPT);
  const column = SCRIPT.split("\n")[1].indexOf("xs");
  const virtual = view.toVirtualPosition(1, column + 1);
  assert.equal(view.text.split("\n")[1].slice(virtual.character - 1, virtual.character + 1), "xs");
  assert.deepEqual(view.toRealPosition(virtual.line, virtual.character), { line: 1, character: column + 1 });
  // Text before the block keeps its columns.
  assert.deepEqual(view.toVirtualPosition(1, 4), { line: 1, character: 4 });
  // The generated extern lines have no place in the editor.
  assert.equal(view.toRealPosition(8, 4), null);
  // The code of the block maps to itself; the server sees blank lines there.
  assert.deepEqual(view.toRealPosition(3, 0), { line: 3, character: 0 });
});

test("no blocks means no view, and a broken block leaves the text alone", () => {
  assert.equal(Blocks.view("let x: i32 = 1\nif r(x) {\n}\n"), null);
  assert.equal(Blocks.view("let m: f64 = python(xs) {\n    sum(xs)\n"), null);
  assert.equal(Blocks.mask("let a = 1\n"), "let a = 1\n");
});

test("statements around a block split the way Flow sees them", () => {
  const text = "let n: i32 = 2\nlet s: string = python(n) {\n    x = '{'\n    str(n) + x\n}\nprintln(s)\n";
  const items = Session.items(text);
  assert.deepEqual(items.map(item => [item.start, item.end]), [[0, 1], [1, 5], [5, 6]]);
  // Ctrl+Enter sends the block as written.
  assert.ok(items[1].code.includes("x = '{'"));
  const at = Session.statementAt(text, text.indexOf("str(n)"));
  assert.equal(at.start, 1);
  assert.equal(at.end, 5);
});

test("the console script view composes the block view with the session arrangement", () => {
  const variables = [{ name: "xs", type: "array<f64, 3>", kept: true }];
  const text = "let m: f64 = python(xs) {\n    sum(xs)\n}\nm\n";
  const view = Session.scriptView(text, variables);
  assert.ok(view.text.includes("function main() -> i32 {"));
  assert.ok(view.text.includes("function flowstudio_view_0(flowstudio_n: i32, ...) -> f64"));
  const point = view.toVirtualPosition(0, text.indexOf("xs") + 1);
  const virtualLine = view.text.split("\n")[point.line];
  assert.equal(virtualLine.slice(point.character - 1, point.character + 1), "xs");
  assert.deepEqual(view.toRealPosition(point.line, point.character), { line: 0, character: text.indexOf("xs") + 1 });
  assert.equal(view.toReal(point.line), 0);
});

test("a whole program with a block gets a view too", () => {
  const text = "function main() -> i32 {\n    let n: i64 = r() { 7L }\n    return 0\n}\n";
  const view = Session.scriptView(text, []);
  assert.ok(view, "a program with main() and a block needs the block view");
  assert.equal(view.text.split("\n")[1], "    let n: i64 = flowstudio_view_0(0)");
});
