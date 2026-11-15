/* The line diff and hunk model behind the Assistant's inline edits, and the
 * small parsers that turn a streamed reply into code.
 *
 * Nothing here touches the DOM or Monaco, so tests run it under node.
 *
 * A hunk is { start, removed, added }: the lines removed[] begin at the
 * 1-based line start of the original text and are replaced by added[].
 * A pure insertion has removed = [] and goes before line start (start can
 * be one past the last line).
 */
(function (root) {
"use strict";

const MAX_CELLS = 4000000;

function splitLines(text) { return String(text === undefined || text === null ? "" : text).split("\n"); }

/* Edit script between two line arrays: [{ type: "equal"|"remove"|"add", line }].
 * Common ends are trimmed first; the middle uses an LCS table. A middle too
 * big for the table becomes one replacement. */
function diffLines(before, after) {
  const a = Array.isArray(before) ? before : splitLines(before);
  const b = Array.isArray(after) ? after : splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const ops = [];
  for (let i = 0; i < head; i++) ops.push({ type: "equal", line: a[i] });
  const midA = a.slice(head, a.length - tail), midB = b.slice(head, b.length - tail);
  const n = midA.length, m = midB.length;
  if (n && m && n * m <= MAX_CELLS) {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ type: "equal", line: midA[i] }); i++; j++; }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) ops.push({ type: "remove", line: midA[i++] });
      else ops.push({ type: "add", line: midB[j++] });
    }
    while (i < n) ops.push({ type: "remove", line: midA[i++] });
    while (j < m) ops.push({ type: "add", line: midB[j++] });
  } else {
    for (const line of midA) ops.push({ type: "remove", line });
    for (const line of midB) ops.push({ type: "add", line });
  }
  for (let i = a.length - tail; i < a.length; i++) ops.push({ type: "equal", line: a[i] });
  return ops;
}

/* Groups the edit script into hunks. offset shifts start for a region that
 * begins below line 1. */
function hunksOf(before, after, offset = 0) {
  const hunks = [];
  let line = 1, current = null;
  for (const op of diffLines(before, after)) {
    if (op.type === "equal") { current = null; line++; continue; }
    if (!current) { current = { start: line + offset, removed: [], added: [] }; hunks.push(current); }
    if (op.type === "remove") { current.removed.push(op.line); line++; }
    else current.added.push(op.line);
  }
  return hunks.map((hunk, index) => ({ id: index + 1, ...hunk }));
}

/* Hunks while the reply is still arriving. The new text so far covers only
 * the top of the region. Original lines are shown as removed only once a
 * later line has matched, and lines written after the last match show as
 * new lines there; the rest of the original is not decided yet. The last
 * partial line is held back. */
function streamingHunks(before, partial, offset = 0) {
  const text = String(partial || "");
  const cut = text.lastIndexOf("\n");
  const complete = cut < 0 ? [] : text.slice(0, cut).split("\n");
  if (!complete.length) return [];
  const original = Array.isArray(before) ? before : splitLines(before);
  let a = 0, b = 0, matchedA = 0, matchedB = 0;
  for (const op of diffLines(original, complete)) {
    if (op.type === "equal") { a++; b++; matchedA = a; matchedB = b; }
    else if (op.type === "remove") a++;
    else b++;
  }
  const hunks = hunksOf(original.slice(0, matchedA), complete.slice(0, matchedB), offset)
    .map(({ start, removed, added }) => ({ start, removed, added }));
  if (complete.length > matchedB) hunks.push({ start: matchedA + 1 + offset, removed: [], added: complete.slice(matchedB) });
  return hunks.map((hunk, index) => ({ id: index + 1, ...hunk }));
}

/* The text after taking the hunks that keep() accepts. */
function applyHunks(before, hunks, keep = () => true) {
  const lines = splitLines(before);
  const out = [];
  let next = 1;
  for (const hunk of [...hunks].sort((x, y) => x.start - y.start)) {
    while (next < hunk.start && next <= lines.length) out.push(lines[next++ - 1]);
    if (keep(hunk)) out.push(...hunk.added);
    else out.push(...hunk.removed);
    next += hunk.removed.length;
  }
  while (next <= lines.length) out.push(lines[next++ - 1]);
  return out.join("\n");
}

function countChanges(hunks) {
  let added = 0, removed = 0;
  for (const hunk of hunks) { added += hunk.added.length; removed += hunk.removed.length; }
  return { added, removed };
}

/* ---------- the reply stream ---------- */
/* The code in a reply that may still be arriving: the last fenced block
 * (a model may show a draft, check it and show the fixed one), or the
 * whole reply when the model wrote no fence. */
function extractCode(text, finished = false) {
  const source = String(text || "");
  const openPattern = /(^|\n)[ \t]*(```+|~~~+)([^\n`]*)\n/g;
  let found = null, match;
  while ((match = openPattern.exec(source))) {
    const fence = match[2];
    const info = match[3].trim();
    const bodyStart = match.index + match[0].length;
    const rest = source.slice(bodyStart);
    const close = new RegExp("(^|\\n)[ \\t]*" + fence.replace(/[~`]/g, ch => "\\" + ch) + "[ \\t]*(\\n|$)").exec(rest);
    const language = (info.split(/[\s:]+/)[0] || "").toLowerCase();
    if (!close) { found = { code: rest, language, info, closed: false, fenced: true }; break; }
    found = { code: rest.slice(0, close.index) + (close[1] ? "\n" : ""), language, info, closed: true, fenced: true };
    openPattern.lastIndex = bodyStart + close.index + close[0].length;
  }
  if (found) return found;
  if (!finished) return { code: "", language: "", info: "", closed: false, fenced: false };
  return { code: source.replace(/^\n+/, "").replace(/\s+$/, "") + "\n", language: "", info: "", closed: true, fenced: false };
}

/* A file name given with a fence (```flow app.flow, ```flow:app.flow or
 * ```flow path=app.flow). */
function fenceFile(info) {
  const text = String(info || "").trim();
  const named = /(?:^|\s)(?:path|file)=["']?([^\s"']+)/.exec(text);
  if (named) return named[1];
  const parts = text.split(/[\s:]+/).filter(Boolean);
  return parts.slice(1).find(part => /\.[A-Za-z0-9]+$/.test(part)) || null;
}

/* ---------- where an Apply lands ---------- */
const TOP = /^(?:export\s+)?(?:function|struct|enum|trait|impl|def|class)\s+([A-Za-z_]\w*)/;
const R_TOP = /^([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\b/;

/* Top-level definitions: [{ name, start, end }] with 1-based inclusive
 * lines. Brace languages end at the matching brace; Python ends before the
 * next unindented line. */
function topBlocks(lines, language = "") {
  const blocks = [];
  const python = language === "python" || language === "py";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;
    const match = TOP.exec(line) || R_TOP.exec(line);
    if (!match) continue;
    let end = i;
    if (python) {
      end = i + 1;
      while (end < lines.length && (/^\s/.test(lines[end]) || !lines[end].trim())) end++;
      while (end > i + 1 && !lines[end - 1].trim()) end--;
      end -= 1;
    } else {
      let depth = 0, seen = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j].replace(/"(?:[^"\\]|\\.)*"|#.*$/g, "")) {
          if (ch === "{") { depth++; seen = true; } else if (ch === "}") depth--;
        }
        end = j;
        if (seen && depth <= 0) break;
      }
      if (!seen) end = i;
    }
    blocks.push({ name: match[1], start: i + 1, end: end + 1 });
    i = end;
  }
  return blocks;
}

/* The top-level block holding line, for Fix with Assistant. */
function enclosingBlock(text, line, language = "") {
  const lines = splitLines(text);
  const found = topBlocks(lines, language).find(block => block.start <= line && line <= block.end);
  return found ? { start: found.start, end: found.end } : { start: line, end: line };
}

/* The whole file after applying a code block from the chat.
 *   1. A block that reads as the whole file replaces it.
 *   2. Named definitions replace the ones with the same name; new ones are
 *      added at the end.
 *   3. A fragment replaces the selection it was asked about, or goes in at
 *      the cursor line.
 * Returns { text, how }. */
function planApply(fileText, code, { language = "", selection = null, cursorLine = null } = {}) {
  const file = splitLines(fileText);
  const body = String(code || "").replace(/\n$/, "");
  const lines = body.split("\n");
  const blocks = topBlocks(lines, language);
  const fileBlocks = topBlocks(file, language);
  const firstCode = lines.find(line => line.trim()) || "";
  const firstFile = file.find(line => line.trim()) || "";
  const hasMain = list => list.some(block => block.name === "main");
  const trailing = String(fileText).endsWith("\n") ? "\n" : "";
  if (!String(fileText).trim() || (hasMain(blocks) && hasMain(fileBlocks)) ||
      (firstCode.trim() === firstFile.trim() && lines.length >= file.length * 0.6))
    return { text: body + (trailing || "\n"), how: "file" };
  if (blocks.length) {
    const out = file.slice();
    const tail = [];
    // Replace from the bottom so earlier line numbers stay valid.
    const matches = [];
    for (const block of blocks) {
      const target = fileBlocks.find(item => item.name === block.name);
      const chunk = lines.slice(block.start - 1, block.end);
      if (target) matches.push({ target, chunk }); else tail.push(chunk);
    }
    matches.sort((x, y) => y.target.start - x.target.start);
    for (const { target, chunk } of matches) out.splice(target.start - 1, target.end - target.start + 1, ...chunk);
    if (tail.length) {
      let end = out.length;
      while (end > 0 && !out[end - 1].trim()) end--;
      const added = tail.flatMap(chunk => ["", ...chunk]);
      out.splice(end, 0, ...added);
    }
    return { text: out.join("\n"), how: matches.length ? "definitions" : "append" };
  }
  if (selection && selection.startLine) {
    const start = Math.max(1, selection.startLine), end = Math.max(start, selection.endLine || start);
    const out = file.slice();
    out.splice(start - 1, end - start + 1, ...lines);
    return { text: out.join("\n"), how: "selection" };
  }
  const at = Math.max(1, Math.min(cursorLine || file.length, file.length));
  const out = file.slice();
  if (!out[at - 1].trim()) out.splice(at - 1, 1, ...lines); else out.splice(at, 0, ...lines);
  return { text: out.join("\n"), how: "cursor" };
}

/* ---------- the inline edit prompt ---------- */
function fence(language, text) {
  const body = String(text || "");
  return "```" + (language || "") + "\n" + body + (body.endsWith("\n") || !body ? "" : "\n") + "```";
}

/* region: { startLine, endLine } with endLine = startLine - 1 for an
 * insertion before startLine. */
function buildInlinePrompt({ instruction = "", file = "untitled", language = "", text = "", region, error = null,
  previous = null, tools = true }) {
  const lines = splitLines(text);
  const start = region.startLine, end = region.endLine;
  const parts = ["FlowStudio inline edit.", "File: " + file + " (" + (language || "text") + ")",
    "Instruction: " + String(instruction).trim()];
  if (error) parts.push("Compiler error on line " + error.line + ": " + error.message);
  if (end >= start) {
    parts.push("", "Selected lines " + start + " to " + end + ":");
    parts.push(fence(language, lines.slice(start - 1, end).join("\n")));
  } else {
    parts.push("", "Insert new code before line " + start + ". Nothing is selected.");
  }
  if (previous) {
    parts.push("", "Your previous answer, which the user wants changed:");
    parts.push(fence(language, previous));
  }
  const whole = text.length <= 24000;
  const from = whole ? 1 : Math.max(1, start - 60), to = whole ? lines.length : Math.min(lines.length, Math.max(end, start) + 60);
  parts.push("", (whole ? "The whole file" : "Lines " + from + " to " + to + " of the file") + ", for context:");
  parts.push(fence(language, lines.slice(from - 1, to).join("\n")));
  parts.push("", end >= start
    ? "Reply with only the new text for lines " + start + " to " + end + ", in one fenced ```" + (language || "") + " block. It replaces those lines exactly, so keep their indentation and leave out lines outside them."
    : "Reply with only the lines to insert, in one fenced ```" + (language || "") + " block.");
  parts.push("Do not explain. Do not call flowstudio_propose_edit.");
  if (tools && language === "flow") parts.push("Check the whole program with your edit in place with flowstudio_check_code before you reply.");
  return parts.join("\n");
}

const api = Object.freeze({ splitLines, diffLines, hunksOf, streamingHunks, applyHunks, countChanges,
  extractCode, fenceFile, topBlocks, enclosingBlock, planApply, buildInlinePrompt });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioAssistantDiff = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
