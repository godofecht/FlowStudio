/* Browser-local console history; the Flow backend remains responsible for execution. */
(function (root) {
"use strict";
const MAX_BYTES = 65536, MAX_HISTORY = 100;
const languages = ["flow", "r", "python"];
function create(submit, language, onError = () => {}) {
  if (typeof submit !== "function" || typeof language !== "function")
    throw new TypeError("submit and language callbacks are required");
  const history = Object.fromEntries(languages.map(name => [name, []]));
  const drafts = Object.fromEntries(languages.map(name => [name, ""]));
  const positions = Object.fromEntries(languages.map(name => [name, 0]));
  let busy = false;
  function entries(name) {
    if (!Object.hasOwn(history, name)) throw new RangeError("Unsupported runtime");
    return history[name];
  }
  async function run(input) {
    if (busy) return false;
    const name = language(), items = entries(name), code = input.value;
    if (!code.trim()) { onError("Console input is empty."); return false; }
    if (new TextEncoder().encode(code).length > MAX_BYTES) {
      onError("Console command exceeds 64 KiB."); return false;
    }
    busy = true;
    try {
      const accepted = await submit(name, code);
      if (accepted !== true) return false;
      if (items[items.length - 1] !== code) items.push(code);
      if (items.length > MAX_HISTORY) items.shift();
      positions[name] = items.length;
      drafts[name] = "";
      if (input.value === code) input.value = "";
      return true;
    } catch (error) {
      onError(String(error)); return false;
    } finally {
      busy = false;
    }
  }
  function navigate(input, direction) {
    const name = language(), items = entries(name);
    if (!items.length) return false;
    let index = positions[name];
    if (direction < 0) {
      if (index === 0) return false;
      if (index === items.length) drafts[name] = input.value;
      index--;
    } else {
      if (index >= items.length) return false;
      index++;
    }
    positions[name] = index;
    input.value = index === items.length ? drafts[name] : items[index];
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  }
  function keydown(event, input) {
    if (event.isComposing) return false;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      void run(input); return true;
    }
    if (event.key === "ArrowUp" && !event.ctrlKey && !event.metaKey &&
        !event.altKey && !event.shiftKey &&
        (input.selectionStart === 0 || !input.value.includes("\n"))) {
      if (navigate(input, -1)) { event.preventDefault(); return true; }
    }
    if (event.key === "ArrowDown" && !event.ctrlKey && !event.metaKey &&
        !event.altKey && !event.shiftKey &&
        (input.selectionStart === input.value.length || !input.value.includes("\n"))) {
      if (navigate(input, 1)) { event.preventDefault(); return true; }
    }
    return false;
  }
  return Object.freeze({run, navigate, keydown, isBusy: () => busy,
    history: name => Object.freeze([...entries(name)])});
}
const api = Object.freeze({create, MAX_BYTES, MAX_HISTORY});
root.FlowStudioConsole = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
