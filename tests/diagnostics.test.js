"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { python, sourceRange } = require("../web/diagnostics.js");

test("selects user Python frame instead of worker stack", () => {
  const traceback = 'File "/opt/scripts/python_kernel.py", line 42\n  File "<FlowStudio Python>", line 2, in <module>\nZeroDivisionError';
  assert.deepEqual(python(traceback), { language: "python", line: 2 });
});
test("chooses last user frame for nested calls", () => {
  const trace = 'File "<FlowStudio Python>", line 2, in <module>\nFile "<FlowStudio Python>", line 7, in helper';
  assert.equal(python(trace).line, 7);
});
test("rejects unrelated, invalid and oversized diagnostics", () => {
  assert.equal(python('File "/tmp/code.py", line 4'), null);
  assert.equal(python('File "<FlowStudio Python>", line 0'), null);
  assert.equal(python('x'.repeat(1048577)), null);
  assert.equal(python(null), null);
});
test("maps full-buffer Python diagnostic", () => {
  const src = 'x = 1\ny = 0\nx / y\n';
  assert.deepEqual(sourceRange(src, src, 0, { line: 3 }), { start: 12, end: 17, line: 3 });
});
test("maps selected source offset to actual line", () => {
  const src = 'heading\na = 2\nb = 0\na / b\n';
  const code = 'a = 2\nb = 0\na / b';
  assert.deepEqual(sourceRange(src, code, 8, { line: 3 }), { start: 20, end: 25, line: 4 });
});
test("maps percent cell with CRLF", () => {
  const src = '# %%\r\nx = 1\r\nx / 0\r\n';
  const code = 'x = 1\r\nx / 0\r\n';
  assert.deepEqual(sourceRange(src, code, 6, { line: 2 }), { start: 13, end: 18, line: 3 });
});
test("rejects stale code, invalid offsets and invalid line numbers", () => {
  assert.equal(sourceRange('abc', 'xyz', 0, { line: 1 }), null);
  assert.equal(sourceRange('abc', 'abc', -1, { line: 1 }), null);
  assert.equal(sourceRange('abc', 'abc', 0, { line: 2 }), null);
  assert.equal(sourceRange('abc', 'abc', 0, { line: 0 }), null);
});
test("served diagnostics module and UI integration are synchronized", () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const moduleText = fs.readFileSync(path.join(root, 'web/diagnostics.js'), 'utf8').trim();
  const embedded = html.match(/<!-- BEGIN EMBEDDED DIAGNOSTICS MODULE: mirrors web\/diagnostics\.js -->\s*<script>\s*([\s\S]*?)\s*<\/script>\s*<!-- END EMBEDDED DIAGNOSTICS MODULE -->/);
  assert.ok(embedded);
  assert.equal(embedded[1].trim(), moduleText);
  assert.match(html, /id="jumpError"/);
  assert.match(html, /FlowStudioDiagnostics\.python\(output\)/);
  assert.match(html, /src\.value !== executionSource/);
});
