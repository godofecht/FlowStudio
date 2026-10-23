"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "../docs/app/index.html"), "utf8");
test("notebook controller is loaded before workspace bootstrap", () => {
  assert.match(html, /<script src="\.\/notebook_runner\.js"><\/script>/);
  assert.ok(html.indexOf('src="./notebook_runner.js"') < html.indexOf("\n<script>"));
  assert.match(html, /id="runNotebook"/);
});
test("notebook UI uses the real persistent browser Python and R sessions", () => {
  assert.match(html, /FlowStudioNotebook\.create\(/);
  assert.match(html, /FlowStudioSourceCells\.parseCells/);
  assert.match(html, /getRSession\(\)\.run\(code\)/);
  assert.match(html, /request\("run", code\)/);
  assert.match(html, /getRSession\(\)\.inspect\(\)/);
  assert.match(html, /request\("inspect"\)/);
  assert.doesNotMatch(html, /fetch\(["']\/api\/run\/notebook/);
});
test("reset cancels notebook updates and the workspace inline script parses", () => {
  assert.match(html, /notebookRunner\?\.cancel\(\)/);
  assert.match(html, /sessionGeneration\+\+/);
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1], {filename:"docs/app/index.html"}));
});
