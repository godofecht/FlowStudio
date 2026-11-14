"use strict";
/* The Flow Help pane (web/ide_flow_help.js): the cursor word, the Markdown
 * reader, reply checks and F1. */
const test = require("node:test");
const assert = require("node:assert/strict");
const help = require("../web/ide_flow_help.js");

test("wordAt finds the identifier under a 1-based column", () => {
  const line = "    let a: f64 = sqrt(2.0) + my_fn(x)";
  assert.equal(help.wordAt(line, 18), "sqrt");
  assert.equal(help.wordAt(line, 21), "sqrt");   // just after the last letter
  assert.equal(help.wordAt(line, 30), "my_fn");
  assert.equal(help.wordAt(line, 2), "");
  assert.equal(help.wordAt("", 1), "");
});

test("validQuery accepts names and topics and refuses control characters and long text", () => {
  assert.equal(help.validQuery("io_read_text"), true);
  assert.equal(help.validQuery("Arrays and spans"), true);
  assert.equal(help.validQuery(""), true);
  assert.equal(help.validQuery("a\nb"), false);
  assert.equal(help.validQuery("x".repeat(81)), false);
  assert.equal(help.validQuery(null), false);
});

test("blocks reads fenced code, bullets, paragraphs and inline marks", () => {
  const md = "```flow\nfunction sqrt(x: f64) -> f64\n```\n\nSquare root of x.\nDomain: x >= 0.\n\n" +
    "- `println` takes **several** args\n  and wraps.\n- *second*\n\n### Notes\n[docs](https://example.com) here";
  const out = help.blocks(md);
  assert.deepEqual(out.map(block => block.type), ["code", "para", "list", "para", "para"]);
  assert.equal(out[0].lang, "flow");
  assert.equal(out[0].text, "function sqrt(x: f64) -> f64");
  assert.deepEqual(out[1].spans, [{ type: "text", text: "Square root of x. Domain: x >= 0." }]);
  assert.deepEqual(out[2].items[0], [{ type: "code", text: "println" }, { type: "text", text: " takes " },
    { type: "strong", text: "several" }, { type: "text", text: " args and wraps." }]);
  assert.deepEqual(out[2].items[1], [{ type: "em", text: "second" }]);
  assert.deepEqual(out[3].spans, [{ type: "strong", text: "Notes" }]);
  // Links keep their text only; nothing becomes a live URL.
  assert.deepEqual(out[4].spans, [{ type: "text", text: "docs" }, { type: "text", text: " here" }]);
});

test("normalizeReply keeps the fields the pane draws and drops malformed items", () => {
  const reply = help.normalizeReply({ ok: true, query: "sqrt", entries: [
    { name: "sqrt", kind: "function", signature: "function sqrt(x: f32) -> f32", doc: "Root.", source: "Flow standard library",
      path: "lib/stdlib/math.flow", line: 68, usage: "import std.math { sqrt }",
      examples: [{ title: "Standard library", code: "sqrt(2.0)", output: "1.4" }, { title: "bad" }] },
    { kind: "nameless" }],
    related: [{ name: "dual_sqrt", kind: "function", summary: "function dual_sqrt(...)" }, 7] });
  assert.equal(reply.entries.length, 1);
  assert.equal(reply.entries[0].line, 68);
  assert.deepEqual(reply.entries[0].examples, [{ title: "Standard library", code: "sqrt(2.0)", output: "1.4" }]);
  assert.deepEqual(reply.related.map(item => item.name), ["dual_sqrt"]);
  assert.equal(help.normalizeReply({ ok: false }), null);
});

test("F1 opens Flow help in Flow buffers and the command palette elsewhere", () => {
  let handler = null, language = "flow";
  const triggered = [], helped = [];
  const editor = {
    addCommand(key, fn) { assert.equal(key, 59); handler = fn; },
    getModel: () => ({ getLanguageId: () => language }),
    trigger: (source, id) => triggered.push(id)
  };
  assert.equal(help.bindF1({ KeyCode: { F1: 59 } }, editor, { helpAtCursor: target => helped.push(target) }), true);
  handler();
  assert.deepEqual(helped, [editor]);
  language = "python";
  handler();
  assert.deepEqual(triggered, ["editor.action.quickCommand"]);
  assert.equal(helped.length, 1);
});
