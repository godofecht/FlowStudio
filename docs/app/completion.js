/* Browser runtime completion for Python/R and lexical source completion for Flow. */
(function (global) {
"use strict";
const PYTHON_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const R_NAME = /^[A-Za-z.][A-Za-z0-9._]{0,79}$/;
const FLOW_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const MAX_FLOW_SOURCE = 262144;
const MAX_ITEMS = 64;

/* Keep offsets intact while hiding Flow # comments and quoted literals.
 * This is a lexical editor aid, not a replacement for flowc type checking.
 */
function maskFlow(source) {
  const chars = source.split("");
  let quote = "", comment = false;
  for (let i = 0; i < chars.length; i++) {
    const c = source[i];
    if (comment) {
      if (c === "\n" || c === "\r") comment = false;
      else { chars[i] = " "; continue; }
    }
    if (quote) {
      if (c === "\\") {
        chars[i] = " ";
        if (i + 1 < chars.length) chars[++i] = " ";
        continue;
      }
      if (c === quote) quote = "";
      if (c !== "\n" && c !== "\r") chars[i] = " ";
      continue;
    }
    if (c === "#") { comment = true; chars[i] = " "; }
    else if (c === '"' || c === "'") { quote = c; chars[i] = " "; }
  }
  return chars.join("");
}
function flowSymbols(source, cursor, prefix) {
  if (typeof source !== "string" || source.length > MAX_FLOW_SOURCE ||
      !Number.isSafeInteger(cursor) || cursor < 0 || cursor > source.length ||
      !FLOW_NAME.test(prefix))
    return {ok:false, output:"Flow source-local completion supports buffers up to 256 KiB."};
  const masked = maskFlow(source);
  const names = new Set();
  const add = name => { if (FLOW_NAME.test(name) && name.startsWith(prefix)) names.add(name); };
  // Top-level names and explicit imports are available throughout the module.
  for (const match of masked.matchAll(/\b(?:function|struct|enum|trait|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g))
    add(match[1]);
  for (const match of masked.matchAll(/\bimport\s+[^{}\n]{1,256}\{([^}]*)\}/g))
    for (const entry of match[1].split(","))
      add(entry.trim());
  // Find the innermost function whose body contains the cursor.
  let active = null;
  for (const match of masked.matchAll(/\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)[^{\n]*\{/g)) {
    const open = match.index + match[0].length - 1;
    if (open >= cursor) continue;
    let depth = 1, end = open + 1;
    for (; end < masked.length && depth > 0; end++) {
      if (masked[end] === "{") depth++;
      else if (masked[end] === "}") depth--;
    }
    if (cursor < end && (!active || open > active.open)) active = {open, parameters:match[1]};
  }
  if (active) {
    for (const match of active.parameters.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g))
      add(match[1]);
    const scopes = [new Set()];
    const body = masked.slice(active.open + 1, cursor);
    for (const token of body.matchAll(/[{}]|\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      if (token[0] === "{") scopes.push(new Set());
      else if (token[0] === "}") { if (scopes.length > 1) scopes.pop(); }
      else scopes[scopes.length - 1].add(token[1]);
    }
    for (const scope of scopes) for (const name of scope) add(name);
  }
  return {ok:true, items:[...names].sort().slice(0, MAX_ITEMS)};
}

/* Source-local Flow member completion for explicitly typed struct and flow state.
 * Deliberately not an inferred type system or a replacement for flowc.
 */
function flowTypeFields(masked) {
  const types = new Map();
  for (const match of masked.matchAll(/\b(struct|flow)\s+([A-Za-z_]\w*)\s*\{/g)) {
    const open = match.index + match[0].length - 1;
    let depth = 1, end = open + 1;
    for (; end < masked.length && depth > 0; end++) {
      if (masked[end] === "{") depth++;
      else if (masked[end] === "}") depth--;
    }
    if (depth) continue;
    const body = masked.slice(open + 1, end - 1);
    const fields = new Set();
    if (match[1] === "struct") {
      let start = 0, nesting = 0;
      for (let i = 0; i <= body.length; i++) {
        const ch = body[i];
        if (ch === "{") nesting++;
        else if (ch === "}") nesting--;
        if (nesting === 0 && (i === body.length || ch === "," || ch === "\n")) {
          const field = /^\s*([A-Za-z_]\w*)\s*:\s*[A-Za-z_]\w*/.exec(body.slice(start, i));
          if (field && FLOW_NAME.test(field[1])) fields.add(field[1]);
          start = i + 1;
        }
      }
    } else {
      for (const field of body.matchAll(/(?:^|[\r\n])\s*state\s+([A-Za-z_]\w*)\s*:/g))
        if (FLOW_NAME.test(field[1])) fields.add(field[1]);
    }
    types.set(match[2], fields);
  }
  return types;
}
function flowBindingType(masked, cursor, receiver) {
  // Ignore local declarations while collecting module-scope bindings.
  const globals = new Map();
  let depth = 0;
  const bindings = /[{}]|\b(?:let|const)\s+(?:mut\s+)?([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_]\w*))?/g;
  for (const token of masked.slice(0, cursor).matchAll(bindings)) {
    if (token[0] === "{") depth++;
    else if (token[0] === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) globals.set(token[1], token[2] || null);
  }
  let active = null;
  for (const match of masked.matchAll(/\bfunction\s+[A-Za-z_]\w*\s*\(([^)]*)\)[^{\n]*\{/g)) {
    const open = match.index + match[0].length - 1;
    if (open >= cursor) continue;
    let nesting = 1, end = open + 1;
    for (; end < masked.length && nesting > 0; end++) {
      if (masked[end] === "{") nesting++;
      else if (masked[end] === "}") nesting--;
    }
    if (cursor < end && (!active || open > active.open))
      active = {open, parameters:match[1]};
  }
  if (!active) return globals.get(receiver) || null;
  const params = new Map();
  for (const match of active.parameters.matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g))
    params.set(match[1], match[2]);
  const scopes = [params];
  for (const token of masked.slice(active.open + 1, cursor).matchAll(bindings)) {
    if (token[0] === "{") scopes.push(new Map());
    else if (token[0] === "}") { if (scopes.length > 1) scopes.pop(); }
    else scopes[scopes.length - 1].set(token[1], token[2] || null);
  }
  for (let i = scopes.length - 1; i >= 0; i--)
    if (scopes[i].has(receiver)) return scopes[i].get(receiver);
  return globals.get(receiver) || null;
}
function flowMembers(source, cursor, receiver, prefix) {
  if (typeof source !== "string" || source.length > MAX_FLOW_SOURCE ||
      !Number.isSafeInteger(cursor) || cursor < 0 || cursor > source.length ||
      !FLOW_NAME.test(receiver) || (prefix !== "" && !FLOW_NAME.test(prefix)))
    return {ok:false, output:"Flow member completion supports buffers up to 256 KiB."};
  const masked = maskFlow(source);
  const type = flowBindingType(masked, cursor, receiver);
  const fields = type ? flowTypeFields(masked).get(type) : null;
  return {ok:true, items:fields ?
    [...fields].filter(name => name.startsWith(prefix)).sort().slice(0, MAX_ITEMS) : []};
}

function prefixAt(source, language) {
  if (!source || typeof source.value !== "string" ||
      !Number.isSafeInteger(source.selectionStart) ||
      source.selectionStart !== source.selectionEnd) return null;
  const cursor = source.selectionStart;
  if (cursor < 0 || cursor > source.value.length) return null;
  const before = source.value.slice(0, cursor);
  if (language === "flow") {
    const member = before.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]{0,79})?$/);
    if (member) {
      const memberPrefix = member[2] || "";
      const start = cursor - memberPrefix.length;
      const receiverStart = start - member[1].length - 1;
      if (maskFlow(before).slice(receiverStart) !== before.slice(receiverStart)) return null;
      return {prefix:memberPrefix, start, cursor, receiver:member[1]};
    }
  }
  const match = before.match(language === "python" ?
    /([A-Za-z_][A-Za-z0-9_]{0,79})$/ :
    language === "r" ? /([A-Za-z.][A-Za-z0-9._]{0,79})$/ :
    language === "flow" ? /([A-Za-z_][A-Za-z0-9_]{0,79})$/ : /$^/);
  if (!match) return null;
  const start = cursor - match[1].length;
  if (language === "flow" && maskFlow(before).slice(start) !== before.slice(start)) return null;
  // Attribute, namespace and member completion require a different protocol.
  if (language === "python" && start > 0 && before[start - 1] === ".") return null;
  if (language === "r" && start > 0 && /[$:@]/.test(before[start - 1])) return null;
  return {prefix:match[1], start, cursor};
}
function validItems(items, prefix, language) {
  const pattern = language === "python" ? PYTHON_NAME : language === "r" ? R_NAME : FLOW_NAME;
  return Array.isArray(items) && items.length <= MAX_ITEMS &&
    items.every(name => typeof name === "string" && pattern.test(name) && name.startsWith(prefix));
}
function create({source, button, target, language, python, r, generation, isBusy, notice, document}) {
  let requestId = 0;
  function clear() {
    requestId++;
    target.replaceChildren();
  }
  async function complete() {
    if (isBusy()) { notice("Wait for execution to finish."); return false; }
    const selected = language();
    const range = prefixAt(source, selected);
    if (!range) { clear(); notice("Place the cursor after a Flow, Python or R symbol prefix."); return false; }
    const snapshot = source.value, started = generation(), current = ++requestId;
    target.replaceChildren();
    try {
      const response = selected === "python" ?
        await python(range.prefix) : selected === "r" ? await r(range.prefix) :
        (range.receiver ? flowMembers(snapshot, range.cursor, range.receiver, range.prefix) :
          flowSymbols(snapshot, range.cursor, range.prefix));
      if (current !== requestId || started !== generation() || language() !== selected ||
          source.value !== snapshot || source.selectionStart !== range.cursor ||
          source.selectionEnd !== range.cursor) return false;
      if (!response || !response.ok) {
        notice("Completion unavailable: " + String(response?.output || "Unknown error").slice(0, 300));
        return false;
      }
      if (!validItems(response.items, range.prefix, selected)) {
        notice("Invalid completion response."); return false;
      }
      const matches = [...new Set(response.items)].sort().slice(0, MAX_ITEMS);
      if (!matches.length) { notice("No matching symbols."); return true; }
      const heading = document.createElement("p");
      heading.textContent = matches.length + " completion suggestions for " +
        (range.receiver ? range.receiver + "." + range.prefix : range.prefix);
      const list = document.createElement("div");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", "Completion suggestions");
      for (const name of matches) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.textContent = name;
        choice.setAttribute("aria-label", "Insert " + name);
        choice.addEventListener("click", () => {
          if (current !== requestId || started !== generation() || language() !== selected ||
              source.value !== snapshot || source.selectionStart !== range.cursor ||
              source.selectionEnd !== range.cursor) { clear(); return; }
          source.setRangeText(name, range.start, range.cursor, "end");
          source.dispatchEvent(new Event("input", {bubbles:true}));
          source.focus();
          clear();
          notice("Inserted " + name + ".");
        });
        list.append(choice);
      }
      target.replaceChildren(heading, list);
      notice("Choose a completion with Tab and Enter, or click a suggestion.");
      return true;
    } catch (error) {
      if (current === requestId && started === generation())
        notice("Completion failed: " + String(error).slice(0, 300));
      return false;
    }
  }
  button.addEventListener("click", () => { void complete(); });
  source.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
      event.preventDefault();
      void complete();
    } else if (event.key === "Escape") {
      clear();
    }
  });
  source.addEventListener("input", clear);
  return Object.freeze({complete, clear});
}
const api = Object.freeze({create, prefixAt, validItems, flowSymbols, flowMembers, maskFlow});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioCompletion = api;
})(globalThis);
