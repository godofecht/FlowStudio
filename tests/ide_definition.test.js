"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const symbols = require("../web/ide_symbols.js");

test("F12 resolves a real Flow declaration from its call site", () => {
  const text = [
    "function main() -> i32 {",
    "    return add(2)",
    "}",
    "function add(x: i32) -> i32 {",
    "    return x + 1",
    "}"
  ].join("\n");
  const offset = text.indexOf("add(2)") + 2;
  assert.equal(symbols.identifierAt("flow", text, offset), "add");
  assert.deepEqual(symbols.definitionAt("flow", text, offset), {
    name: "add", kind: "function", line: 4, column: 10,
    depth: 0, detail: "(x: i32) -> i32 {"
  });
  assert.equal(symbols.definitionAt("flow", text, text.indexOf("missing")), null);
});

test("Python navigation prefers the closest preceding definition", () => {
  const text = [
    "def target():",
    "    return 1",
    "target()",
    "def target():",
    "    return 2",
    "target()"
  ].join("\n");
  const first = text.indexOf("target()");
  const second = text.lastIndexOf("target()");
  assert.equal(symbols.definitionAt("python", text, first + 1).line, 1);
  assert.equal(symbols.definitionAt("python", text, second + 1).line, 4);
});

test("R dotted names resolve without executing any R code", () => {
  const text = "calc.score <- function(x) x * 2\ncalc.score(4)\n";
  const result = symbols.definitionAt("r", text, text.lastIndexOf("calc.score") + 5);
  assert.equal(result.name, "calc.score");
  assert.equal(result.line, 1);
});

test("comments, quoted text and Python triple strings never navigate", () => {
  const text = [
    "# call()",
    "message = 'call()'",
    '"""',
    "def call():",
    '"""',
    "def call():",
    "    return 1",
    "call()"
  ].join("\n");
  assert.equal(symbols.identifierAt("python", text, text.indexOf("call()")), null);
  assert.equal(symbols.identifierAt("python", text, text.indexOf("call()", 10)), null);
  assert.equal(symbols.findDefinitions("python", text, "call").length, 1);
  assert.equal(symbols.definitionAt("python", text, text.lastIndexOf("call()")).line, 6);
  assert.equal(symbols.identifierAt("python", "thing.call()", 8), null);
  assert.equal(symbols.identifierAt("flow", "object.call()", 9), null);
});

test("only a unique definition across other open documents can be followed", () => {
  const docs = [
    { id: "a", language: "flow", text: "function main() -> i32 { return helper(1) }" },
    { id: "b", language: "flow", text: "function helper(x: i32) -> i32 { return x }" },
    { id: "c", language: "python", text: "def helper(): pass" }
  ];
  const found = symbols.uniqueOpenDefinition("flow", docs, "helper", "a");
  assert.equal(found.state, "unique");
  assert.equal(found.documentId, "b");
  assert.equal(found.symbol.line, 1);
  assert.equal(symbols.uniqueOpenDefinition("r", docs, "helper", "a").state, "missing");
  docs.push({ id: "d", language: "flow", text: "function helper() -> i32 { return 2 }" });
  assert.equal(symbols.uniqueOpenDefinition("flow", docs, "helper", "a").state, "ambiguous");
  assert.equal(docs[1].text, "function helper(x: i32) -> i32 { return x }");
});

test("oversized or invalid cursor positions cannot silently select a definition", () => {
  assert.equal(symbols.identifierAt("flow", "name", -1), null);
  assert.equal(symbols.identifierAt("flow", "name", 9), null);
  assert.equal(symbols.identifierAt("julia", "name", 1), null);
  assert.equal(symbols.identifierAt("flow", "x".repeat(symbols.MAX_SOURCE + 1), 1), null);
  assert.throws(() => symbols.uniqueOpenDefinition("flow", Array(25).fill({}), "x", "a"),
    /24 open documents/);
});

test("native editor wires F12, menu and open-buffer navigation without new HTTP routes", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf8");
  assert.match(html, /data-command="goToDefinition"/);
  assert.match(html, /event\.key === "F12"/);
  assert.match(html, /FlowStudioSymbols\.identifierAt/);
  assert.match(html, /FlowStudioSymbols\.findDefinition/);
  assert.match(html, /FlowStudioSymbols\.uniqueOpenDefinition/);
  assert.match(html, /revealPosition\(match\.symbol\.line, match\.symbol\.column\)/);
});
