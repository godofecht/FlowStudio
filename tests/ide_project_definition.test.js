"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const symbols = require("../web/ide_symbols.js");
const {searchProject} = require("../web/project.js");

function file(name, initial) {
  let source = initial;
  return {
    kind: "file", name,
    replace(value) { source = value; },
    async getFile() {
      const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
      return {size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer};
    }
  };
}
function directory(name, children) {
  return {kind: "directory", name,
    async *entries() { for (const entry of Object.entries(children)) yield entry; }};
}
function project(root) {
  return {search: (query, options) => searchProject(root, query, options)};
}

test("F12 resolves a unique Flow declaration in a closed project file", async () => {
  const helper = file("math.flow", "function add(x: i32) -> i32 {\n    return x + 1\n}\n");
  const root = directory("project", {
    "main.flow": file("main.flow", "function main() -> i32 { return add(1) }"),
    "lib": directory("lib", {"math.flow": helper}),
    "notes.txt": file("notes.txt", "function add(x: i32) -> i32 {}")
  });
  const result = await symbols.findProjectDefinition(project(root), "flow", "add", []);
  assert.equal(result.state, "unique");
  assert.equal(result.path, "project/lib/math.flow");
  assert.equal(result.handle, helper);
  assert.equal(result.symbol.line, 1);
  assert.equal(result.symbol.column, 10);
  assert.match(result.source, /return x \+ 1/);
});

test("R and Python lookups respect language and file extension", async () => {
  const root = directory("project", {
    "calc.R": file("calc.R", "calc.score <- function(x) x + 1\n"),
    "calc.py": file("calc.py", "def calc_score(x):\n    return x + 1\n"),
    "calc.flow": file("calc.flow", "function calc_score() -> i32 { return 1 }")
  });
  const r = await symbols.findProjectDefinition(project(root), "r", "calc.score");
  const py = await symbols.findProjectDefinition(project(root), "python", "calc_score");
  assert.equal(r.path, "project/calc.R");
  assert.equal(py.path, "project/calc.py");
});

test("ambiguous project declarations never choose an arbitrary file", async () => {
  const root = directory("project", {
    "a.flow": file("a.flow", "function add() -> i32 { return 1 }"),
    "b.flow": file("b.flow", "function add() -> i32 { return 2 }")
  });
  assert.equal((await symbols.findProjectDefinition(project(root), "flow", "add")).state, "ambiguous");
});

test("commented or quoted declarations are not navigable definitions", async () => {
  const root = directory("project", {
    "a.py": file("a.py", "# def target():\nmessage = 'def target():'\n")
  });
  assert.equal((await symbols.findProjectDefinition(project(root), "python", "target")).state, "missing");
});

test("open editor buffers take precedence over stale disk source", async () => {
  const handle = file("helper.flow", "function helper() -> i32 { return 1 }");
  const root = directory("project", {"helper.flow": handle});
  const open = [{path: "project/helper.flow", handle, language: "flow",
    text: "function renamed() -> i32 { return 1 }"}];
  assert.equal((await symbols.findProjectDefinition(project(root), "flow", "helper", open)).state, "missing");
});

test("truncated or unsafe searches cannot claim a unique definition", async () => {
  const handle = file("helper.flow", "function helper() -> i32 { return 1 }");
  const hit = {path:"project/helper.flow",handle,index:9,length:6,text:"helper"};
  for (const field of ["truncated","skippedLarge","skippedUnsafe"]) {
    const response = {matches:[hit],truncated:false,skippedLarge:0,skippedUnsafe:0};
    response[field] = field === "truncated" ? true : 1;
    const result = await symbols.findProjectDefinition({search:async()=>response},"flow","helper");
    assert.equal(result.state,"incomplete");
  }
});

test("changed file contents between project search and read reject navigation", async () => {
  const handle = file("helper.flow", "function renamed() -> i32 { return 1 }");
  const result = await symbols.findProjectDefinition({
    search:async()=>({matches:[{path:"project/helper.flow",handle,index:9,length:6,text:"helper"}],
      truncated:false,skippedLarge:0,skippedUnsafe:0})
  }, "flow", "helper");
  assert.equal(result.state, "changed");
});

test("invalid UTF-8 project files cannot be navigated", async () => {
  const root = directory("project", {
    "a.flow": file("a.flow", Buffer.from([0xff, 0xfe, 0x61]))
  });
  assert.equal((await symbols.findProjectDefinition(project(root), "flow", "a")).state, "incomplete");
});

test("invalid lookup input is rejected without reading project files", async () => {
  const p = {search:()=>{throw Error("should not run");}};
  await assert.rejects(symbols.findProjectDefinition(p, "flow", "../secret"), /Invalid project/);
  await assert.rejects(symbols.findProjectDefinition(p, "julia", "target"), /Invalid project/);
});

test("native workspace wires asynchronous project navigation with a source guard", () => {
  const html = fs.readFileSync(path.join(__dirname,"..","web","index.html"),"utf8");
  assert.match(html, /async function goToDefinition\(\)/);
  assert.match(html, /FlowStudioSymbols\.findProjectDefinition\(/);
  assert.match(html, /openEditorHandle\(found\.handle, found\.path, isCurrent\)/);
  assert.match(html, /if \(!guard\(\)\) return false/);
  assert.match(html, /src\.value !== found\.source/);
});
