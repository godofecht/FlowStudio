/* Percent-style source cells for Flow, R and Python. No source execution here. */
(function (global) {
"use strict";
const MAX_SOURCE = 2 * 1024 * 1024;
const MAX_CELLS = 10000;
const MARKER = /^[ \t]*#[ \t]*%%(?:([ \t][^\r\n]*))?(?:\r\n|\n|\r|$)/;

// Track multiline lexical regions so an apparent marker inside a Python
// docstring, R string, or block-comment-like region cannot split a cell.
// Conservative scanner, not a grammar: Flow 2.0 supports hash comments only.
function scanLine(line, state) {
  for (let i = 0; i < line.length;) {
    if (state.mode === "block") {
      if (line.startsWith("*/", i)) { state.mode = "normal"; i += 2; }
      else i++;
      continue;
    }
    if (state.mode === "quote") {
      if (line[i] === "\\") { i += 2; continue; }
      const delimiter = state.quote.repeat(state.triple ? 3 : 1);
      if (line.startsWith(delimiter, i)) {
        state.mode = "normal";
        i += delimiter.length;
      } else i++;
      continue;
    }
    if (line[i] === "#") break; // R/Python/Flow line comment.
    if (line.startsWith("/*", i)) { state.mode = "block"; i += 2; continue; }
    const quote = line[i];
    if (quote === "'" || quote === '"' || quote === "`") {
      const triple = quote !== "`" && line.startsWith(quote.repeat(3), i);
      state.mode = "quote";
      state.quote = quote;
      state.triple = triple;
      i += triple ? 3 : 1;
      continue;
    }
    i++;
  }
}

function parseCells(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE)
    throw new Error("Cell navigation supports source buffers up to 2 MiB.");
  const boundaries = [{ start: 0, codeStart: 0, kind: "code" }];
  const state = { mode: "normal", quote: "", triple: false };
  let currentKind = "code";
  let offset = 0;
  while (offset < source.length) {
    // Preserve CR-only, LF-only and CRLF line endings and source offsets.
    const cr = source.indexOf("\r", offset);
    const lf = source.indexOf("\n", offset);
    const newline = cr < 0 ? lf : lf < 0 ? cr : Math.min(cr, lf);
    const end = newline < 0 ? source.length :
      newline + (source[newline] === "\r" && source[newline + 1] === "\n" ? 2 : 1);
    const line = source.slice(offset, end);
    const match = state.mode === "normal" || currentKind === "markdown"
      ? MARKER.exec(line) : null;
    if (match) {
      const label = (match[1] || "").trim().toLowerCase();
      currentKind = /^\[(?:markdown|md)\](?:\s|$)/.test(label) ? "markdown" : "code";
      const boundary = { start: offset, codeStart: offset + match[0].length, kind: currentKind };
      if (offset === 0) boundaries[0] = boundary;
      else boundaries.push(boundary);
      if (boundaries.length > MAX_CELLS) throw new Error("Source exceeds the 10,000-cell limit.");
      state.mode = "normal";
    } else if (currentKind === "code") {
      scanLine(line, state);
    }
    offset = end;
  }
  return boundaries.map((boundary, index) => {
    const end = index + 1 < boundaries.length ? boundaries[index + 1].start : source.length;
    return { index, count: boundaries.length, start: boundary.start, end,
      kind: boundary.kind, code: source.slice(boundary.codeStart, end) };
  });
}

function cellAt(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length)
    throw new RangeError("Cursor is outside the source buffer.");
  const cells = parseCells(source);
  for (let index = cells.length - 1; index >= 0; index--)
    if (offset >= cells[index].start) return cells[index];
  return cells[0];
}
const api = { parseCells, cellAt };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioSourceCells = api;
})(globalThis);
