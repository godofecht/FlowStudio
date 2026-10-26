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


/* F12 navigation is deliberately lexical and limited to open source buffers.
 * It does not pretend to resolve imports, dynamic R bindings or Python members.
 * Reject comments/strings and ambiguous cross-document definitions rather
 * than navigating to an arbitrary symbol with a matching spelling. */
function isCodeAt(language, text, offset) {
  let quote = "";
  let comment = false;
  let escaped = false;
  for (let index = 0; index < offset; index++) {
    const char = text[index];
    if (comment) {
      if (char === "\n") comment = false;
      continue;
    }
    if (quote) {
      if (quote.length === 3) {
        if (text.slice(index, index + 3) === quote) {
          index += 2;
          quote = "";
        }
      } else if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "#") {
      comment = true;
    } else if (char === "'" || char === '"' || (language === "r" && char === "\`")) {
      if (language === "python" && text.slice(index, index + 3) === char.repeat(3)) {
        quote = char.repeat(3);
        index += 2;
      } else {
        quote = char;
      }
    }
  }
  return !comment && !quote;
}

function identifierAt(language, text, offset) {
  if (!LANGUAGES.includes(language) || typeof text !== "string" ||
      text.length > MAX_SOURCE || !Number.isInteger(offset) ||
      offset < 0 || offset > text.length) return null;
  const part = language === "r" ? /[A-Za-z0-9._]/ : /[A-Za-z0-9_]/;
  let start = offset;
  if (start >= text.length || !part.test(text[start])) start--;
  if (start < 0 || !part.test(text[start])) return null;
  let end = start + 1;
  while (start > 0 && part.test(text[start - 1])) start--;
  while (end < text.length && part.test(text[end])) end++;
  const name = text.slice(start, end);
  const valid = language === "r"
    ? /^[A-Za-z._][A-Za-z0-9._]*$/
    : /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!valid.test(name) || !isCodeAt(language, text, start)) return null;
  // Do not treat spaced member access as a free identifier.
  let previous = start - 1;
  while (previous >= 0 && (text[previous] === " " || text[previous] === "\t")) previous--;
  const prefix = previous >= 0 ? text[previous] : "";
  if (language === "r" && (prefix === "$" || prefix === "@" || prefix === ":")) return null;
  if (language !== "r" && (prefix === "." || text[end] === ".")) return null;
  return name;
}

function findDefinitions(language, text, name) {
  if (!LANGUAGES.includes(language) || typeof name !== "string" ||
      !/^[A-Za-z._][A-Za-z0-9._]*$/.test(name)) return [];
  const matches = parse(language, text).filter(symbol =>
    symbol.kind !== "import" && symbol.name === name);
  if (!matches.length) return [];
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === "\n") starts.push(index + 1);
  return matches.filter(symbol =>
    isCodeAt(language, text, starts[symbol.line - 1] + symbol.column - 1));
}

function findDefinition(language, text, name, offset) {
  const matches = findDefinitions(language, text, name);
  if (!matches.length) return null;
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    return matches[0];
  const line = text.slice(0, offset).split("\n").length;
  const earlier = matches.filter(symbol => symbol.line <= line);
  return earlier.length ? earlier[earlier.length - 1] : matches[0];
}

function definitionAt(language, text, offset) {
  const name = identifierAt(language, text, offset);
  return name ? findDefinition(language, text, name, offset) : null;
}

/* Search only buffers already opened by the user. A single unambiguous
 * definition is required before switching tabs; never read other disk files. */
function uniqueOpenDefinition(language, documents, name, currentId) {
  if (!Array.isArray(documents) || documents.length > 24)
    throw new RangeError("Definition navigation supports up to 24 open documents.");
  let found = null;
  for (const doc of documents) {
    if (!doc || doc.id === currentId || doc.language !== language) continue;
    const matches = findDefinitions(language, doc.text, name);
    for (const symbol of matches) {
      if (found) return { state: "ambiguous" };
      found = { state: "unique", documentId: doc.id, symbol };
    }
  }
  return found || { state: "missing" };
}


const MAX_REFERENCES = 200;

/* Lexical references in user-opened buffers only. This is not language-server
 * binding resolution: imports, shadowing, dynamic R evaluation and Python
 * f-string expressions are not semantically analyzed. No code is executed. */
function findReferences(language, text, name, limit = MAX_REFERENCES) {
  if (!LANGUAGES.includes(language)) throw new TypeError("Unsupported reference language.");
  if (typeof text !== "string" || text.length > MAX_SOURCE)
    throw new RangeError("Reference source exceeds the 2 MiB limit.");
  const valid = language === "r"
    ? /^[A-Za-z._][A-Za-z0-9._]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (typeof name !== "string" || !valid.test(name))
    throw new TypeError("Expected a valid source identifier.");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REFERENCES)
    throw new RangeError("Reference limit must be 1–200.");
  const part = language === "r" ? /[A-Za-z0-9._]/ : /[A-Za-z0-9_]/;
  const start = language === "r" ? /[A-Za-z._]/ : /[A-Za-z_]/;
  const matches = [];
  let truncated = false;
  let quote = "";
  let comment = false;
  let escaped = false;
  let line = 1;
  let column = 1;
  let i = 0;
  function advance(count = 1) {
    for (let n = 0; n < count; n++) {
      if (text[i] === "\n") { line++; column = 1; comment = false; }
      else column++;
      i++;
    }
  }
  while (i < text.length) {
    const char = text[i];
    if (comment) { advance(); continue; }
    if (quote) {
      if (quote.length === 3 && text.slice(i, i + 3) === quote) {
        advance(3); quote = ""; continue;
      }
      if (quote.length === 1 && !escaped && char === quote) {
        advance(); quote = ""; continue;
      }
      if (quote.length === 1 && !escaped && char === "\\") {
        escaped = true; advance(); continue;
      }
      escaped = false;
      advance();
      continue;
    }
    if (char === "#") { comment = true; advance(); continue; }
    if (char === "'" || char === '"' || (language === "r" && char === "\`")) {
      if (language === "python" && text.slice(i, i + 3) === char.repeat(3)) {
        quote = char.repeat(3); advance(3);
      } else { quote = char; advance(); }
      escaped = false;
      continue;
    }
    if (start.test(char) && (i === 0 || !part.test(text[i - 1]))) {
      const begin = i, tokenLine = line, tokenColumn = column;
      while (i < text.length && part.test(text[i])) advance();
      const token = text.slice(begin, i);
      let previous = begin - 1;
      while (previous >= 0 && (text[previous] === " " || text[previous] === "\t")) previous--;
      const prefix = previous >= 0 ? text[previous] : "";
      const member = language === "r"
        ? prefix === "$" || prefix === "@" || prefix === ":"
        : prefix === ".";
      if (token === name && !member) {
        if (matches.length === limit) { truncated = true; break; }
        const lineStart = text.lastIndexOf("\n", begin - 1) + 1;
        let lineEnd = text.indexOf("\n", begin);
        if (lineEnd < 0) lineEnd = text.length;
        matches.push({ index: begin, line: tokenLine, column: tokenColumn,
          preview: text.slice(lineStart, Math.min(lineEnd, lineStart + 160)).trim() });
      }
      continue;
    }
    advance();
  }
  return { matches, truncated };
}

function findOpenReferences(language, documents, name, currentId) {
  if (!Array.isArray(documents) || documents.length > 24)
    throw new RangeError("Reference search supports up to 24 open documents.");
  const ordered = documents.slice().sort((a, b) =>
    Number(b && b.id === currentId) - Number(a && a.id === currentId));
  const matches = [];
  let truncated = false;
  for (const doc of ordered) {
    if (!doc || doc.language !== language) continue;
    const result = findReferences(language, doc.text, name);
    for (const hit of result.matches) {
      if (matches.length >= MAX_REFERENCES) { truncated = true; break; }
      matches.push({ ...hit, documentId: doc.id,
        documentLabel: doc.path || doc.name || "Untitled" });
    }
    if (result.truncated) truncated = true;
    if (truncated) break;
  }
  return { matches, truncated };
}


/* Previewed lexical rename only; not semantic refactoring. Source snapshots
 * make application fail closed if an open buffer changes after preview. */
const RENAME_RESERVED = Object.freeze({
  flow: new Set("let mut const function return struct enum import export if elif else while for in to true false and or not".split(" ")),
  r: new Set("if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_complex_ NA_character_".split(" ")),
  python: new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "))
});

function planOpenRename(language, documents, oldName, newName, currentId, allOpen = false) {
  if (!LANGUAGES.includes(language)) throw new TypeError("Unsupported rename language.");
  if (!Array.isArray(documents) || documents.length > 24)
    throw new RangeError("Rename supports up to 24 open documents.");
  const valid = language === "r"
    ? /^[A-Za-z._][A-Za-z0-9._]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (typeof oldName !== "string" || !valid.test(oldName) || RENAME_RESERVED[language].has(oldName))
    throw new TypeError("Place the caret on a valid non-keyword identifier.");
  if (typeof newName !== "string" || !valid.test(newName) || RENAME_RESERVED[language].has(newName))
    throw new TypeError("Replacement must be a valid non-keyword identifier.");
  if (oldName === newName) throw new Error("Replacement must differ from the original name.");
  const active = documents.find(doc => doc && doc.id === currentId);
  if (!active || active.language !== language)
    throw new Error("The active source document is unavailable.");
  const selected = allOpen ? documents.filter(doc => doc && doc.language === language) : [active];
  const entries = [];
  let total = 0;
  for (const doc of selected) {
    const found = findReferences(language, doc.text, oldName);
    if (found.truncated || total + found.matches.length > MAX_REFERENCES)
      throw new RangeError("Rename exceeds 200 lexical references; no changes made.");
    if (!found.matches.length) continue;
    if (findReferences(language, doc.text, newName).matches.length)
      throw new Error("Replacement name already occurs in " + (doc.path || doc.name) + "; no changes made.");
    let updated = doc.text;
    for (let index = found.matches.length - 1; index >= 0; index--) {
      const start = found.matches[index].index;
      updated = updated.slice(0, start) + newName + updated.slice(start + oldName.length);
    }
    if (updated.length > MAX_SOURCE)
      throw new RangeError("Renamed source exceeds the 2 MiB editor limit.");
    entries.push({ id: doc.id, label: doc.path || doc.name, before: doc.text,
      after: updated, count: found.matches.length });
    total += found.matches.length;
  }
  if (!total) throw new Error("No lexical references found in selected open buffers.");
  return { language, oldName, newName, allOpen: Boolean(allOpen), entries, count: total };
}

function applyOpenRename(model, plan) {
  if (!model || typeof model.find !== "function" || typeof model.setText !== "function" ||
      !plan || !Array.isArray(plan.entries) || !plan.entries.length)
    throw new TypeError("Invalid rename plan or document model.");
  for (const entry of plan.entries) {
    const doc = model.find(entry.id);
    if (!doc || doc.language !== plan.language || doc.text !== entry.before)
      throw new Error("An open buffer changed after rename preview; preview again.");
  }
  const changed = [];
  try {
    for (const entry of plan.entries) {
      if (!model.setText(entry.id, entry.after))
        throw new Error("Could not update " + entry.label + ".");
      changed.push(entry);
    }
  } catch (error) {
    for (const entry of changed.reverse()) model.setText(entry.id, entry.before);
    throw error;
  }
  return { documents: changed.length, references: plan.count };
}

const api = Object.freeze({ planOpenRename, applyOpenRename, parse, glyph, clip, identifierAt, findDefinitions, findDefinition,
  definitionAt, uniqueOpenDefinition, findReferences, findOpenReferences, MAX_REFERENCES, MAX_SOURCE, MAX_SYMBOLS, MAX_LINE, LANGUAGES, GLYPHS });
root.FlowStudioSymbols = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
