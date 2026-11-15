"use strict";
/* The diff and hunk model behind inline edits, and the reply stream parser
 * (web/ide_assistant_diff.js). */
const test = require("node:test");
const assert = require("node:assert/strict");
const Diff = require("../web/ide_assistant_diff.js");
const assistant = require("../web/ide_assistant.js");

test("a line diff groups changes into hunks with original line numbers", () => {
  const before = "a\nb\nc\nd\ne\n";
  const after = "a\nB\nc\nd\nE\nF\n";
  const hunks = Diff.hunksOf(before, after);
  assert.deepEqual(hunks, [
    { id: 1, start: 2, removed: ["b"], added: ["B"] },
    { id: 2, start: 5, removed: ["e"], added: ["E", "F"] }
  ]);
  assert.deepEqual(Diff.countChanges(hunks), { added: 3, removed: 2 });
  assert.deepEqual(Diff.hunksOf("a\nb\n", "a\nb\n"), [], "no change, no hunks");
  assert.deepEqual(Diff.hunksOf("a\nc\n", "a\nb\nc\n"), [{ id: 1, start: 2, removed: [], added: ["b"] }], "a pure insertion goes before its line");
  assert.deepEqual(Diff.hunksOf("a\nb\nc", "a\nc"), [{ id: 1, start: 2, removed: ["b"], added: [] }], "a pure deletion");
  assert.deepEqual(Diff.hunksOf(["x", "y"], ["x", "z"], 9), [{ id: 1, start: 11, removed: ["y"], added: ["z"] }], "offset places a region in the file");
});

test("accepting some hunks and rejecting others gives exactly the chosen text", () => {
  const before = "one\ntwo\nthree\nfour\nfive\n";
  const after = "one\nTWO\nthree\nfour\nFIVE\nsix\n";
  const hunks = Diff.hunksOf(before, after);
  assert.equal(Diff.applyHunks(before, hunks), after, "all accepted is the new text");
  assert.equal(Diff.applyHunks(before, hunks, () => false), before, "all rejected is the old text");
  assert.equal(Diff.applyHunks(before, hunks, hunk => hunk.id === 2), "one\ntwo\nthree\nfour\nFIVE\nsix\n");
  assert.equal(Diff.applyHunks(before, hunks, hunk => hunk.id === 1), "one\nTWO\nthree\nfour\nfive\n");
});

test("the diff round-trips on random edits", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let round = 0; round < 300; round++) {
    const before = Array.from({ length: Math.floor(random() * 30) }, () => "l" + Math.floor(random() * 8));
    const after = before.filter(() => random() > 0.25).flatMap(line => (random() > 0.8 ? [line, "n" + Math.floor(random() * 5)] : [line]));
    if (random() > 0.5) after.unshift("top");
    const hunks = Diff.hunksOf(before.join("\n"), after.join("\n"));
    assert.equal(Diff.applyHunks(before.join("\n"), hunks), after.join("\n"), "round " + round);
    assert.equal(Diff.applyHunks(before.join("\n"), hunks, () => false), before.join("\n"));
    for (const hunk of hunks) assert.ok(hunk.removed.length || hunk.added.length);
  }
});

test("a huge middle becomes one replacement instead of a giant table", () => {
  const before = Array.from({ length: 2500 }, (_, i) => "a" + i);
  const after = Array.from({ length: 2500 }, (_, i) => "b" + i);
  const hunks = Diff.hunksOf(before, after);
  assert.equal(hunks.length, 1);
  assert.equal(Diff.applyHunks(before.join("\n"), hunks), after.join("\n"));
});

test("while streaming, lines are decided only up to the last match", () => {
  const original = ["    let a = 1", "    print(a)", "    let b = 2"];
  assert.deepEqual(Diff.streamingHunks(original, "    let a", 1), [], "a partial line is held back");
  assert.deepEqual(Diff.streamingHunks(original, "    let a = 2\n", 1),
    [{ id: 1, start: 2, removed: [], added: ["    let a = 2"] }], "a new line before any match is shown, the original waits");
  assert.deepEqual(Diff.streamingHunks(original, "    let a = 2\n    print(a)\n    let", 1),
    [{ id: 1, start: 2, removed: ["    let a = 1"], added: ["    let a = 2"] }], "a later match settles the change above it");
  assert.deepEqual(Diff.streamingHunks(original, "    let a = 1\n    print(a)\n    let b = 3\n", 1),
    [{ id: 1, start: 4, removed: [], added: ["    let b = 3"] }], "unmatched original lines at the end stay undecided");
});

test("the stream parser finds the code in a reply as it arrives", () => {
  assert.deepEqual(Diff.extractCode("Let me check.", false), { code: "", language: "", info: "", closed: false, fenced: false });
  assert.deepEqual(Diff.extractCode("```flow\nlet a = 2\nlet b", false), { code: "let a = 2\nlet b", language: "flow", info: "flow", closed: false, fenced: true });
  assert.deepEqual(Diff.extractCode("```flow\nlet a = 2\n```\n", true), { code: "let a = 2\n", language: "flow", info: "flow", closed: true, fenced: true });
  const two = Diff.extractCode("Draft:\n```flow\nbad\n```\nChecked. Fixed:\n```flow app.flow\ngood\n```", true);
  assert.equal(two.code, "good\n", "the last block wins: the checked one");
  assert.equal(Diff.fenceFile(two.info), "app.flow");
  assert.equal(Diff.fenceFile("python path=src/fit.py"), "src/fit.py");
  assert.equal(Diff.fenceFile("flow:lib/x.flow"), "lib/x.flow");
  assert.equal(Diff.fenceFile("flow"), null);
  assert.equal(Diff.extractCode("let a = 2\n", true).code, "let a = 2\n", "an unfenced final reply is taken whole");
  assert.equal(Diff.extractCode("````md\n```flow\nx\n```\n````", true).code, "```flow\nx\n```\n", "a longer fence holds a shorter one");
});

test("stream-json split anywhere still yields the same code", () => {
  const reply = "```flow\n    let a: i32 = 2\n    let b: i32 = 3\n```\n";
  const stream = [];
  for (let i = 0; i < reply.length; i += 5)
    stream.push(JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: reply.slice(i, i + 5) } } }) + "\n");
  stream.push(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: reply }] } }) + "\n");
  const raw = stream.join("");
  const parser = assistant.createParser("claude");
  let text = "", streamed = "", seen = [];
  for (let i = 0; i < raw.length; i += 37) {
    for (const event of parser.feed(raw.slice(i, i + 37))) {
      if (event.kind !== "text") continue;
      text = event.replace ? text.slice(0, text.length - streamed.length) + event.text : text + event.text;
      streamed = event.replace ? "" : streamed + event.text;
    }
    seen.push(Diff.extractCode(text, false).code);
  }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].startsWith(seen[i - 1]) || seen[i - 1] === "", "code only grows");
  assert.equal(Diff.extractCode(text, true).code, "    let a: i32 = 2\n    let b: i32 = 3\n");
  assert.equal(text, reply, "the full message replaces its deltas without doubling");
});

test("top-level blocks and the block around an error line", () => {
  const flow = "import stdlib\n\nfunction f(x: i32) -> i32 {\n    if x > 0 {\n        return 1\n    }\n    return 0\n}\n\nfunction main() -> i32 {\n    let s: string = \"}\"\n    return f(2)\n}\n";
  assert.deepEqual(Diff.topBlocks(flow.split("\n"), "flow").map(b => [b.name, b.start, b.end]), [["f", 3, 8], ["main", 10, 13]]);
  assert.deepEqual(Diff.enclosingBlock(flow, 5, "flow"), { start: 3, end: 8 });
  assert.deepEqual(Diff.enclosingBlock(flow, 1, "flow"), { start: 1, end: 1 }, "outside a block the line itself");
  const py = "import math\n\ndef f(x):\n    y = x\n\n    return y\n\nprint(f(2))\n";
  assert.deepEqual(Diff.topBlocks(py.split("\n"), "python").map(b => [b.name, b.start, b.end]), [["f", 3, 6]]);
  const r = "fit <- function(x) {\n  mean(x)\n}\n";
  assert.deepEqual(Diff.topBlocks(r.split("\n"), "r").map(b => [b.name, b.start, b.end]), [["fit", 1, 3]]);
});

test("Apply puts a code block where it belongs", () => {
  const file = "function f() -> i32 {\n    return 1\n}\n\nfunction main() -> i32 {\n    return f()\n}\n";
  const whole = Diff.planApply(file, "function main() -> i32 {\n    return 2\n}\n", { language: "flow" });
  assert.equal(whole.how, "file", "a block with main replaces a file with main");
  assert.equal(whole.text, "function main() -> i32 {\n    return 2\n}\n");
  const one = Diff.planApply(file, "function f() -> i32 {\n    return 5\n}\n", { language: "flow" });
  assert.equal(one.how, "definitions");
  assert.equal(one.text, file.replace("return 1", "return 5"), "only the matching definition changes");
  const added = Diff.planApply(file, "function g() -> i32 {\n    return 3\n}\n", { language: "flow" });
  assert.equal(added.how, "append");
  assert.ok(added.text.startsWith(file.trimEnd() + "\n\nfunction g()"), "a new definition goes at the end");
  const fragment = Diff.planApply(file, "    return 9", { language: "flow", selection: { startLine: 2, endLine: 2 } });
  assert.equal(fragment.how, "selection");
  assert.equal(fragment.text, file.replace("    return 1", "    return 9"));
  const cursor = Diff.planApply("a\n\nb\n", "x\ny", { cursorLine: 2 });
  assert.deepEqual(cursor, { text: "a\nx\ny\nb\n", how: "cursor" }, "a blank cursor line is replaced");
  assert.equal(Diff.planApply("", "x = 1\n").how, "file", "an empty file takes the block");
});

test("the inline prompt names the region, the error and the reply format", () => {
  const text = "function main() -> i32 {\n    let a: i32 = 1\n    return b\n}\n";
  const prompt = Diff.buildInlinePrompt({ instruction: "Fix it", file: "app.flow", language: "flow", text,
    region: { startLine: 2, endLine: 3 }, error: { line: 3, message: "Undefined variable 'b'" } });
  assert.match(prompt, /^FlowStudio inline edit\./);
  assert.match(prompt, /Instruction: Fix it/);
  assert.match(prompt, /Compiler error on line 3: Undefined variable 'b'/);
  assert.match(prompt, /Selected lines 2 to 3:\n```flow\n    let a: i32 = 1\n    return b\n```/);
  assert.match(prompt, /Reply with only the new text for lines 2 to 3/);
  assert.match(prompt, /flowstudio_check_code/);
  assert.match(prompt, /Do not call flowstudio_propose_edit/);
  const insert = Diff.buildInlinePrompt({ instruction: "add a loop", file: "x.py", language: "python", text: "a = 1\n",
    region: { startLine: 2, endLine: 1 }, tools: false, previous: "for i in range(3): pass" });
  assert.match(insert, /Insert new code before line 2/);
  assert.match(insert, /Your previous answer/);
  assert.doesNotMatch(insert, /flowstudio_check_code/);
});
