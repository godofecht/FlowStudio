/* FlowStudio completion core. Pure logic shared by the Monaco provider.
 * Merges three honest sources per language:
 *  - Flow: lexical symbols from /app/completion.js's flowSymbols logic,
 *    reimplemented here locally (same regexes) to avoid shipping a second copy.
 *  - Python/R: live session variable names from /api/inspect/{python,r}.
 *  - Snippets + keywords per language.
 */
(function (global) {
"use strict";
const MAX_ITEMS = 64;
const PYTHON_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const R_NAME = /^[A-Za-z.][A-Za-z0-9._]{0,79}$/;
const FLOW_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;

const SNIPPETS = Object.freeze({
  flow: Object.freeze([
    { label: "function", insert: "function ${name}() -> i32 {\n    return 0\n}" },
    { label: "let mut", insert: "let mut ${name}: i64 = 0" },
    { label: "if", insert: "if ${condition} {\n    \n}" },
    { label: "for", insert: "for ${item} in ${items} {\n    \n}" }
  ]),
  python: Object.freeze([
    { label: "def", insert: "def ${name}():\n    " },
    { label: "main guard", insert: "if __name__ == \"__main__\":\n    " }
  ]),
  r: Object.freeze([
    { label: "function", insert: "${name} <- function() {\n    \n}" },
    { label: "read.csv", insert: "read.csv(\"${path}\")" }
  ])
});

const KEYWORDS = Object.freeze({
  flow: Object.freeze(["function", "return", "let", "mut", "const", "if", "else",
    "while", "for", "in", "import", "export", "struct", "enum", "trait", "match",
    "true", "false", "and", "or"]),
  python: Object.freeze(["def", "class", "return", "import", "from", "as", "if",
    "elif", "else", "for", "while", "with", "try", "except", "finally", "lambda",
    "pass", "raise", "yield", "None", "True", "False"]),
  r: Object.freeze(["function", "if", "else", "for", "while", "repeat", "return",
    "library", "require", "TRUE", "FALSE", "NULL", "NA", "Inf", "NaN"])
});

function validPrefix(prefix, language) {
  const pattern = language === "r" ? R_NAME :
    language === "python" ? PYTHON_NAME : FLOW_NAME;
  return pattern.test(prefix);
}

/* Same as docs/app/completion.js: mask comments and strings, collect
 * top-level declarations, imports and in-scope bindings. */
function flowSymbols(source, cursor, prefix) {
  if (typeof source !== "string" || source.length > 262144 ||
      !Number.isSafeInteger(cursor) || cursor < 0 || cursor > source.length ||
      !FLOW_NAME.test(prefix))
    return null;
  const chars = source.split("");
  let quote = "", comment = false;
  for (let i = 0; i < chars.length; i++) {
    const c = source[i];
    if (comment) {
      if (c === "\n" || c === "\r") comment = false;
      else { chars[i] = " "; continue; }
    }
    if (quote) {
      if (c === "\\") { chars[i] = " "; if (i + 1 < chars.length) chars[++i] = " "; continue; }
      if (c === quote) quote = "";
      if (c !== "\n" && c !== "\r") chars[i] = " ";
      continue;
    }
    if (c === "#") { comment = true; chars[i] = " "; }
    else if (c === "\"" || c === "'") { quote = c; chars[i] = " "; }
  }
  const masked = chars.join("");
  const names = new Set();
  const add = name => { if (FLOW_NAME.test(name) && name.startsWith(prefix)) names.add(name); };
  for (const match of masked.matchAll(/\b(?:function|struct|enum|trait|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g))
    add(match[1]);
  for (const match of masked.matchAll(/\bimport\s+[^{}\n]{1,256}\{([^}]*)\}/g))
    for (const entry of match[1].split(",")) add(entry.trim());
  // Innermost function containing the cursor: parameters and let bindings.
  let active = null;
  for (const match of masked.matchAll(/\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)[^{\n]*\{/g)) {
    const open = match.index + match[0].length - 1;
    if (open >= cursor) continue;
    let depth = 1, end = open + 1;
    for (; end < masked.length && depth > 0; end++) {
      if (masked[end] === "{") depth++;
      else if (masked[end] === "}") depth--;
    }
    if (cursor < end && (!active || open > active.open)) active = { open, parameters: match[1] };
  }
  if (active) {
    for (const match of active.parameters.matchAll(/(?:^|,|\()\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g))
      add(match[1]);
    const scopes = [new Set()];
    for (const token of masked.slice(active.open + 1, cursor).matchAll(/\b(?:let\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)|[{}])/g)) {
      if (token[0] === "{") scopes.push(new Set());
      else if (token[0] === "}") { if (scopes.length > 1) scopes.pop(); }
      else scopes[scopes.length - 1].add(token[1]);
    }
    for (const scope of scopes) for (const name of scope) add(name);
  }
  return [...names].sort().slice(0, MAX_ITEMS);
}

function bufferIdentifiers(source, prefix, language, cursorLimit) {
  const found = new Set();
  if (typeof source !== "string" || source.length > (cursorLimit || 262144)) return found;
  const bound = Math.min(source.length, cursorLimit || source.length);
  const isR = language === "r";
  let token = "";
  for (let index = 0; index <= bound; index++) {
    const char = index < bound ? source[index] : " ";
    const isWord = (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9") || char === "_" || char === ".";
    // Leading dots start tokens only in R; elsewhere a dot continues a word.
    if (isWord && (char !== "." || isR || token !== "")) {
      token += char;
    } else if (token) {
      if (token.startsWith(prefix) && token !== prefix) found.add(token);
      token = "";
    }
  }
  return found;
}


/* Complete only names already present in the native R inspector's bounded,
 * inert list metadata. Never evaluate R expressions or infer S3 methods. */
const R_MEMBER = /^(?:[A-Za-z]|\.[A-Za-z_])[A-Za-z0-9._]{0,79}$/;
const R_RESERVED = new Set(["if", "else", "repeat", "while", "function",
  "for", "in", "next", "break", "TRUE", "FALSE", "NULL", "Inf", "NaN",
  "NA", "NA_integer_", "NA_real_", "NA_complex_", "NA_character_"]);
const rSafeName = name => R_MEMBER.test(name) && !R_RESERVED.has(name);
function rMemberContext(lineBeforeCursor) {
  if (typeof lineBeforeCursor !== "string" || lineBeforeCursor.length > 4096) return null;
  let masked = "", quote = null;
  for (let i = 0; i < lineBeforeCursor.length; i++) {
    const c = lineBeforeCursor[i];
    if (quote) {
      masked += " ";
      if (c === "\\") { if (++i < lineBeforeCursor.length) masked += " "; }
      else if (c === quote) quote = null;
    } else if (c === "#") break;
    else if (c === "'" || c === '"' || c === "\x60") { quote = c; masked += " "; }
    else masked += c;
  }
  const name = "(?:[A-Za-z]|\\.[A-Za-z_])[A-Za-z0-9._]{0,79}";
  const pattern = new RegExp("(?:^|[^A-Za-z0-9._$])(" + name +
    "(?:\\$" + name + "){0,2})\\$([A-Za-z._][A-Za-z0-9._]{0,79})?$");
  const match = pattern.exec(masked);
  if (!match) return null;
  const path = match[1].split("$");
  if (!path.every(rSafeName)) return null;
  return { path, prefix: match[2] || "" };
}
function rListMembers(variables, path, prefix = "") {
  if (!Array.isArray(variables) || !Array.isArray(path) ||
      path.length < 1 || path.length > 3 || !path.every(rSafeName) ||
      typeof prefix !== "string" || prefix.length > 80 ||
      (prefix && !/^[A-Za-z._][A-Za-z0-9._]*$/.test(prefix))) return [];
  let node = variables.slice(0, 128).find(item =>
    item && item.name === path[0] && item.type === "list");
  for (const part of path.slice(1)) {
    if (!node || !Array.isArray(node.children) || node.children.length > 12) return [];
    node = node.children.find(item => {
      if (!item || typeof item.name !== "string") return false;
      const match = /^\[\[[1-9][0-9]{0,3}\]\] (.+)$/.exec(item.name);
      return match && match[1] === part && item.type === "list";
    });
  }
  if (!node || !Array.isArray(node.children) || node.children.length > 12) return [];
  const found = new Set();
  for (const child of node.children) {
    if (!child || typeof child.name !== "string") continue;
    const match = /^\[\[[1-9][0-9]{0,3}\]\] (.+)$/.exec(child.name);
    const name = match && match[1];
    if (name && rSafeName(name) && name.startsWith(prefix)) found.add(name);
  }
  return [...found].sort().slice(0, MAX_ITEMS)
    .map(name => ({label:name, kind:"variable", insert:name}));
}

function suggestionsFor(language, data) {
  if (!["flow", "python", "r"].includes(language)) return [];
  const prefix = data.prefix || "";
  if (!validPrefix(prefix, language)) return [];
  const out = [];
  const seen = new Set();
  const push = (label, kind, insert) => {
    if (out.length >= MAX_ITEMS || seen.has(label)) return;
    seen.add(label);
    out.push({ label, kind, insert: insert || label });
  };
  for (const name of data.session || []) if (validPrefix(name, language) && name.startsWith(prefix))
    push(name, "variable");
  for (const name of data.lexical || []) if (name.startsWith(prefix)) push(name, "lexical");
  for (const keyword of KEYWORDS[language]) if (keyword.startsWith(prefix)) push(keyword, "keyword");
  for (const snippet of SNIPPETS[language]) if (snippet.label.startsWith(prefix))
    push(snippet.label, "snippet", snippet.insert);
  return out;
}

const api = Object.freeze({ suggestionsFor, flowSymbols, bufferIdentifiers,
  validPrefix, rMemberContext, rListMembers, SNIPPETS, KEYWORDS, MAX_ITEMS });
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioCompletionCore = api;
})(globalThis);
