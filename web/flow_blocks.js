/* Python and R blocks inside Flow source, for the editor.
 *
 *   let m: f64 = python(xs) {
 *       import numpy as np
 *       np.mean(xs)
 *   }
 *
 * src/flow_blocks.py rewrites blocks into bridge calls on the server before
 * a program is checked or run. This file reads blocks with the same rules
 * (tests/fixtures/flow_blocks_cases.json holds both to them) for the parts
 * that run in the browser:
 *
 *   find(text)   the blocks, or throws a BlockError with line and column
 *   view(text)   the source as Flow's language server should see it. Each
 *                block becomes a call of an extern function that takes the
 *                passed Flow values and returns the block's type, so hover,
 *                definitions and diagnostics work on the values. The
 *                Python or R code becomes blank lines. Lines never move, and
 *                positions on rewritten lines map both ways.
 *   mask(text)   the same text for code that only needs Flow's structure,
 *                such as statement splitting
 */
(function (root) {
"use strict";

const KEYWORDS = new Set(["python", "r"]);
const MAX_ARGUMENTS = 64;
const MAX_ARRAY = 100000;
const SCALAR_RESULTS = new Set(["f64", "f32", "i64", "i32", "bool", "string", "void"]);
const ARRAY_ELEMENTS = new Set(["f64", "f32", "i64", "i32", "bool", "string"]);
const HEADS = new Set(["if", "elif", "while", "for", "match", "function", "struct", "enum", "extern", "import",
  "export", "type", "trait", "impl", "flow", "field", "const", "else"]);
const R_RESERVED = new Set(["if", "else", "repeat", "while", "function", "for", "next", "break", "TRUE", "FALSE",
  "NULL", "Inf", "NaN", "NA", "NA_integer_", "NA_real_", "NA_complex_", "NA_character_", "in"]);
// keyword.kwlist of Python 3.
const PYTHON_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
  "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with",
  "yield"]);
// A block may follow one of these characters, or return, and, or, not.
const AFTER = "=(,[+-*/%<>!&|";
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAMED_ARGUMENT = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*/;
const LET_ANNOTATION = /^\s*let\s+(?:mut\s+)?[A-Za-z_][A-Za-z0-9_]*\s*:\s*(.+?)\s*=\s*$/d;
const ARRAY_RESULT = /^array\s*<\s*([A-Za-z0-9_]+)\s*,\s*([0-9]+)\s*>$/;

class BlockError extends Error {
  constructor(line, column, message) {
    super(message);
    this.line = line;        // 1-based
    this.column = column;    // 1-based
  }
  text() { return "line " + this.line + ": " + this.message; }
}

/* The line with Flow string contents blanked and its comment removed. */
function codeMask(line) {
  let out = "", quoted = false, escaped = false;
  for (const char of line) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') { quoted = false; out += '"'; continue; }
      out += " ";
      continue;
    }
    if (char === "#") break;
    if (char === '"') quoted = true;
    out += char;
  }
  return out;
}

function leading(line) {
  return line.slice(0, line.length - line.replace(/^[ \t]+/, "").length);
}

function statementHead(masked) {
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(masked.replace(/^[ \t}]+/, ""));
  return match ? match[0] : "";
}

function canStartHere(masked, column) {
  const before = masked.slice(0, column).replace(/\s+$/, "");
  if (HEADS.has(statementHead(masked))) return false;
  if (!before) return true;
  if (AFTER.includes(before[before.length - 1])) return true;
  return /(?:^|[^A-Za-z0-9_])(?:return|and|or|not)$/.test(before);
}

function matchingParen(masked, start) {
  let depth = 0;
  for (let index = start; index < masked.length; index++) {
    const char = masked[index];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) {
      depth--;
      if (depth === 0) return char === ")" ? index : -1;
    }
  }
  return -1;
}

function splitArguments(text, masked, offset) {
  const pieces = [];
  let depth = 0, start = 0;
  for (let index = 0; index < masked.length; index++) {
    const char = masked[index];
    if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) { pieces.push([text.slice(start, index), offset + start]); start = index + 1; }
  }
  pieces.push([text.slice(start), offset + start]);
  return pieces;
}

function dedent(lines) {
  const widths = lines.filter(line => line.trim()).map(leading);
  if (!widths.length) return { lines: lines.map(() => ""), width: 0 };
  let common = widths[0];
  for (const width of widths.slice(1)) while (!width.startsWith(common)) common = common.slice(0, -1);
  return { lines: lines.map(line => line.trim() ? line.slice(common.length) : ""), width: common.length };
}

function normalType(text) {
  return text.trim().replace(/\s+/g, " ").replace(/\s*<\s*/g, "<").replace(/\s*>/g, ">").replace(/\s*,\s*/g, ", ");
}

function resultSupported(kind) {
  if (SCALAR_RESULTS.has(kind)) return true;
  const match = ARRAY_RESULT.exec(kind);
  return !!match && ARRAY_ELEMENTS.has(match[1]) && Number(match[2]) >= 1 && Number(match[2]) <= MAX_ARRAY;
}

function isSpace(char) { return char === " " || char === "\t"; }

/* The block whose keyword is at (number, column), or null when the word is
 * an ordinary name there. Throws BlockError for a block written wrongly. */
function readOpener(lines, number, column, word) {
  const line = lines[number];
  const masked = codeMask(line);
  if (!canStartHere(masked, column)) return null;
  let at = column + word.length;
  while (at < masked.length && isSpace(masked[at])) at++;
  let argumentsText = null, argumentsColumn = 0;
  if (at < masked.length && masked[at] === "(") {
    const close = matchingParen(masked, at);
    if (close < 0) return null;
    argumentsText = line.slice(at + 1, close);
    argumentsColumn = at + 1;
    at = close + 1;
    while (at < masked.length && isSpace(masked[at])) at++;
  }
  let declared = "", declaredColumn = -1;
  if (masked.startsWith("->", at)) {
    const brace = masked.indexOf("{", at);
    if (brace < 0) return null;
    const raw = line.slice(at + 2, brace);
    declared = normalType(raw);
    declaredColumn = at + 2 + (raw.length - raw.replace(/^\s+/, "").length);
    at = brace;
  }
  if (at >= masked.length || masked[at] !== "{") return null;

  const block = { language: word, line: number, column, brace: at, endLine: 0, endColumn: 0, inline: false,
    arguments: [], result: "", code: "", firstLine: 0, indent: "", codeColumn: 0 };
  if (argumentsText !== null && argumentsText.trim()) {
    const seen = new Set();
    const maskedArguments = masked.slice(argumentsColumn, argumentsColumn + argumentsText.length);
    for (const [piece, pieceColumn] of splitArguments(argumentsText, maskedArguments, argumentsColumn)) {
      const stripped = piece.trim();
      const start = pieceColumn + piece.length - piece.replace(/^\s+/, "").length;
      if (!stripped) throw new BlockError(number + 1, start + 1, "an empty argument in this " + word + " block.");
      let argument;
      if (NAME.test(stripped)) {
        argument = { name: stripped, expression: stripped, column: start, nameColumn: start };
      } else {
        const named = NAMED_ARGUMENT.exec(stripped);
        if (!named || !stripped.slice(named[0].length).trim())
          throw new BlockError(number + 1, start + 1, "a " + word + " block argument is a Flow name, or name = expression.");
        argument = { name: named[1], expression: stripped.slice(named[0].length).replace(/\s+$/, ""),
          column: start + named[0].length, nameColumn: start };
      }
      if (word === "python" && PYTHON_KEYWORDS.has(argument.name))
        throw new BlockError(number + 1, argument.nameColumn + 1, "'" + argument.name +
          "' is a Python keyword. Pass it as another name: other = " + argument.name + ".");
      if (word === "r" && R_RESERVED.has(argument.name))
        throw new BlockError(number + 1, argument.nameColumn + 1, "'" + argument.name +
          "' is reserved in R. Pass it as another name: other = " + argument.name + ".");
      if (seen.has(argument.name))
        throw new BlockError(number + 1, argument.nameColumn + 1, "'" + argument.name +
          "' is passed to this " + word + " block twice.");
      seen.add(argument.name);
      block.arguments.push(argument);
    }
    if (block.arguments.length > MAX_ARGUMENTS)
      throw new BlockError(number + 1, column + 1, "a " + word + " block takes at most " + MAX_ARGUMENTS + " values.");
  }

  const rest = line.slice(at + 1);
  if (!rest.trim() || rest.replace(/^\s+/, "").startsWith("#")) {
    const indent = leading(line);
    let end = -1;
    for (let later = number + 1; later < lines.length; later++) {
      const text = lines[later];
      if (leading(text) === indent && text.slice(indent.length, indent.length + 1) === "}") { end = later; break; }
    }
    if (end < 0)
      throw new BlockError(number + 1, at + 1, "this " + word + " block has no closing }. Put } on its own line, " +
        "indented like the line that opens the block.");
    block.endLine = end;
    block.endColumn = indent.length;
    block.indent = indent;
    const body = dedent(lines.slice(number + 1, end));
    block.code = body.lines.join("\n");
    block.codeColumn = body.width;
    block.firstLine = number + 2;
  } else {
    const close = line.lastIndexOf("}");
    if (close <= at)
      throw new BlockError(number + 1, at + 1, "this one-line " + word + " block has no closing } on its line. " +
        "A block on several lines opens with { at the end of its first line.");
    block.inline = true;
    block.endLine = number;
    block.endColumn = close;
    const inner = line.slice(at + 1, close);
    block.code = inner.trim();
    block.codeColumn = at + 1 + inner.length - inner.replace(/^\s+/, "").length;
    block.firstLine = number + 1;
  }

  let where;
  if (declared) {
    block.result = declared;
    where = declaredColumn;
  } else {
    const prefix = line.slice(0, column);
    const suffix = codeMask(lines[block.endLine].slice(block.endColumn + 1)).trim();
    const annotation = suffix ? null : LET_ANNOTATION.exec(codeMask(prefix));
    if (annotation) {
      block.result = normalType(prefix.slice(annotation.indices[1][0], annotation.indices[1][1]));
      where = annotation.indices[1][0];
    } else if (!codeMask(prefix).trim() && !suffix) {
      block.result = "void";
      where = column;
    } else {
      block.result = "string";
      where = column;
    }
  }
  if (!resultSupported(block.result))
    throw new BlockError(number + 1, where + 1, "a " + word + " block cannot return " + block.result +
      ". It returns f64, f32, i64, i32, bool, string or an array of those. Write -> string to get the value as text.");
  return block;
}

/* Every block in the source, in order. Throws BlockError. */
function find(source) {
  const lines = String(source == null ? "" : source).split("\n");
  const blocks = [];
  let number = 0, start = 0;
  while (number < lines.length) {
    const masked = codeMask(lines[number]);
    let index = start;
    start = 0;
    let moved = false;
    while (index < masked.length) {
      const char = masked[index];
      if (/[A-Za-z_]/.test(char)) {
        let end = index;
        while (end < masked.length && /[A-Za-z0-9_]/.test(masked[end])) end++;
        const word = masked.slice(index, end);
        const previous = index > 0 ? masked[index - 1] : "";
        if (KEYWORDS.has(word) && previous !== ".") {
          const block = readOpener(lines, number, index, word);
          if (block) {
            blocks.push(block);
            number = block.endLine;
            start = block.endColumn + 1;
            moved = true;
            break;
          }
        }
        index = end;
        continue;
      }
      index++;
    }
    if (!moved) number++;
  }
  return blocks;
}

/* The language server's copy, or null when the source has no blocks or a
 * block is written wrongly. */
function view(source) {
  const text = String(source == null ? "" : source);
  let blocks;
  try { blocks = find(text); } catch (_) { return null; }
  if (!blocks.length) return null;
  const lines = text.split("\n");
  const originalCount = lines.length;
  // line -> [[new column, old column, length]] for text copied from the
  // source; anything else on a rewritten line maps back to fallback.
  const columns = new Map();
  const fallback = new Map();
  const externs = [];
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    const opener = lines[block.line];
    const closing = lines[block.endLine];
    const prefix = opener.slice(0, block.column);
    const segments = [[0, 0, prefix.length]];
    let call = "flowstudio_view_" + index + "(0";
    for (const argument of block.arguments) {
      call += ", ";
      segments.push([prefix.length + call.length, argument.column, argument.expression.length]);
      call += argument.expression;
    }
    const tailOld = block.endColumn + 1;
    if (block.inline) {
      const head = prefix + call + ")";
      segments.push([head.length, tailOld, opener.length - tailOld]);
      lines[block.line] = head + opener.slice(tailOld);
    } else {
      lines[block.line] = prefix + call;
      for (let body = block.line + 1; body < block.endLine; body++) lines[body] = "";
      const head = block.indent + ")";
      lines[block.endLine] = head + closing.slice(tailOld);
      columns.set(block.endLine, [[0, 0, block.indent.length], [head.length, tailOld, closing.length - tailOld]]);
      fallback.set(block.endLine, block.endColumn);
    }
    columns.set(block.line, segments.concat(columns.get(block.line) || []));
    fallback.set(block.line, block.column);
    externs.unshift("    function flowstudio_view_" + index + "(flowstudio_n: i32, ...) -> " + block.result);
  }
  lines.push("extern {", ...externs, "}");
  function toVirtualPosition(line, character) {
    const segments = columns.get(line);
    if (!segments) return { line, character };
    for (const [next, old, length] of segments)
      if (length > 0 && character >= old && character <= old + length) return { line, character: next + character - old };
    return { line, character: (segments[1] || segments[0])[0] };
  }
  function toRealPosition(line, character) {
    if (line < 0 || line >= originalCount) return null;
    const segments = columns.get(line);
    if (!segments) return { line, character };
    for (const [next, old, length] of segments)
      if (length > 0 && character >= next && character <= next + length) return { line, character: old + character - next };
    return { line, character: fallback.get(line) };
  }
  return {
    text: lines.join("\n"), blocks, lineCount: originalCount,
    toVirtual: line => line,
    toReal: line => (line >= 0 && line < originalCount ? line : null),
    toVirtualPosition, toRealPosition
  };
}

/* The source with every block's foreign code blanked, line for line. */
function mask(text) {
  const source = String(text == null ? "" : text);
  const shown = view(source);
  return shown ? shown.text.split("\n").slice(0, shown.lineCount).join("\n") : source;
}

const api = Object.freeze({ find, view, mask, codeMask, BlockError });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioFlowBlocks = api;
})(globalThis);
