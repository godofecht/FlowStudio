"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
test("standalone console bootstraps its controller", () => {
  const html = fs.readFileSync(path.join(root, "web/console.html"), "utf8");
  assert.match(html, /FlowStudioConsolePage\.mount\(\)/);
  assert.ok(html.indexOf("console_page.js") < html.indexOf("FlowStudioConsolePage.mount()"));
});
