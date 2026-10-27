"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const saveModule = fs.readFileSync(path.join(root, "web/file_save.js"), "utf8").trimEnd();

test("served workspace embeds the independently tested save module", () => {
  assert.ok(html.includes(saveModule));
  assert.match(html, /FlowStudioFileSave\.writeIfUnchanged\(fileHandle, doc\.saved, src\.value\)/);
});

test("opening a source establishes its conflict baseline", () => {
  assert.match(html, /const content = await FlowStudioFileSave\.readSnapshot\(handle\)/);
  assert.match(html,
    /documents\.open\(\{ name: handle\.name, path, text: content,\s*\n\s*language: inferLanguage\(handle\.name\), handle, baseline: content \}\)/);
});

test("a fallback file import starts a fresh tab with its own baseline", () => {
  assert.match(html, /documents\.open\(\{ name: file\.name, text, baseline: text,/);
  assert.doesNotMatch(html, /fileHandle = null/);
  assert.doesNotMatch(html, /projectPath = null/);
});

test("save-as reads the existing destination before the guarded write", () => {
  assert.match(html, /const baseline = await FlowStudioFileSave\.readSnapshot\(handle\)/);
  assert.match(html, /FlowStudioFileSave\.writeIfUnchanged\(handle, baseline, src\.value\)/);
});

test("a completed write records the new baseline on its own document", () => {
  assert.match(html, /documents\.markSaved\(doc\.id, saved\)/);
  assert.doesNotMatch(html, /fileBaseline/);
});
