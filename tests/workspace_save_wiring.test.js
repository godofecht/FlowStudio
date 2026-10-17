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
  assert.match(html, /fileBaseline = await FlowStudioFileSave\.writeIfUnchanged\(fileHandle, fileBaseline, src\.value\)/);
});

test("opening a source establishes its conflict baseline", () => {
  assert.match(html, /const content = await FlowStudioFileSave\.readSnapshot\(handle\)/);
  assert.match(html, /fileHandle = handle;\s*fileBaseline = content/);
});

test("fallback source import clears the old handle baseline", () => {
  assert.match(html, /fileHandle = null;\s*fileBaseline = null;\s*projectPath = null/);
});

test("save-as reads existing destination before guarded write", () => {
  assert.match(html, /const baseline = await FlowStudioFileSave\.readSnapshot\(handle\)/);
  assert.match(html, /FlowStudioFileSave\.writeIfUnchanged\(handle, baseline, src\.value\)/);
});
