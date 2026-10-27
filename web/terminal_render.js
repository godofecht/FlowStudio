/* FlowStudio terminal markup: HTML-escaped output with a bounded ANSI color
 * parser. Rendered HTML never interprets console content as script; the
 * renderer recognizes only an explicit SGR control subset. */
(function (root) {
"use strict";

/* Maximum console text the renderer will expand in one call. */
const MAX_RENDERED = 262144;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Bounded SGR subset: 3/4-bit foreground colors plus bold/dim. Unsupported
 * codes are dropped, never emitted raw. */
const COLORS = { 30: "fs-black", 31: "fs-red", 32: "fs-green", 33: "fs-yellow",
  34: "fs-blue", 35: "fs-magenta", 36: "fs-cyan", 37: "fs-white",
  90: "fs-bright-black", 91: "fs-bright-red", 92: "fs-bright-green",
  93: "fs-bright-yellow", 94: "fs-bright-blue", 95: "fs-bright-magenta",
  96: "fs-bright-cyan", 97: "fs-bright-white" };

function applySgr(codes, classes) {
  let next = classes.length && !codes.includes(0) ? new Set(classes) : new Set();
  for (const code of codes) {
    if (code === 0) next = new Set();
    else if (code === 1) next.add("fs-bold");
    else if (code === 2) next.add("fs-dim");
    else if (code === 22 || code === 23) { next.delete("fs-bold"); next.delete("fs-dim"); }
    else if (COLORS[code]) next.add(COLORS[code]);
  }
  return [...next];
}

/* Combined scanner: SGR color runs (captured), other CSI sequences and
 * OSC strings (dropped). Unknown terminal noise never reaches the page. */
const ESCAPE_ALL = /\x1b\[([0-9;]*)m|\x1b\[[0-9;?]*[ -/]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const PROMPT = /^> /;
const ERROR_CAST = /^(?:SyntaxError|IndentationError|NameError|TypeError|AttributeError|LookupError|KeyError|IndexError|RuntimeError|OSError|ValueError|ImportError|ModuleNotFoundError|UnicodeError|PermissionError)\b/;
const ERROR_MARK = /\b(?:error:|Error:|failed:|undefined symbol:)\s*\S|Process exited|Process error:/;

function isErrorLine(line) {
  return /^Traceback \(most recent call last\)/.test(line) ||
    /^\s+File "/.test(line) || ERROR_CAST.test(line) || ERROR_MARK.test(line);
}

/* Render plain console text that may embed ANSI SGR to safe, classed HTML.
 * Color state carries across lines like a real terminal; spans always close. */
function render(text) {
  if (typeof text !== "string") return "";
  const clipped = text.length > MAX_RENDERED ? text.slice(-MAX_RENDERED) : text;
  const lines = clipped.split(/\r\n|\r|\n/);
  let carry = [];
  return lines.map(line => {
    const plain = line.replace(ESCAPE_ALL, "");
    let classes = carry.slice();
    let open = classes.length;
    let out = open ? '<span class="' + classes.join(" ") + '">' : "";
    let start = 0;
    ESCAPE_ALL.lastIndex = 0;
    let match;
    while ((match = ESCAPE_ALL.exec(line)) !== null) {
      const emit = escapeHtml(line.slice(start, match.index));
      if (open) out += emit + "</span>";
      else out += emit;
      if (match[1] !== undefined) {
        classes = applySgr(match[1] === "" ? [0] : match[1].split(";").map(Number), classes);
      }
      open = classes.length;
      out += open ? '<span class="' + classes.join(" ") + '">' : "";
      start = ESCAPE_ALL.lastIndex;
    }
    out += escapeHtml(line.slice(start));
    if (open) out += "</span>";
    carry = classes;
    const labels = [];
    if (PROMPT.test(plain)) labels.push("fs-prompt-line");
    if (isErrorLine(plain)) labels.push("fs-error-line");
    return labels.length ? '<span class="' + labels.join(" ") + '">' + out + "</span>" : out;
  }).join("\n");
}

const api = Object.freeze({ escapeHtml, applySgr, render, MAX_RENDERED });
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof root === "object") root.FlowStudioTerminal = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
