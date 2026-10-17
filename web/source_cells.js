/* Percent-style source cells for Flow, R and Python. No source execution here. */
(function (global) {
"use strict";
const MAX_SOURCE = 2 * 1024 * 1024;
const MARKER = /^[ \t]*#[ \t]*%%(?:([ \t][^\r\n]*))?(?:\r?\n|$)/gm;

function parseCells(source) {
  if (typeof source !== "string" || source.length > MAX_SOURCE)
    throw new Error("Cell navigation supports source buffers up to 2 MiB.");
  const boundaries = [{ start: 0, codeStart: 0, kind: "code" }];
  for (const match of source.matchAll(MARKER)) {
    const label = (match[1] || "").trim().toLowerCase();
    const kind = /^\[(?:markdown|md)\](?:\s|$)/.test(label) ? "markdown" : "code";
    const boundary = { start: match.index, codeStart: match.index + match[0].length, kind };
    if (match.index === 0) boundaries[0] = boundary;
    else boundaries.push(boundary);
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
