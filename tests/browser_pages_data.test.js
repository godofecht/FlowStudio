"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const Data = require("../docs/app/data_viewer.js");
const html = fs.readFileSync(path.join(root, "docs/app/index.html"), "utf8");
const viewer = fs.readFileSync(path.join(root, "docs/app/data.html"), "utf8");
const controller = fs.readFileSync(path.join(root, "docs/app/data_page.js"), "utf8");

test("Pages viewer parses quoted CSV with commas, line breaks and escaped quotes", () => {
  const parsed = Data.parseDelimited('name,score\r\n"Alpha, Beta",2\r\n"line\nbreak",10\r\n"said ""hi""",3\r\n');
  assert.deepEqual(parsed.columns, ["name", "score"]);
  assert.deepEqual(parsed.rows, [["Alpha, Beta", "2"], ["line\nbreak", "10"], ['said "hi"', "3"]]);
});
test("Pages viewer parses BOM-prefixed TSV and duplicate columns", () => {
  const parsed = Data.parseDelimited("\ufeffitem\titem\r\na\tb\r\n", "\t");
  assert.deepEqual(parsed.columns, ["item", "item (2)"]);
  assert.deepEqual(parsed.rows, [["a", "b"]]);
});
test("Pages viewer sorts numeric data, filters and preserves stable row order", () => {
  const dataset = Data.parseDelimited("label,value\na,10\nb,2\nc,2\n");
  assert.deepEqual(Data.viewRows(dataset, {sortColumn:1}).rows.map(row => row.values[0]), ["b", "c", "a"]);
  const filtered = Data.viewRows(dataset, {filter:"a"});
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].values[0], "a");
});
test("Pages viewer rejects malformed quoting and NUL content", () => {
  assert.throws(() => Data.parseDelimited('a,b\n"bad"x,2'), /Unexpected character/);
  assert.throws(() => Data.parseDelimited("a,b\n1,\0"), /NUL/);
  assert.throws(() => Data.parseDelimited('a,b\n"unterminated'), /Unterminated/);
});
test("Pages workspace retains image import and opens the full tabular viewer", () => {
  assert.match(html, /id="dataViewer"/);
  assert.match(html, /frame\.src = "\.\/data\.html"/);
  assert.match(html, /id="previewfile"[^>]*accept="\.png,\.jpg,\.jpeg,\.webp"/);
  assert.ok(html.indexOf('id="previewfile"') < html.indexOf('id="workspace"'));
  assert.match(viewer, /src="\.\/data_viewer\.js"/);
  assert.match(viewer, /src="\.\/data_page\.js"/);
  assert.match(controller, /FlowStudioData\.parseDelimited/);
  assert.match(controller, /FlowStudioData\.viewRows/);
});
test("Pages data viewer and workspace JavaScript parse in V8", () => {
  new vm.Script(controller, {filename:"docs/app/data_page.js"});
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x => x[1]).filter(x => x.trim());
  assert.equal(scripts.length, 1);
  new vm.Script(scripts[0], {filename:"docs/app/index.html"});
});
