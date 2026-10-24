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
    if (cursor <= end && (!active || open > active.open)) active = {open, parameters:match[1]};
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

function prefixAt(source, language) {
  if (!source || typeof source.value !== "string" ||
      !Number.isSafeInteger(source.selectionStart) ||
      source.selectionStart !== source.selectionEnd) return null;
  const cursor = source.selectionStart;
  if (cursor < 0 || cursor > source.value.length) return null;
  const before = source.value.slice(0, cursor);
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
        flowSymbols(snapshot, range.cursor, range.prefix);
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
      heading.textContent = matches.length + " completion suggestions for " + range.prefix;
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
const api = Object.freeze({create, prefixAt, validItems, flowSymbols, maskFlow});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioCompletion = api;
})(globalThis);
