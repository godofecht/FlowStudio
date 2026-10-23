"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../docs/app/source_selection.js"), "utf8");
function api() {
  const context = {TextEncoder};
  vm.runInNewContext(source, context);
  return context.FlowStudioSourceSelection;
}
function editor(value, start, end) { return {value, selectionStart:start, selectionEnd:end}; }

test("run whole source even with a nonempty selection", () => {
  const result = api().prepare(editor("first()\nsecond()", 0, 7), false);
  assert.equal(result.ok, true);
  assert.equal(result.code, "first()\nsecond()");
});
test("run selection extracts exact UTF-16 range without adjacent code", () => {
  const text = "x = '🧠'\nprint(x)\n";
  const start = text.indexOf("print");
  const result = api().prepare(editor(text, start, start + 8), true);
  assert.equal(result.ok, true);
  assert.equal(result.code, "print(x)");
});
test("no selection and invalid ranges fail closed", () => {
  const s = api();
  assert.equal(s.prepare(editor("print(1)", 3, 3), true).ok, false);
  assert.equal(s.prepare(editor("print(1)", -1, 6), true).ok, false);
  assert.equal(s.prepare(editor("print(1)", 0, 300), true).ok, false);
  assert.equal(s.prepare(null, true).ok, false);
});
test("whitespace-only selections are rejected", () => {
  const result = api().prepare(editor("  \nprint(1)", 0, 3), true);
  assert.equal(result.ok, false);
});
test("submission bound is measured in UTF-8 bytes", () => {
  const s = api();
  assert.equal(s.prepare(editor("é".repeat(32768), 0, 0), false).ok, true);
  assert.equal(s.prepare(editor("é".repeat(32769), 0, 0), false).ok, false);
});
test("browser wiring includes explicit run-selection action and keyboard shortcut", () => {
  const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
  assert.match(html, /<script src="\.\/source_selection\.js"><\/script>/);
  assert.match(html, /id="runSelection"/);
  assert.match(html, /FlowStudioSourceSelection\.prepare\(/);
  assert.match(html, /\$\("runSelection"\)\.addEventListener\("click"/);
  assert.match(html, /event\.shiftKey\) \{ event\.preventDefault\(\); void run\(true\); \}/);
});
