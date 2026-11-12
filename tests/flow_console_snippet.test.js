"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { flowSnippetProgram } = require("../web/workspace_console.js");

test("bare Flow statements run inside a generated main", () => {
  assert.equal(flowSnippetProgram('println("hi")'),
    'function main() -> i32 {\n    println("hi")\n    return 0\n}\n');
});

test("top-level declarations stay at file scope, statements go to main", () => {
  const program = flowSnippetProgram(
    "function sq(n: i32) -> i32 {\n    return n * n\n}\nlet y = sq(3)\nprintln(\"done\")");
  assert.equal(program,
    "function sq(n: i32) -> i32 {\n    return n * n\n}\n\n" +
    "function main() -> i32 {\n    let y = sq(3)\n    println(\"done\")\n    return 0\n}\n");
});

test("braces inside strings and comments do not confuse declaration tracking", () => {
  const program = flowSnippetProgram('struct P {\n    x: i32 # }\n}\nprintln("{")');
  assert.match(program, /^struct P \{\n    x: i32 # \}\n\}\n\nfunction main/);
  assert.match(program, /    println\("\{"\)\n    return 0\n\}\n$/);
});

test("programs that define main and declaration-only snippets pass through", () => {
  const full = "function main() -> i32 {\n    return 0\n}";
  assert.equal(flowSnippetProgram(full), full);
  const decl = "function f() -> i32 {\n    return 1\n}";
  assert.equal(flowSnippetProgram(decl), decl);
});
