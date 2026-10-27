"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../web/ide_completion_core.js");

test("mathematical Flow declarations appear in lexical completion", () => {
  const source = [
    "domain FluidDomain {",
    "}",
    "model NavierStokes on FluidDomain {",
    "    field velocity: Vector²<MetersPerSecond>",
    "}",
    "solver FluidSolver for NavierStokes {",
    "}",
    "function AdvanceSimulation() {",
    "    let currentState = 0",
    "    return currentState",
    "}"
  ].join("\n");
  for (const name of ["FluidDomain", "NavierStokes", "FluidSolver", "velocity"]) {
    const matches = core.flowSymbols(source, source.length, name);
    assert.ok(matches.includes(name), name);
  }
});

test("mathematical Flow keywords and snippets are offered without claiming execution", () => {
  for (const name of ["domain", "model", "solver", "field", "dynamics", "constraint",
    "initial", "spatial", "temporal", "pressure", "enforce", "via", "on"]) {
    assert.ok(core.KEYWORDS.flow.includes(name), name);
  }
  for (const name of ["domain", "model", "solver"]) {
    assert.ok(core.SNIPPETS.flow.some(item => item.label === name), name);
  }
  assert.match(core.SNIPPETS.flow.find(item => item.label === "model").insert, /∂ₜ/);
});

test("native workbench exposes explicit mathematical Flow execution without claiming Flow 2.0 grammar support", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
  assert.match(html, /id="runMathFlow"/);
  assert.match(html, /executeCode\(src\.value, "\[mathematical Flow\]", "mathflow"\)/);
  assert.match(html, /"\/api\/run\/" \+ executionLanguage/);
  const native = fs.readFileSync(path.join(__dirname, "../src/main.flow"), "utf8");
  assert.match(native, /"\/api\/run\/mathflow"/);
  assert.match(native, /"\/api\/check\/mathflow"/);
  assert.match(native, /proc_arg\(command, "src\/math_flow\.py"\)/);
});
