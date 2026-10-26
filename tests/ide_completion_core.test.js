"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");
const core = require(path.join(root, "web/ide_completion_core.js"));

test("suggestions merge session symbols, lexical hits, keywords and snippets", () => {
  const flow = core.suggestionsFor("flow", {
    prefix: "ma", session: [], lexical: ["main", "map_values"]
  });
  const labels = flow.map(item => item.label);
  assert.ok(labels.includes("main"));
  assert.ok(labels.includes("map_values"));
  assert.ok(labels.includes("match"), "keyword included");
  const python = core.suggestionsFor("python", {
    prefix: "tot", session: ["total", "totally_fine"], lexical: ["totally_lexical"]
  });
  assert.deepEqual(python.slice(0, 2).map(item => item.label).sort(),
    ["total", "totally_fine"]);
  assert.ok(python.some(item => item.kind === "lexical"));
  const r = core.suggestionsFor("r", { prefix: "", session: [] });
  assert.ok(r.length === 0, "empty prefix suggests nothing");
});

test("suggestions honour per-language prefix rules", () => {
  // R accepts leading dots; Python does not.
  assert.equal(core.validPrefix(".Global", "r"), true);
  assert.equal(core.validPrefix(".hidden", "python"), false);
  assert.equal(core.validPrefix("_", "python"), true);
  assert.equal(core.suggestionsFor("fortran", { prefix: "x" }).length, 0,
    "unsupported languages stay silent");
  const capped = core.suggestionsFor("flow", {
    prefix: "a", lexical: Array.from({ length: 90 }, (_, i) => "a" + String(i).padStart(2, "0"))
  });
  assert.ok(capped.length <= core.MAX_ITEMS);
});

test("flowSymbols finds declarations and imports, skipping comments and strings", () => {
  const source =
    'import std.io { read_text }\n' +
    'function compute(x: i64) -> i64 {\n' +
    '    let doubled: i64 = x * 2  # doubl comment text\n' +
    '    return doubled\n' +
    '}\n' +
    'const LIMIT: i64 = 9\n' +
    'struct Metrics { hits: i64 }\n';
  const names = core.flowSymbols(source, source.length, "co");
  assert.ok(names.includes("compute"), "function name found");
  assert.ok(names.includes("std") === false, "module names are not suggestions");
  const limit = core.flowSymbols(source, source.length, "LI");
  assert.deepEqual(limit, ["LIMIT"]);
  // Cursor inside compute() yields local bindings too.
  const inner = core.flowSymbols(source, source.indexOf("return"), "dou");
  assert.deepEqual(inner, ["doubled"]);
  assert.equal(core.flowSymbols("short", 0, "---"), null, "invalid prefix");
});

test("buffer identifiers respect language identifier shapes", () => {
  const source = "alpha beta_x totals total2 .dotr skip";
  assert.deepEqual([...core.bufferIdentifiers(source, "tot", "python")].sort(),
    ["total2", "totals"]);
  const rSource = ".GlobalEnv gamma";
  assert.ok([...core.bufferIdentifiers(rSource, ".", "r")].includes(".GlobalEnv"));
});
