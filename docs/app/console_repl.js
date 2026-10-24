/* Browser console with independent Python/R/Flow input, drafts and bounded histories.
 * Execution is delegated to the workspace's existing language runtimes.
 */
(function (global) {
"use strict";
const LANGUAGES = ["python", "r", "flow"];
function create({input, button, submit, notice, languageSelect = null}) {
  const states = new Map(LANGUAGES.map(name => [name, {history:[], index:0, draft:""}]));
  let activeLanguage = languageSelect && LANGUAGES.includes(languageSelect.value) ? languageSelect.value : "python";
  let pending = false;
  function state() { return states.get(activeLanguage); }
  function updateInputLabel() {
    if (typeof input.setAttribute === "function")
      input.setAttribute("aria-label", activeLanguage + " console input");
    input.placeholder = activeLanguage === "flow" ? "Complete Flow program (native server required)" :
      activeLanguage === "r" ? "R expression or statement" : "Python expression or statement";
  }
  function changeLanguage() {
    if (!languageSelect) return;
    const next = languageSelect.value;
    if (pending || !LANGUAGES.includes(next)) {
      languageSelect.value = activeLanguage;
      return;
    }
    if (next === activeLanguage) return;
    state().draft = input.value;
    activeLanguage = next;
    const target = state();
    target.index = target.history.length;
    input.value = target.draft;
    updateInputLabel();
  }
  if (languageSelect) languageSelect.addEventListener("change", changeLanguage);
  updateInputLabel();
  async function execute() {
    if (pending) return false;
    const code = input.value;
    const language = activeLanguage;
    if (!code.trim()) { notice("Enter " + language + " code."); return false; }
    if (new TextEncoder().encode(code).length > 65536) {
      notice("Console input exceeds 64 KiB."); return false;
    }
    pending = true;
    input.disabled = button.disabled = true;
    if (languageSelect) languageSelect.disabled = true;
    try {
      if (await submit(code, language) === false) return false;
      const current = states.get(language);
      if (current.history.at(-1) !== code) current.history.push(code);
      if (current.history.length > 100) current.history.shift();
      current.index = current.history.length;
      current.draft = "";
      input.value = "";
      return true;
    } catch (error) {
      notice("Console failed: " + String(error)); return false;
    } finally {
      pending = false;
      input.disabled = button.disabled = false;
      if (languageSelect) languageSelect.disabled = false;
    }
  }
  button.addEventListener("click", () => { void execute(); });
  input.addEventListener("keydown", event => {
    const current = state();
    if (event.key === "Enter" && !event.altKey && (!event.shiftKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault(); void execute();
    } else if (event.key === "ArrowUp" && !event.altKey && !event.ctrlKey && !event.metaKey &&
      input.selectionStart === 0 && input.selectionEnd === 0 && current.index > 0) {
      event.preventDefault();
      if (current.index === current.history.length) current.draft = input.value;
      input.value = current.history[--current.index]; input.setSelectionRange(0, 0);
    } else if (event.key === "ArrowDown" && !event.altKey && !event.ctrlKey && !event.metaKey &&
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length &&
      current.index < current.history.length) {
      event.preventDefault();
      input.value = ++current.index === current.history.length ? current.draft : current.history[current.index];
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  return {execute, getLanguage:() => activeLanguage};
}
const api = {create};
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioConsoleREPL = api;
})(globalThis);
