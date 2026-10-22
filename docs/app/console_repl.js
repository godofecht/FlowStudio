/* Python console; uses the workspace's existing persistent worker. */
(function (global) {
"use strict";
function create({input, button, submit, notice}) {
  const history = [];
  let index = 0, draft = "", pending = false;
  async function execute() {
    if (pending) return false;
    const code = input.value;
    if (!code.trim()) { notice("Enter Python code."); return false; }
    if (new TextEncoder().encode(code).length > 65536) {
      notice("Console input exceeds 64 KiB."); return false;
    }
    pending = true; input.disabled = button.disabled = true;
    try {
      if (await submit(code) === false) return false;
      if (history.at(-1) !== code) history.push(code);
      if (history.length > 100) history.shift();
      index = history.length; draft = ""; input.value = "";
      return true;
    } catch (error) {
      notice("Console failed: " + String(error)); return false;
    } finally { pending = false; input.disabled = button.disabled = false; }
  }
  button.addEventListener("click", () => { void execute(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.altKey && (!event.shiftKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault(); void execute();
    } else if (event.key === "ArrowUp" && !event.altKey && !event.ctrlKey && !event.metaKey &&
      input.selectionStart === 0 && input.selectionEnd === 0 && index > 0) {
      event.preventDefault();
      if (index === history.length) draft = input.value;
      input.value = history[--index]; input.setSelectionRange(0, 0);
    } else if (event.key === "ArrowDown" && !event.altKey && !event.ctrlKey && !event.metaKey &&
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length && index < history.length) {
      event.preventDefault();
      input.value = ++index === history.length ? draft : history[index];
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
  return {execute};
}
const api = {create};
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioConsoleREPL = api;
})(globalThis);
