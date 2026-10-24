/* Browser-only runtime symbol completion. No expression evaluation or network requests. */
(function (global) {
"use strict";
const PYTHON_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const R_NAME = /^[A-Za-z.][A-Za-z0-9._]{0,79}$/;
const MAX_ITEMS = 64;
function prefixAt(source, language) {
  if (!source || typeof source.value !== "string" ||
      !Number.isSafeInteger(source.selectionStart) ||
      source.selectionStart !== source.selectionEnd) return null;
  const cursor = source.selectionStart;
  if (cursor < 0 || cursor > source.value.length) return null;
  const before = source.value.slice(0, cursor);
  const match = before.match(language === "python" ?
    /([A-Za-z_][A-Za-z0-9_]{0,79})$/ :
    language === "r" ? /([A-Za-z.][A-Za-z0-9._]{0,79})$/ : /$^/);
  if (!match) return null;
  const start = cursor - match[1].length;
  // Attribute, namespace and member completion require a different protocol.
  if (language === "python" && start > 0 && before[start - 1] === ".") return null;
  if (language === "r" && start > 0 && /[$:@]/.test(before[start - 1])) return null;
  return {prefix:match[1], start, cursor};
}
function validItems(items, prefix, language) {
  const pattern = language === "python" ? PYTHON_NAME : R_NAME;
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
    if (!range) { clear(); notice("Place the cursor after a Python or R symbol prefix."); return false; }
    const snapshot = source.value, started = generation(), current = ++requestId;
    target.replaceChildren();
    try {
      const response = selected === "python" ?
        await python(range.prefix) : await r(range.prefix);
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
const api = Object.freeze({create, prefixAt, validItems});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioCompletion = api;
})(globalThis);
