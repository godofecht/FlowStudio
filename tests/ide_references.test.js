"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const symbols = require("../web/ide_symbols.js");

test("Flow references skip strings, comments and partial names", () => {
  const source = [
    "function calc() -> i32 {",
    "  calc() # calc()",
    "  println(\"calc\")",
    "  calculate()",
    "  return calc()",
    "}"
  ].join("\n");
  assert.deepEqual(symbols.findReferences("flow", source, "calc").matches.map(x => x.line),
    [1, 2, 5]);
});

test("Python references ignore triple strings and member names", () => {
  const source = [
    "def task():",
    "    '''task()",
    "    task()'''",
    "    obj.task()",
    "    task()",
    "    # task()"
  ].join("\n");
  const found = symbols.findReferences("python", source, "task");
  assert.deepEqual(found.matches.map(x => x.line), [1, 5]);
  assert.equal(found.matches[1].column, 5);
  assert.equal(found.truncated, false);
});

test("R dotted identifiers are distinct from strings and member fields", () => {
  const source = 'foo.bar <- 2\nfoo.bar + foo.bar\nx$foo.bar\n"foo.bar"\n# foo.bar';
  assert.deepEqual(symbols.findReferences("r", source, "foo.bar").matches.map(x => x.line),
    [1, 2, 2]);
});

test("limits are enforced and reported, not silently truncated", () => {
  const found = symbols.findReferences("flow", "x ".repeat(205), "x");
  assert.equal(found.matches.length, 200);
  assert.equal(found.truncated, true);
  assert.throws(() => symbols.findReferences("flow", "x", "x", 201), /1–200/);
  assert.throws(() => symbols.findReferences("flow", "x".repeat(2 * 1024 * 1024 + 1), "x"),
    /2 MiB/);
  assert.throws(() => symbols.findReferences("unknown", "x", "x"), /Unsupported/);
});

test("open-tab references prefer active document and never mix languages", () => {
  const docs = [
    { id: "a", name: "a.flow", language: "flow", text: "function work() {}\nwork()" },
    { id: "b", name: "b.flow", language: "flow", text: "work()" },
    { id: "c", name: "c.py", language: "python", text: "work()" }
  ];
  const result = symbols.findOpenReferences("flow", docs, "work", "b");
  assert.deepEqual(result.matches.map(x => x.documentId), ["b", "a", "a"]);
  assert.equal(result.matches[0].documentLabel, "b.flow");
  assert.equal(docs[0].text, "function work() {}\nwork()");
  assert.throws(() => symbols.findOpenReferences("flow", Array(25).fill({}), "x", "a"),
    /24 open documents/);
});

test("native editor exposes Shift+F12 reference results with safe text rendering", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf8");
  assert.match(html, /data-command="findReferences"/);
  assert.match(html, /event\.key === "F12" && event\.target === src && event\.shiftKey/);
  assert.match(html, /id="referenceResults"/);
  assert.match(html, /FlowStudioSymbols\.findOpenReferences/);
  assert.match(html, /button\.textContent = match\.documentLabel/);
  assert.match(html, /activateDocument\(match\.documentId\)/);
  assert.match(html, /revealPosition\(match\.line, match\.column\)/);
});
