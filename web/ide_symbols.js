/* FlowStudio document outline: bounded, best-effort symbol extraction.
 * Pure and synchronous so the same rules run in tests and in the browser.
 * Matching is line based and intentionally conservative: when a line is
 * ambiguous the parser ignores it instead of guessing. */
(function (root) {
"use strict";

const MAX_SOURCE = 2 * 1024 * 1024;
const MAX_SYMBOLS = 400;
const MAX_LINE = 400;
const MAX_DETAIL = 72;
const LANGUAGES = Object.freeze(["flow", "r", "python"]);

/* Short, single-glyph kind markers for the outline panel. */
const GLYPHS = Object.freeze({
  function: "\u0192",
  class: "C",
  struct: "S",
  enum: "E",
  value: "\u2022",
  import: "\u21e3"
});

function glyph(kind) {
  return GLYPHS[kind] || "\u2022";
}

function clip(text, limit = MAX_DETAIL) {
  const trimmed = String(text).replace(/\s+$/, "");
  return trimmed.length > limit ? trimmed.slice(0, limit - 1) + "\u2026" : trimmed;
}

/* Column of the first match of `name` in `line`, 1-based. */
function columnOf(line, name, fallback) {
  const index = line.indexOf(name);
  return index < 0 ? fallback : index + 1;
}

function indentationDepth(line) {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4;
    else break;
  }
  return Math.min(6, Math.floor(width / 4));
}

function flowSymbol(line, number) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  /* Flow module scope starts at column 0; indented `let` lines are locals. */
  const moduleScope = line === trimmed;
  let match = /^(?:export\s+)?function\s+([A-Za-z_]\w*)\s*(.*)$/.exec(trimmed);
  if (match) {
    return { name: match[1], kind: "function", line: number,
      column: columnOf(line, match[1], 1), depth: 0, detail: clip(match[2]) };
  }
  match = /^(?:export\s+)?(struct|enum)\s+([A-Za-z_]\w*)\s*(.*)$/.exec(trimmed);
  if (match) {
    return { name: match[2], kind: match[1], line: number,
      column: columnOf(line, match[2], 1), depth: 0, detail: clip(match[3]) };
  }
  match = moduleScope ? /^(?:export\s+)?(?:let|const)\s+([A-Za-z_]\w*)\s*(.*)$/.exec(trimmed) : null;
  if (match) {
    return { name: match[1], kind: "value", line: number,
      column: columnOf(line, match[1], 1), depth: 0, detail: clip(match[2]) };
  }
  match = /^import\s+(.+)$/.exec(trimmed);
  if (match) {
    return { name: clip(match[1], 48), kind: "import", line: number,
      column: 1, depth: 0, detail: "" };
  }
  return null;
}

function pythonSymbol(line, number) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const depth = indentationDepth(line);
  let match = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*(.*)$/.exec(trimmed);
  if (match) {
    return { name: match[1], kind: "function", line: number,
      column: columnOf(line, match[1], depth * 4 + 1), depth, detail: clip(match[2]) };
  }
  match = /^class\s+([A-Za-z_]\w*)\s*(.*)$/.exec(trimmed);
  if (match) {
    return { name: match[1], kind: "class", line: number,
      column: columnOf(line, match[1], depth * 4 + 1), depth, detail: clip(match[2]) };
  }
  /* Module-level UPPER_CASE assignments read as constants in RStudio/PyCharm. */
  if (depth === 0) {
    match = /^([A-Z][A-Z0-9_]{1,})\s*=\s*(.*)$/.exec(trimmed);
    if (match) {
      return { name: match[1], kind: "value", line: number,
        column: columnOf(line, match[1], 1), depth: 0, detail: clip(match[2]) };
    }
  }
  return null;
}

const R_NAME = "([A-Za-z._][A-Za-z0-9._]*)";

function rSymbol(line, number) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  /* R has no reliable nesting rules, so only column-0 bindings are listed. */
  if (line !== trimmed) return null;
  let match = new RegExp("^" + R_NAME + "\\s*(?:<-|=)\\s*function\\s*(.*)$").exec(trimmed);
  if (match) {
    return { name: match[1], kind: "function", line: number,
      column: columnOf(line, match[1], 1), depth: 0, detail: clip(match[2]) };
  }
  match = new RegExp("^" + R_NAME + "\\s*(?:<-|=)\\s*R6Class\\s*\\((.*)$").exec(trimmed);
  if (match) {
    return { name: match[1], kind: "class", line: number,
      column: columnOf(line, match[1], 1), depth: 0, detail: clip(match[2]) };
  }
  match = /^(?:setClass|setRefClass|setGeneric)\(\s*["']([^"']{1,120})["']/.exec(trimmed);
  if (match) {
    return { name: match[1], kind: "class", line: number,
      column: columnOf(line, match[1], 1), depth: 0, detail: "" };
  }
  match = new RegExp("^" + R_NAME + "\\s*<-\\s*(.+)$").exec(trimmed);
  if (match) {
    return { name: match[1], kind: "value", line: number,
      column: columnOf(line, match[1], 1), depth: 0, detail: clip(match[2]) };
  }
  return null;
}

const SCANNERS = Object.freeze({ flow: flowSymbol, r: rSymbol, python: pythonSymbol });

/* Symbols sorted by line. Oversized buffers and long lines are skipped so a
 * generated or minified file can never stall the editor. */
function parse(language, text) {
  if (typeof text !== "string") throw new TypeError("Outline input must be a string.");
  if (text.length > MAX_SOURCE) throw new RangeError("Source exceeds the 2 MiB outline limit.");
  const scanner = SCANNERS[LANGUAGES.includes(language) ? language : "flow"];
  const symbols = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length && symbols.length < MAX_SYMBOLS; index++) {
    const line = lines[index];
    if (line.length > MAX_LINE) continue;
    const symbol = scanner(line, index + 1);
    if (symbol && symbol.name) symbols.push(symbol);
  }
  return symbols;
}

const api = Object.freeze({ parse, glyph, clip, MAX_SOURCE, MAX_SYMBOLS, MAX_LINE, LANGUAGES, GLYPHS });
root.FlowStudioSymbols = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
