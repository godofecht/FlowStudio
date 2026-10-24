"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {flowSymbols, maskFlow, prefixAt, create} = require("../docs/app/completion.js");

const SOURCE = [
  "import std.process { ProcCmd, proc_cmd, proc_run }",
  "struct Record { count: i32 }",
  "function compute(value: i32) -> i32 {",
  "  let mut result: i32 = value",
  "  if result > 0 {",
  "    let hidden: i32 = 1",
  "  }",
  "  let output: i32 = result",
  "  return res",
  "}",
  "function other() -> i32 {",
  "  let otherLocal: i32 = 2",
  "  return 0",
  "}"
].join("\n");

test("Flow completion finds real syntax declarations, imports, parameters and in-scope locals", () => {
  const at = SOURCE.indexOf("return res") + "return res".length;
  assert.deepEqual(flowSymbols(SOURCE, at, "res").items, ["result"]);
  assert.deepEqual(flowSymbols(SOURCE, at, "val").items, ["value"]);
  assert.deepEqual(flowSymbols(SOURCE, at, "proc").items, ["proc_cmd", "proc_run"]);
  assert.deepEqual(flowSymbols(SOURCE, at, "Rec").items, ["Record"]);
  assert.deepEqual(flowSymbols(SOURCE, at, "oth").items, ["other"]);
  assert.deepEqual(flowSymbols(SOURCE, at, "hidden").items, []);
  assert.deepEqual(flowSymbols(SOURCE, at, "otherLocal").items, []);
  assert.deepEqual(flowSymbols(SOURCE, SOURCE.length, "otherLocal").items, []);
});

test("Flow lexical masking does not complete declarations inside comments or strings", () => {
  const source = '# function phantom() -> i32 {}\n' +
    'let message = "function forged() -> i32 {}"\n' +
    "function genuine() -> i32 { return 0 }\n" +
    "function sample() -> i32 { let query = \"hello # fake\"; return gen }";
  assert.deepEqual(flowSymbols(source, source.length - 1, "g").items, ["genuine"]);
  assert.equal(maskFlow('x = "hello\\\"#world" #comment').includes("world"), false);
  const inString = 'function main() -> i32 { println("gen';
  assert.equal(prefixAt({value:inString, selectionStart:inString.length, selectionEnd:inString.length}, "flow"), null);
  const inComment = "function main() -> i32 { # gen";
  assert.equal(prefixAt({value:inComment, selectionStart:inComment.length, selectionEnd:inComment.length}, "flow"), null);
});

test("Flow completion is bounded and rejects invalid prefix and oversized source", () => {
  assert.equal(flowSymbols("x".repeat(262145), 2, "x").ok, false);
  assert.equal(flowSymbols(SOURCE, SOURCE.length, "a;bad").ok, false);
  const many = Array.from({length:100}, (_, i) => "function pre" + i + "() -> i32 { return 0 }").join("\n");
  const response = flowSymbols(many, many.length, "pre");
  assert.equal(response.ok, true);
  assert.equal(response.items.length, 64);
  assert.equal(new Set(response.items).size, 64);
});

test("Flow completion is available without Python/R runtimes and inserts via editor input", async () => {
  const events = {}, notifications = [];
  const value = SOURCE;
  const cursor = value.indexOf("return res") + "return res".length;
  const source = {
    value, selectionStart:cursor, selectionEnd:cursor,
    addEventListener(name, handler) { events[name] = handler; },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0,start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    dispatchEvent(event) { events[event.type]?.(event); },
    focus() {}
  };
  const button = {addEventListener() {}};
  const target = {children:[], replaceChildren(...children) {this.children=children;}};
  const document = {createElement(tag) {return {
    tag, textContent:"", children:[], listeners:{},
    setAttribute() {}, append(child) {this.children.push(child);},
    addEventListener(name, fn) {this.listeners[name]=fn;}
  };}};
  const api = create({source, button, target, language:()=>"flow",
    python:async()=>{throw Error("Python must not run");},
    r:async()=>{throw Error("R must not run");},
    generation:()=>0, isBusy:()=>false, notice:text=>notifications.push(text), document});
  assert.equal(await api.complete(), true);
  assert.equal(target.children[1].children[0].textContent, "result");
  target.children[1].children[0].listeners.click();
  assert.match(source.value, /return result\n/);
  assert.equal(target.children.length, 0);
  assert.match(notifications.at(-1), /Inserted result/);
});
