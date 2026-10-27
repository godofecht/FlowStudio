"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const file = fs.readFileSync(path.join(__dirname, "../frontend/completion.js"), "utf8");
const source = file.replace(/^import '\/ide_completion_core.js';\s*/m, "")
  .replace(/^export /gm, "");
const context = { globalThis: { FlowStudioCompletionCore: require("../web/ide_completion_core.js") } };
vm.runInNewContext(source + "\n globalThis.mathAPI = { mathCommandAt, MATH_COMMANDS };", context);
const { mathCommandAt, MATH_COMMANDS } = context.globalThis.mathAPI;

test("single-backslash mathematical command is recognized", () => {
  const model = { getLineContent: () => "∂ₜvelocity = \\nabla" };
  const match = mathCommandAt(model, { lineNumber: 1, column: 22 });
  assert.equal(match?.command, "nabla");
  assert.equal(match?.length, 6);
});

test("mathematical command vocabulary includes differential and relational operators", () => {
  for (const [name, glyph] of Object.entries({
    partial: "∂", nabla: "∇", laplacian: "∇²", div: "∇·",
    curl: "∇×", otimes: "⊗", mapsto: "↦", pipe: "▷"
  })) assert.equal(MATH_COMMANDS[name], glyph);
});

test("ordinary text does not trigger math completion", () => {
  const model = { getLineContent: () => "return velocity" };
  assert.equal(mathCommandAt(model, { lineNumber: 1, column: 16 }), null);
});
