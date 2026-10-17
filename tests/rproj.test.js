"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {parse, read, update, MAX_BYTES} = require("../web/rproj.js");
test("imports canonical .Rproj options", () => {
  const data = "Version: 1.0\nRestoreWorkspace: Default\nUseSpacesForTab: Yes\nNumSpacesForTab: 2\n";
  assert.deepEqual(read(data), {RestoreWorkspace:"Default",UseSpacesForTab:"Yes",NumSpacesForTab:"2"});
});
test("preserves BOM, CRLF, comments, unknown fields and order", () => {
  const original = "\ufeffVersion: 1.0\r\n# user comment\r\nCustomThing: remain\r\nNumSpacesForTab: 2\r\n";
  const result = update(original, {NumSpacesForTab:"4",UseSpacesForTab:"Yes"});
  assert.equal(result, "\ufeffVersion: 1.0\r\n# user comment\r\nCustomThing: remain\r\nNumSpacesForTab: 4\r\nUseSpacesForTab: Yes\r\n");
  assert.equal(parse(result).newline, "\r\n");
});
test("unchanged fields and whitespace are not rewritten", () => {
  assert.equal(update("Encoding : UTF-8  \n", {Encoding:"latin1"}), "Encoding : latin1  \n");
  assert.equal(update("Version: 1.0\n", {}), "Version: 1.0\n");
});
test("rejects duplicates and malformed content before modification", () => {
  assert.throws(() => update("Encoding: UTF-8\nEncoding: latin1\n", {Encoding:"UTF-8"}), /Duplicate/);
  assert.throws(() => read("invalid line\n"), /Malformed/);
  assert.throws(() => parse("Version: 1.0\rfoo"), /bare-CR/);
  assert.throws(() => parse("Version: 1.0\r\nEncoding: UTF-8\n"), /Mixed/);
});
test("rejects unknown or unsafe settings and unbounded values", () => {
  assert.throws(() => update("", {BuildType:"Package"}), /Unsupported/);
  assert.throws(() => update("", {Encoding:"UTF-8\nInjected: Yes"}), /Invalid/);
  assert.throws(() => update("", {NumSpacesForTab:"0"}), /1–16/);
  assert.throws(() => update("", {NumSpacesForTab:"17"}), /1–16/);
  assert.throws(() => update("", {SaveWorkspace:"Sometimes"}), /Invalid/);
  assert.throws(() => parse("a".repeat(MAX_BYTES + 1)), /oversized/);
});
test("does not append a final newline to an unterminated file", () => {
  assert.equal(update("Version: 1.0", {Encoding:"UTF-8"}), "Version: 1.0\nEncoding: UTF-8");
});
