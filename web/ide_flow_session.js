/* The persistent Flow console session.
 *
 * The server keeps Flow variables, functions, structs and imports between
 * console entries (src/flow_session.py). This module is the browser side:
 * it sends entries, keeps the latest variable list, draws the Environment
 * table for Flow, and finds the statement under the cursor so Ctrl+Enter
 * can send it, the way R users send a line from a script.
 */
(function (root) {
"use strict";

const ROUTE = "/api/flow/session/";
const DECLARATION = /^(?:pub\s+)?(?:function|struct|enum|import|extern|type|const|trait|impl|field)\b/;

function createClient(request) {
  const listeners = new Set();
  let variables = null;

  async function call(op, body) {
    const response = await request(ROUTE + op, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
      body: body || ""
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    return { status: response.status, ok: response.ok, data, text };
  }
  function publish(list) {
    if (!Array.isArray(list)) return;
    variables = list;
    for (const listener of listeners) {
      try { listener(list); } catch (_) { /* a broken listener must not stop the others */ }
    }
  }
  return {
    async evaluate(code) {
      const result = await call("eval", code);
      if (result.data) publish(result.data.variables);
      return result;
    },
    async state() {
      const result = await call("state");
      if (result.data) publish(result.data.variables);
      return result.data;
    },
    async reset() {
      const result = await call("reset");
      if (result.ok) publish([]);
      return result.ok;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    variables: () => variables
  };
}

/* Code with string contents and comments blanked, for bracket counts. */
function codeOnly(line) {
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

/* Top-level items of a Flow source with their line ranges (0-based,
 * end exclusive). An `else` or `elif` line joins the item before it. */
function items(text) {
  const lines = String(text || "").split("\n");
  const found = [];
  let depth = 0, start = -1;
  lines.forEach((line, index) => {
    const code = codeOnly(line);
    if (start < 0) {
      if (!code.trim()) return;
      if (depth === 0 && /^\s*(?:\}\s*)?(?:else|elif)\b/.test(line) && found.length) {
        start = found.pop().start;
      } else {
        start = index;
      }
    }
    for (const char of code) {
      if ("{([".includes(char)) depth++;
      else if ("})]".includes(char)) depth = Math.max(0, depth - 1);
    }
    const continues = /(?:[=+\-*/,(]|\band|\bor|&&|\|\|)\s*$/.test(code);
    if (depth === 0 && !continues) {
      found.push({ start, end: index + 1 });
      start = -1;
    }
  });
  if (start >= 0) found.push({ start, end: lines.length });
  return found.map(item => ({
    start: item.start, end: item.end,
    code: lines.slice(item.start, item.end).join("\n"),
    declaration: DECLARATION.test(lines[item.start])
  }));
}

function lineOf(text, offset) {
  return String(text || "").slice(0, Math.max(0, offset)).split("\n").length - 1;
}

function offsetOfLine(text, line) {
  const lines = String(text || "").split("\n");
  let offset = 0;
  for (let i = 0; i < Math.min(line, lines.length); i++) offset += lines[i].length + 1;
  return Math.min(offset, String(text || "").length);
}

/* The statement or declaration under the cursor, and where the cursor
 * goes next: the start of the following item. */
function statementAt(text, offset) {
  const line = lineOf(text, offset);
  const list = items(text);
  let index = list.findIndex(item => line >= item.start && line < item.end);
  if (index < 0) index = list.findIndex(item => item.start > line);
  if (index < 0) return null;
  const item = list[index];
  const next = list[index + 1];
  return { code: item.code, start: item.start, end: item.end,
    next: next ? offsetOfLine(text, next.start) : String(text || "").length };
}

function hasMain(text) {
  return /(^|\n)\s*(?:pub\s+)?function\s+main\s*\(/.test(String(text || ""));
}

/* The Environment table for Flow variables. Values are text only. */
function renderEnvironment(container, variables, doc) {
  doc = doc || root.document;
  const list = Array.isArray(variables) ? variables : [];
  if (!list.length) {
    const empty = doc.createElement("p");
    empty.className = "muted";
    empty.textContent = "No Flow variables yet. Run a line with Ctrl+Enter, or type in the Flow console.";
    container.replaceChildren(empty);
    return;
  }
  const table = doc.createElement("table");
  table.className = "flow-env";
  const caption = doc.createElement("caption");
  caption.textContent = "Flow session variables";
  table.append(caption);
  const header = doc.createElement("tr");
  for (const label of ["Name", "Type", "Value"]) {
    const cell = doc.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  table.append(header);
  for (const variable of list.slice(0, 256)) {
    if (!variable || typeof variable.name !== "string") continue;
    const row = doc.createElement("tr");
    row.dataset.name = variable.name;
    const name = doc.createElement("td");
    name.textContent = variable.name + (variable.mutable ? " (mut)" : "");
    const type = doc.createElement("td");
    type.textContent = String(variable.type || "unknown");
    const value = doc.createElement("td");
    value.className = "flow-env-value";
    if (variable.kept === false) {
      row.classList.add("flow-env-lost");
      value.textContent = variable.display ? variable.display + " (not kept)" : "not kept";
      value.title = "FlowStudio cannot carry this value to the next entry. Later entries cannot use it.";
    } else {
      value.textContent = String(variable.display == null ? "" : variable.display);
      value.title = value.textContent;
    }
    row.append(name, type, value);
    table.append(row);
  }
  container.replaceChildren(table);
}

const api = Object.freeze({ createClient, items, statementAt, hasMain, renderEnvironment, codeOnly });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioFlowSession = Object.freeze(Object.assign({}, api, {
  client: typeof root.fetch === "function" ? createClient((url, init) => root.fetch(url, init)) : null
}));
})(globalThis);
