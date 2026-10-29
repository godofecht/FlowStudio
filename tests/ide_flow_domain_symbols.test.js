"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const symbols = require("../web/ide_symbols.js");
const {searchProject} = require("../web/project.js");

function file(name, source) {
  return {kind:"file", name, async getFile() {
    const bytes = Buffer.from(source, "utf8");
    return {size:bytes.length, arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
  }};
}
function directory(name, children) {
  return {kind:"directory", name, async *entries() {
    for (const entry of Object.entries(children)) yield entry;
  }};
}

test("Flow 2.0 evolution and dynamics declarations appear in the outline", () => {
  const source = [
    "flow Pendulum {",
    "    state angle: f64 = 0.5",
    "}",
    "dsys plant {",
    "    discrete",
    "    dt 0.1",
    "    n 2 m 1 p 1",
    "    A 1.0 0.1 0.0 1.0",
    "    B 0.0 0.1",
    "    C 1.0 0.0",
    "}",
    "horizon rollout finite 50",
    "horizon asymptotic infinite gamma 0.99"
  ].join("\n");
  const found = symbols.parse("flow", source);
  assert.deepEqual(found.map(s=>[s.name,s.kind,s.line,s.column]), [
    ["Pendulum","flow",1,6],["plant","dsys",4,6],
    ["rollout","horizon",12,9],["asymptotic","horizon",13,9]
  ]);
  assert.equal(found[2].detail, "finite 50");
  assert.equal(found[3].detail, "infinite gamma 0.99");
  assert.equal(symbols.glyph("flow"), "~");
  assert.equal(symbols.glyph("dsys"), "D");
});

test("native PDE field declarations are navigable, not mistaken for struct fields", () => {
  const source = [
    "field Temperature : f64[32] on Line # spatial temperature",
    "Temperature evolves as 0.25 * laplacian(Temperature)",
    "boundary Temperature {",
    "    left = 1.0",
    "    right = 2.0",
    "}",
    "function main() -> i32 { return 0 }"
  ].join("\n");
  const found = symbols.parse("flow", source);
  assert.deepEqual(found.map(s=>[s.name,s.kind]), [
    ["Temperature","field"],["main","function"]
  ]);
  const at = source.indexOf("laplacian(Temperature)") + "laplacian(".length + 2;
  const target = symbols.definitionAt("flow", source, at);
  assert.equal(target.line, 1);
  assert.equal(target.column, 7);
  assert.equal(target.detail, "f64[32] on Line");
});

test("F12 follows evolution model and dynamics declarations from actual usages", () => {
  const source = [
    "flow Decay {",
    "    state amount: f64 = 1.0",
    "    amount evolves as -amount",
    "}",
    "dsys plant {",
    "    discrete",
    "}",
    "horizon rollout finite 50",
    "function main() -> i32 {",
    "    let mut model: Decay = Decay_new()",
    "    return 0",
    "}"
  ].join("\n");
  const local = symbols.definitionAt("flow", source, source.lastIndexOf("Decay =") + 2);
  assert.equal(local.kind, "flow");
  assert.equal(local.line, 1);
  assert.equal(symbols.findDefinition("flow", source, "plant").kind, "dsys");
  assert.equal(symbols.findDefinition("flow", source, "rollout").kind, "horizon");
});

test("project F12 discovers a unique unopened Flow model through real file search", async () => {
  const handle = file("model.flow", "flow Oscillator {\n    state phase: f64 = 0.0\n}\n");
  const root = directory("project", {
    "main.flow":file("main.flow", "function main() -> i32 { return 0 }"),
    "models":directory("models", {"model.flow":handle})
  });
  const project = {search:(query,options)=>searchProject(root,query,options)};
  const result = await symbols.findProjectDefinition(project,"flow","Oscillator",[]);
  assert.equal(result.state,"unique");
  assert.equal(result.path,"project/models/model.flow");
  assert.equal(result.symbol.kind,"flow");
  assert.equal(result.symbol.line,1);
  assert.equal(result.handle,handle);
});

test("malformed, commented, indented and quoted domain constructs never become definitions", () => {
  const source = [
    "# flow Phantom {",
    "message = \"dsys Phantom {\"",
    "    flow Nested {",
    "flow MissingBrace",
    "dsys MissingBrace",
    "horizon noMode",
    "field MissingType on Line",
    "field Temperature : f64[8] on Line",
    "horizon valid finite 12"
  ].join("\n");
  const found = symbols.parse("flow",source);
  assert.deepEqual(found.map(s=>s.name),["Temperature","valid"]);
  assert.equal(symbols.findDefinitions("flow",source,"Phantom").length,0);
  assert.equal(symbols.findDefinitions("flow",source,"Nested").length,0);
  assert.equal(symbols.findDefinitions("flow",source,"MissingType").length,0);
});

test("Flow domain indexing does not alter R or Python outline interpretation", () => {
  assert.deepEqual(symbols.parse("python","flow Pendulum {"),[]);
  assert.deepEqual(symbols.parse("r","dsys plant {"),[]);
  assert.equal(symbols.parse("flow","function main() -> i32 { return 0 }")[0].kind,"function");
});
