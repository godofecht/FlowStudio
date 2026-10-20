"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { findMatches, nextMatch, replaceSelection, replaceAll } = require("../web/editor_find.js");

test("finds literal regex punctuation, not patterns", () => {
  assert.deepEqual(findMatches("a.* ab a.*", ".*"), {
    matches: [{ index: 1, end: 3 }, { index: 8, end: 10 }], truncated: false
  });
});
test("case sensitivity and non-overlapping matches", () => {
  assert.equal(findMatches("Foo foo FOO", "foo").matches.length, 3);
  assert.equal(findMatches("Foo foo FOO", "foo", { caseSensitive: true }).matches.length, 1);
  assert.deepEqual(findMatches("aaaa", "aa").matches.map(m => m.index), [0, 2]);
});
test("Unicode offsets follow textarea UTF-16 selections", () => {
  assert.deepEqual(findMatches("🙂 alpha 🙂", "alpha").matches, [{ index: 3, end: 8 }]);
});
test("forward and backward navigation wrap around", () => {
  const m = findMatches("cat cat cat", "cat").matches;
  assert.deepEqual(nextMatch(m, 0, 0), m[0]);
  assert.deepEqual(nextMatch(m, 0, 3), m[1]);
  assert.deepEqual(nextMatch(m, 8, 11), m[0]);
  assert.deepEqual(nextMatch(m, 8, 11, true), m[1]);
  assert.deepEqual(nextMatch(m, 0, 3, true), m[2]);
});
test("replace only exact current selection", () => {
  assert.equal(replaceSelection("cat dog", "cat", "owl", 0, 3).value, "owl dog");
  assert.equal(replaceSelection("cat dog", "cat", "owl", 1, 3).replaced, false);
  assert.equal(replaceSelection("Cat", "cat", "$&", 0, 3).value, "$&");
  assert.equal(replaceSelection("Cat", "cat", "owl", 0, 3, { caseSensitive: true }).replaced, false);
});
test("replace all uses literal replacement and handles empty replacement", () => {
  assert.deepEqual(replaceAll("a$a a$a", "a$a", "$&"), { value: "$& $&", count: 2, firstIndex: 0 });
  assert.equal(replaceAll("aaa", "a", "").value, "");
  assert.equal(replaceAll("one", "absent", "x").count, 0);
});
test("case-insensitive replace all preserves unrelated text", () => {
  assert.equal(replaceAll("Hi HI hi!", "hi", "bye").value, "bye bye bye!");
  assert.equal(replaceAll("Hi HI hi!", "hi", "bye", { caseSensitive: true }).value, "Hi HI bye!");
});
test("empty query returns no matches without modifying source", () => {
  assert.deepEqual(findMatches("text", ""), { matches: [], truncated: false });
  assert.equal(replaceAll("text", "", "x").value, "text");
});
test("rejects oversized query, replacement and buffer", () => {
  assert.throws(() => findMatches("abc", "x".repeat(257)), /1–256/);
  assert.throws(() => findMatches("x".repeat(2 * 1024 * 1024 + 1), "x"), /2 MiB/);
  assert.throws(() => replaceAll("abc", "a", "x".repeat(10001)), /10,000/);
});
test("refuses truncated replace-all atomically", () => {
  const source = "x".repeat(10002);
  assert.equal(findMatches(source, "x").truncated, true);
  assert.throws(() => replaceAll(source, "x", "y"), /10,000 matches/);
});

test("whole-word matching skips identifier substrings and partial words", () => {
  assert.deepEqual(findMatches("cat catalog _cat cat_ scat cat", "cat", {wholeWord:true}).matches.map(m => m.index), [0,27]);
  assert.equal(findMatches("cat catalog _cat cat_ scat cat", "cat").matches.length, 6);
});
test("whole-word boundaries are Unicode-aware including astral letters and marks", () => {
  assert.deepEqual(findMatches("éfoo foo🙂 foo𝒜 foo_ foo", "foo", {wholeWord:true}).matches.map(m => m.index), [5,22]);
  assert.deepEqual(findMatches("foo\u0301 foo", "foo", {wholeWord:true}).matches.map(m => m.index), [5]);
});
test("whole-word replacement only changes complete tokens", () => {
  assert.equal(replaceAll("cat scatter cat_ CAT", "cat", "dog", {wholeWord:true}).value, "dog scatter cat_ dog");
  assert.equal(replaceSelection("cat_", "cat", "dog", 0, 3, {wholeWord:true}).replaced, false);
});
test("whole-word mode retains literal punctuation", () => {
  assert.deepEqual(findMatches("x a.b a.b2", "a.b", {wholeWord:true}).matches.map(m => m.index), [2]);
});
