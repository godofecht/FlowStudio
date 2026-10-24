"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {flowMembers, prefixAt, create} = require("../docs/app/completion.js");

// Syntax comes from Flow 2.x: explicit struct fields, typed function parameters,
// let mut declarations, and state declarations in a flow evolution model.
const SOURCE = [
  "# struct Phantom { trap: i32 }",
  "struct Point { x: f32, y: f32 }",
  "struct Other { count: i32, alive: bool }",
  "flow Decay {",
  "  state value: f64 = 1.0",
  "  param rate: f64 = 0.5",
  "}",
  "function compute(p: Point, d: Decay) -> i32 {",
  "  p.",
  "  d.va",
  "  if true {",
  "    let mut p: Other = Other { count: 1, alive: true }",
  "    p.",
  "  }",
  "  p.",
  "  let p = 3",
  "  p.",
  "  return 0",
  "}"
].join("\n");
function after(source, needle, occurrence = 0) {
  let pos = -1;
  for (let i = 0; i <= occurrence; i++) pos = source.indexOf(needle, pos + 1);
  assert.notEqual(pos, -1);
  return pos + needle.length;
}
function range(source, cursor) {
  return prefixAt({value:source, selectionStart:cursor, selectionEnd:cursor}, "flow");
}

test("Flow 2.x struct fields and evolution state complete from explicit types", () => {
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n  p."), "p", "").items, ["x", "y"]);
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n  d.va"), "d", "va").items, ["value"]);
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n  d.va"), "d", "ra").items, []);
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n  p."), "unknown", "").items, []);
});

test("Flow members respect lexical shadowing, scope exit and untyped bindings", () => {
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n    p."), "p", "").items, ["alive", "count"]);
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n  p.", 1), "p", "").items, ["x", "y"]);
  assert.deepEqual(flowMembers(SOURCE, after(SOURCE, "\n  p.", 2), "p", "").items, []);
  const globals = "struct Item { key: i32 }\nlet item: Item = Item { key: 1 }\nitem.k";
  assert.deepEqual(flowMembers(globals, globals.length, "item", "k").items, ["key"]);
});

test("Flow member cursor offsets work after a dot and partial field", () => {
  const empty = after(SOURCE, "\n  p.");
  assert.deepEqual(range(SOURCE, empty),
    {prefix:"", start:empty, cursor:empty, receiver:"p"});
  const partial = after(SOURCE, "\n  d.va");
  assert.deepEqual(range(SOURCE, partial),
    {prefix:"va", start:partial - 2, cursor:partial, receiver:"d"});
});

test("Flow completion ignores fake declarations and masked member expressions", () => {
  const fake = 'struct Actual { yes: i32 }\n' +
    'let a: Actual = Actual { yes: 1 }\n' +
    '# struct Actual { fake: i32 }\n' +
    'let note = "struct Actual { bogus: i32 }"\n' +
    'a.y';
  assert.deepEqual(flowMembers(fake, fake.length, "a", "y").items, ["yes"]);
  assert.deepEqual(flowMembers(fake, fake.length, "a", "f").items, []);
  const string = 'function main(p: Actual) -> i32 { println("p.y';
  assert.equal(range(string, string.length), null);
  const comment = "function main(p: Actual) -> i32 { # p.y";
  assert.equal(range(comment, comment.length), null);
  assert.equal(range("p.x", 3) === null, false);
});

test("Flow member results and inputs are bounded", () => {
  const many = Array.from({length:80}, (_, i) => "field" + String(i).padStart(2, "0") + ": i32").join(", ");
  const src = "struct Large { " + many + " }\nfunction main(p: Large) -> i32 { p. }";
  assert.equal(flowMembers(src, src.indexOf("p.") + 2, "p", "").items.length, 64);
  assert.equal(flowMembers("x".repeat(262145), 1, "x", "").ok, false);
  assert.equal(flowMembers(src, 2, "x;evil", "").ok, false);
  assert.equal(flowMembers(src, 2, "p", "x;evil").ok, false);
});

test("Flow completion UI inserts a member after the dot without invoking Python or R", async () => {
  const value = "struct Point { x: f32, y: f32 }\nfunction main(p: Point) -> i32 { p. }";
  const cursor = value.indexOf("p. }") + 2;
  const listeners = {}, notices = [];
  const source = {
    value, selectionStart:cursor, selectionEnd:cursor,
    addEventListener(name, fn) {listeners[name] = fn;},
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.selectionStart = this.selectionEnd = start + text.length;
    },
    dispatchEvent(event) {listeners[event.type]?.(event);},
    focus() {}
  };
  const target = {children:[], replaceChildren(...nodes) {this.children = nodes;}};
  const document = {createElement(tag) {return {
    tag, textContent:"", children:[], handlers:{},
    setAttribute() {}, append(child) {this.children.push(child);},
    addEventListener(name, fn) {this.handlers[name] = fn;}
  };}};
  const controller = create({source, button:{addEventListener() {}}, target,
    language:()=>"flow", python:async()=>{throw Error("Python must not run");},
    r:async()=>{throw Error("R must not run");}, generation:()=>0,
    isBusy:()=>false, notice:s=>notices.push(s), document});
  assert.equal(await controller.complete(), true);
  assert.deepEqual(target.children[1].children.map(item=>item.textContent), ["x","y"]);
  target.children[1].children[0].handlers.click();
  assert.match(source.value, /p\.x \}/);
  assert.equal(target.children.length, 0);
  assert.match(notices.at(-1), /Inserted x/);
});
