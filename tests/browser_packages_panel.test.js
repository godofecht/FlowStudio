"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../docs/app/packages_panel.js"), "utf8");
test("package panel exports a factory", () => {
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(typeof context.FlowStudioPackages.create, "function");
});
test("package panel has valid syntax", () => {
  assert.doesNotThrow(() => new vm.Script(source));
});
