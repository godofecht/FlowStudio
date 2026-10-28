/* Browser-local console history; the Flow backend remains responsible for execution. */
(function (root) {
"use strict";
const MAX_BYTES = 65536, MAX_HISTORY = 100, MAX_STORED_BYTES = 262144;
const STORAGE_PREFIX = "flowstudio.console.history.v1.";
const STORAGE_ENABLED = STORAGE_PREFIX + "enabled";
const languages = ["flow", "r", "python"];
function create(submit, language, onError = () => {}, options = {}) {
  if (typeof submit !== "function" || typeof language !== "function")
    throw new TypeError("submit and language callbacks are required");
  const history = Object.fromEntries(languages.map(name => [name, []]));
  const drafts = Object.fromEntries(languages.map(name => [name, ""]));
  const positions = Object.fromEntries(languages.map(name => [name, 0]));
  const storage = options.storage || null;
  // The prompt DOM node is shared by runtime tabs. Capture its scope before
  // awaiting execution so a late response cannot erase another tab's draft.
  const inputScope = typeof options.inputScope === "function" ?
    options.inputScope : null;
  let busy = false, persisting = false;
  function entries(name) {
    if (!Object.hasOwn(history, name)) throw new RangeError("Unsupported runtime");
    return history[name];
  }
  function storageKey(name) { return STORAGE_PREFIX + name; }
  function reportStorage(error) {
    onError("Console history could not be saved on this device: " + String(error));
  }
  function readHistory(name) {
    try {
      const raw = storage.getItem(storageKey(name));
      if (raw === null) return;
      if (new TextEncoder().encode(raw).length > MAX_STORED_BYTES) throw new Error("Stored history is oversized");
      const values = JSON.parse(raw);
      if (!Array.isArray(values) || values.length > MAX_HISTORY ||
          values.some(value => typeof value !== "string" ||
            new TextEncoder().encode(value).length > MAX_BYTES))
        throw new Error("Invalid stored history");
      history[name].push(...values);
      positions[name] = values.length;
    } catch (_) {
      // Corrupt or stale storage must never prevent the editor from starting.
      try { storage.removeItem(storageKey(name)); } catch (_) {}
    }
  }
  if (storage) {
    try {
      persisting = storage.getItem(STORAGE_ENABLED) === "1";
      if (persisting) for (const name of languages) readHistory(name);
    } catch (_) { persisting = false; }
  }
  function store(name) {
    if (!persisting || !storage) return true;
    const values = [...entries(name)];
    let raw = JSON.stringify(values);
    while (new TextEncoder().encode(raw).length > MAX_STORED_BYTES && values.length > 0) {
      values.shift();
      raw = JSON.stringify(values);
    }
    try { storage.setItem(storageKey(name), raw); return true; }
    catch (error) {
      reportStorage(error);
      persisting = false;
      try { storage.removeItem(STORAGE_ENABLED); } catch (_) {}
      return false;
    }
  }
  function setPersistence(enabled) {
    if (enabled) {
      if (!storage) { onError("Persistent history is unavailable in this browser."); return false; }
      try {
        storage.setItem(STORAGE_ENABLED, "1");
        persisting = true;
        if (languages.every(store)) return true;
      } catch (error) { reportStorage(error); }
      persisting = false;
      try { storage.removeItem(STORAGE_ENABLED); } catch (_) {}
      return false;
    }
    persisting = false;
    if (!storage) return true;
    try {
      storage.removeItem(STORAGE_ENABLED);
      for (const name of languages) storage.removeItem(storageKey(name));
      return true;
    } catch (error) { reportStorage(error); return false; }
  }
  function clearHistory(name) {
    const items = entries(name);
    items.length = 0;
    drafts[name] = "";
    positions[name] = 0;
    if (storage) {
      try { storage.removeItem(storageKey(name)); }
      catch (error) { reportStorage(error); return false; }
    }
    return true;
  }
  async function run(input) {
    if (busy) return false;
    const name = language(), items = entries(name), code = input.value;
    const scopeAtSubmit = inputScope ? inputScope() : null;
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
      store(name);
      if ((!inputScope || Object.is(scopeAtSubmit, inputScope())) &&
          input.value === code) input.value = "";
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
  return Object.freeze({run, navigate, keydown, setPersistence, clearHistory,
    isPersisting: () => persisting, isBusy: () => busy,
    history: name => Object.freeze([...entries(name)])});
}
const api = Object.freeze({create, MAX_BYTES, MAX_HISTORY, MAX_STORED_BYTES,
  STORAGE_PREFIX, STORAGE_ENABLED});
root.FlowStudioConsole = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
