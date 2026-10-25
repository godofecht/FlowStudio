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


test("regex search supports captures and named captures with UTF-16 offsets", () => {
  const text = "🙂 α=12 β=34";
  const matches = findMatches(text, "(?<key>\\p{L})=(?<value>\\d+)", {regex:true}).matches;
  assert.deepEqual(matches.map(m => [m.index,m.end,m.groups.key,m.groups.value]),
    [[3,7,"α","12"],[8,12,"β","34"]]);
  assert.equal(replaceAll(text, "(?<key>\\p{L})=(?<value>\\d+)", "$<value>:$<key>", {regex:true}).value,
    "🙂 12:α 34:β");
});
test("regex replacement expands captures, full match, dollar and optional groups", () => {
  assert.equal(replaceAll("a1 b2", "([a-z])(\\d)", "$2-$1", {regex:true}).value, "1-a 2-b");
  assert.equal(replaceSelection("a1 b2", "([a-z])(\\d)", "$2:$1", 3, 5, {regex:true}).value, "a1 2:b");
  assert.equal(replaceAll("a", "(a)(b)?", "[$&][$1][$2][$$]", {regex:true}).value, "[a][a][][$]");
  assert.equal(replaceAll("a1", "([a-z])(\\d)", "$1$2", {regex:false}).count, 0);
  assert.equal(replaceAll("a1", "([a-z])(\\d)", "$1$2", {regex:true}).value, "a1");
});
test("whole-word matches Unicode words but not identifier substrings", () => {
  assert.deepEqual(findMatches("cat cats cat_ cat. scatter", "cat", {wholeWord:true}).matches.map(m => m.index), [0,14]);
  assert.deepEqual(findMatches("α αβ _α α_", "α", {wholeWord:true}).matches.map(m => m.index), [0]);
  assert.equal(replaceAll("x xy x_", "x", "y", {wholeWord:true}).value, "y xy x_");
});
test("regex anchors, zero-width matches and malformed patterns remain bounded", () => {
  assert.equal(replaceAll("a\nb", "^", ">", {regex:true}).value, ">a\nb");
  assert.equal(replaceAll("aa", "(?=a)", "x", {regex:true}).value, "xaxa");
  assert.throws(() => findMatches("x", "(", {regex:true}), /Invalid regular expression/);
  assert.throws(() => findMatches("x".repeat(131073), "x", {regex:true}), /128 KiB/);
  assert.throws(() => replaceAll("x".repeat(10001), "x", "y", {regex:true}), /10,000 matches/);
  assert.throws(() => replaceAll("a".repeat(1000), "a", "x".repeat(10000), {regex:true}), /2 MiB/);
});
test("native HTML embeds the same regex engine and wires both search toggles", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname,"../web/index.html"),"utf8");
  const engine = fs.readFileSync(path.join(__dirname,"../web/editor_find.js"),"utf8");
  assert.ok(html.includes("<script>\n" + engine + "</script>"));
  for (const id of ["editorRegex","editorWholeWord"])
    assert.ok(html.includes('id="' + id + '"'));
  assert.match(html, /regex:el\("editorRegex"\)\.checked/);
  assert.match(html, /wholeWord:el\("editorWholeWord"\)\.checked/);
});
