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
