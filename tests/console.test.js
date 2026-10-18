"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { create, MAX_BYTES, MAX_HISTORY } = require("../web/console.js");

function input(value = "") {
  return { value, selectionStart: 0, selectionEnd: 0,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
}
test("console submits exact code and selected runtime", async () => {
  const calls = [];
  const repl = create(async (language, code) => { calls.push([language, code]); return true; },
    () => "python");
  const field = input("print('π')\n");
  assert.equal(await repl.run(field), true);
  assert.deepEqual(calls, [["python", "print('π')\n"]]);
  assert.equal(field.value, "");
  assert.deepEqual(repl.history("python"), ["print('π')\n"]);
});
test("history preserves draft and separates languages", async () => {
  let lang = "flow";
  const repl = create(async () => true, () => lang);
  const field = input("first");
  await repl.run(field);
  field.value = "draft";
  assert.equal(repl.navigate(field, -1), true);
  assert.equal(field.value, "first");
  assert.equal(repl.navigate(field, 1), true);
  assert.equal(field.value, "draft");
  lang = "r";
  field.value = "x <- 1";
  await repl.run(field);
  assert.deepEqual(repl.history("r"), ["x <- 1"]);
  assert.deepEqual(repl.history("flow"), ["first"]);
});
test("busy submissions do not overlap or consume pending input", async () => {
  let resolve;
  const repl = create(() => new Promise(r => { resolve = r; }), () => "python");
  const field = input("first");
  const pending = repl.run(field);
  assert.equal(repl.isBusy(), true);
  field.value = "second";
  assert.equal(await repl.run(field), false);
  resolve(true);
  assert.equal(await pending, true);
  assert.equal(field.value, "second");
});
test("limits reject oversized UTF-8 and bound history", async () => {
  const errors = [], repl = create(async () => true, () => "r", e => errors.push(e));
  const field = input("λ".repeat(MAX_BYTES));
  assert.equal(await repl.run(field), false);
  assert.equal(field.value.length, MAX_BYTES);
  assert.match(errors[0], /64 KiB/);
  for (let i = 0; i < MAX_HISTORY + 5; i++) {
    field.value = "x" + i;
    assert.equal(await repl.run(field), true);
  }
  assert.equal(repl.history("r").length, MAX_HISTORY);
  assert.equal(repl.history("r")[0], "x5");
});
test("keyboard handling respects Shift+Enter and composition", async () => {
  const calls = [], repl = create(async (lang, code) => { calls.push(code); return true; }, () => "flow");
  const field = input("hello");
  let prevented = false;
  assert.equal(repl.keydown({key:"Enter",shiftKey:true,preventDefault(){prevented=true;}},field), false);
  assert.equal(prevented, false);
  assert.equal(repl.keydown({key:"Enter",isComposing:true,preventDefault(){prevented=true;}},field), false);
  assert.equal(repl.keydown({key:"Enter",preventDefault(){prevented=true;}},field), true);
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.deepEqual(calls, ["hello"]);
});
