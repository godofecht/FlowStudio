"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const session = require("../web/ide_flow_session.js");

const SCRIPT = [
  "# a script",
  "let x = 41",
  "function sq(n: i32) -> i32 {",
  "    return n * n   # braces { in comments do not count",
  "}",
  "",
  "if x > 3 {",
  '    println("big {")',
  "} else {",
  '    println("small")',
  "}",
  "let total = sq(x) +",
  "    1",
  "total"
].join("\n");

test("items keeps functions, if/else chains and continued lines whole", () => {
  const found = session.items(SCRIPT).map(item => [item.start, item.end, item.declaration]);
  assert.deepEqual(found, [[1, 2, false], [2, 5, true], [6, 11, false], [11, 13, false], [13, 14, false]]);
});

test("an else on its own line joins the if before it", () => {
  const text = "if a {\n    b()\n}\nelse {\n    c()\n}\nd";
  assert.deepEqual(session.items(text).map(item => [item.start, item.end]), [[0, 6], [6, 7]]);
});

test("statementAt returns the statement under the cursor and the next start", () => {
  const offset = SCRIPT.indexOf("return n");
  const statement = session.statementAt(SCRIPT, offset);
  assert.match(statement.code, /^function sq/);
  assert.equal(statement.end, 5);
  assert.equal(SCRIPT.slice(statement.next).split("\n")[0], "if x > 3 {");
  // A blank line runs the next statement.
  const blank = session.statementAt(SCRIPT, SCRIPT.indexOf("\n\nif") + 1);
  assert.match(blank.code, /^if x > 3/);
  // The last statement moves the cursor to the end.
  const last = session.statementAt(SCRIPT, SCRIPT.length - 1);
  assert.equal(last.code, "total");
  assert.equal(last.next, SCRIPT.length);
});

test("hasMain finds a main function", () => {
  assert.equal(session.hasMain("function main() -> i32 {\n    return 0\n}"), true);
  assert.equal(session.hasMain("let main_value = 1"), false);
});

test("the client sends entries with the intent header and publishes variables", async () => {
  const calls = [];
  const replies = {
    "/api/flow/session/eval": { ok: true, output: "42\n", variables: [{ name: "x", type: "i32", display: "41", kept: true }] },
    "/api/flow/session/reset": { ok: true, variables: [] }
  };
  const client = session.createClient(async (url, init) => {
    calls.push([url, init.headers["X-FlowStudio-Intent"], init.body]);
    return { status: 200, ok: true, text: async () => JSON.stringify(replies[url]) };
  });
  const seen = [];
  client.onChange(list => seen.push(list.map(v => v.name)));
  const result = await client.evaluate("x + 1");
  assert.equal(result.data.output, "42\n");
  assert.deepEqual(client.variables().map(v => v.name), ["x"]);
  await client.reset();
  assert.deepEqual(seen, [["x"], []]);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [["/api/flow/session/eval", "run"], ["/api/flow/session/reset", "run"]]);
});

test("a failed entry keeps the reply text when it is not JSON", async () => {
  const client = session.createClient(async () => ({ status: 503, ok: false, text: async () => "helper failed" }));
  const result = await client.evaluate("x");
  assert.equal(result.ok, false);
  assert.equal(result.text, "helper failed");
  assert.equal(client.variables(), null);
});

function fakeDocument() {
  function node(tag) {
    return {
      tag, children: [], dataset: {}, className: "", textContent: "", title: "",
      classList: { items: [], add(name) { this.items.push(name); } },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }
    };
  }
  return { createElement: node };
}

test("renderEnvironment lists values and marks values that are not kept", () => {
  const doc = fakeDocument();
  const container = doc.createElement("div");
  session.renderEnvironment(container, [
    { name: "xs", type: "array<f64, 3>", display: "[1.0, 2.0, 3.0]", kept: true, mutable: true },
    { name: "h", type: "ptr<Handle>", kept: false }
  ], doc);
  const table = container.children[0];
  const rows = table.children.slice(2);
  assert.deepEqual(rows[0].children.map(cell => cell.textContent), ["xs (mut)", "array<f64, 3>", "[1.0, 2.0, 3.0]"]);
  assert.deepEqual(rows[1].children.map(cell => cell.textContent), ["h", "ptr<Handle>", "not kept"]);
  assert.deepEqual(rows[1].classList.items, ["flow-env-lost"]);
  session.renderEnvironment(container, [], doc);
  assert.match(container.children[0].textContent, /No Flow variables yet/);
});

test("scriptView moves top-level statements into main() and maps lines both ways", () => {
  const text = "let x = 41\nfunction sq(n: i32) -> i32 {\n    return n * n\n}\nlet y = sq(x) + base\n";
  const view = session.scriptView(text, [
    { name: "base", type: "i32", kept: true, mutable: true },
    { name: "x", type: "f64", kept: true },            // the script declares x itself
    { name: "h", type: "ptr<T>", kept: false },        // not kept: no value to stand for
    { name: "bad", type: "i32; evil()", kept: true }   // not a type: left out
  ]);
  const lines = view.text.split("\n");
  assert.equal(lines[0], "");
  assert.equal(lines[1], "function sq(n: i32) -> i32 {");
  assert.ok(lines.includes("    function flowstudio_session_0() -> i32"));
  assert.ok(lines.includes("let mut base: i32 = flowstudio_session_0()"));
  assert.ok(!view.text.includes("ptr<T>") && !view.text.includes("evil"));
  assert.equal(lines[view.toVirtual(0)], "let x = 41");
  assert.equal(lines[view.toVirtual(4)], "let y = sq(x) + base");
  assert.equal(view.toVirtual(2), 2, "declaration lines stay put");
  assert.equal(view.toReal(view.toVirtual(4)), 4);
  assert.equal(view.toReal(lines.indexOf("function main() -> i32 {")), null, "generated lines map nowhere");
});

test("scriptView leaves whole programs and declaration-only files alone", () => {
  assert.equal(session.scriptView("function main() -> i32 {\n    return 0\n}\n", []), null);
  assert.equal(session.scriptView("function f() -> i32 {\n    return 1\n}\n", []), null);
});
