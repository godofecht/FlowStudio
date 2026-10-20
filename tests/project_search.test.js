"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { searchProject, createProjectExplorer } = require("../web/project.js");

function file(name, contents, reportedSize = contents.length) {
  return {
    kind: "file", name,
    async getFile() {
      return { size: reportedSize, text: async () => contents };
    }
  };
}
function directory(name, children = []) {
  return {
    kind: "directory", name,
    async *entries() { yield* children; }
  };
}
const corpus = () => directory("research", [
  ["src", directory("src", [
    ["analysis.R", file("analysis.R", "x <- 1\nx <- 2\nX <- 3\n")],
    ["large.py", file("large.py", "a", 1048577)]
  ])],
  ["main.flow", file("main.flow", 'println("x <- 1")\n')],
  ["image.png", file("image.png", "x <- 1")]
]);

test("searches nested files and reports accurate line, column and handle", async () => {
  const result = await searchProject(corpus(), "x <-");
  assert.equal(result.matches.length, 4);
  assert.equal(result.scannedFiles, 2);
  assert.equal(result.skippedLarge, 1);
  assert.equal(result.truncated, false);
  const analysis = result.matches.filter(hit => hit.path === "research/src/analysis.R");
  assert.equal(analysis.length, 3);
  assert.deepEqual(analysis.map(hit => [hit.line, hit.column]), [[1, 1], [2, 1], [3, 1]]);
  assert.equal(analysis[1].index, 7);
  assert.equal(analysis[1].length, 4);
  assert.equal(analysis[1].handle.name, "analysis.R");
  assert.equal(analysis[1].preview, "x <- 2");
});

test("case-sensitive search does not match uppercase variants", async () => {
  const result = await searchProject(corpus(), "X <-", { caseSensitive: true });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].line, 3);
});

test("treats regex metacharacters as literal text", async () => {
  const result = await searchProject(directory("p", [
    ["a.flow", file("a.flow", "x.* xab x.* [a] [a]")]
  ]), "x.*");
  assert.equal(result.matches.length, 2);
  const bracket = await searchProject(directory("p", [
    ["a.flow", file("a.flow", "[a] a")]
  ]), "[a]");
  assert.equal(bracket.matches.length, 1);
});

test("rejects invalid queries and requires project directory", async () => {
  await assert.rejects(searchProject(null, "abc"), /Open a project/);
  await assert.rejects(searchProject(corpus(), ""), /1–256/);
  await assert.rejects(searchProject(corpus(), "a".repeat(257)), /1–256/);
});

test("honours AbortSignal without exposing partial results", async () => {
  await assert.rejects(searchProject(corpus(), "x", {
    signal: { aborted: true }
  }), error => error.name === "AbortError");
});

test("caps search results at 200 matches", async () => {
  const result = await searchProject(directory("p", [
    ["many.flow", file("many.flow", "a ".repeat(300))]
  ]), "a");
  assert.equal(result.matches.length, 200);
  assert.equal(result.truncated, true);
});

test("caps files at 1000 and ignores non-source files", async () => {
  const children = [];
  for (let i = 0; i < 1005; i++) {
    children.push([String(i).padStart(4, "0") + ".flow",
      file(String(i).padStart(4, "0") + ".flow", "nothing")]);
  }
  const result = await searchProject(directory("p", children), "not present");
  assert.equal(result.scannedFiles, 500);
  assert.equal(result.truncated, true);
});

test("explorer exposes search only after folder selection", async () => {
  const root = corpus();
  global.document = { createElement: tag => ({
    tag, children: [], append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener() {}, textContent: ""
  }) };
  const tree = global.document.createElement("div");
  const explorer = createProjectExplorer({
    tree, status: () => {}, openHandle: async () => {},
    picker: async () => root
  });
  await assert.rejects(explorer.search("x"), /Open a project/);
  assert.equal(await explorer.choose(), true);
  const result = await explorer.search("x <-");
  assert.equal(result.matches.length, 4);
});


test("whole-word project search ignores identifiers, respects Unicode boundaries", async () => {
  const source = "cat catalog _cat cat_ scat cat\nfoo𝒜 foó foo";
  const root = directory("p", [["words.py", file("words.py", source)]]);
  const result = await searchProject(root, "cat", { wholeWord: true });
  assert.deepEqual(result.matches.map(hit => hit.index), [0, 27]);
  const unicode = await searchProject(root, "foo", { wholeWord: true });
  assert.equal(unicode.matches.length, 1);
  assert.equal(source.slice(unicode.matches[0].index, unicode.matches[0].index + 3), "foo");
  assert.equal(unicode.matches[0].index, source.lastIndexOf("foo"));
});

test("whole-word project search handles punctuation literally and case sensitivity", async () => {
  const root = directory("p", [["test.flow", file("test.flow", "a.b a.b2 A.B")]]); 
  assert.equal((await searchProject(root, "a.b", {wholeWord:true})).matches.length, 2);
  assert.equal((await searchProject(root, "a.b", {wholeWord:true,caseSensitive:true})).matches.length, 1);
});
