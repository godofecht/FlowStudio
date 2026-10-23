/* Browser-local source recovery. No source is sent to a server. */
(function (global) {
"use strict";
const KEY = "flowstudio.browser.draft.v1";
const MAX_SOURCE = 2 * 1024 * 1024;
const LANGUAGES = new Set(["python", "flow", "r"]);

function valid(draft) {
  return draft && typeof draft === "object" && draft.version === 1 &&
    typeof draft.source === "string" && draft.source.length <= MAX_SOURCE &&
    typeof draft.filename === "string" && draft.filename.length > 0 &&
    draft.filename.length <= 256 && !/[\\/\0]/.test(draft.filename) &&
    LANGUAGES.has(draft.language);
}
function read(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > MAX_SOURCE * 2 + 2048) return null;
    const draft = JSON.parse(raw);
    return valid(draft) ? draft : null;
  } catch (_) { return null; }
}
function save(storage, source, filename, language) {
  const draft = {version:1, source, filename, language};
  if (!valid(draft)) return false;
  try { storage.setItem(KEY, JSON.stringify(draft)); return true; }
  catch (_) { return false; }
}
function clear(storage) {
  try { storage.removeItem(KEY); return true; }
  catch (_) { return false; }
}
function create(storage, delay, onFailure) {
  let timer = null, latest = null;
  function flush() {
    if (timer !== null) { global.clearTimeout(timer); timer = null; }
    if (!latest) return false;
    const [source, filename, language] = latest;
    latest = null;
    const ok = save(storage, source, filename, language);
    if (!ok && onFailure) onFailure();
    return ok;
  }
  function queue(source, filename, language) {
    latest = [source, filename, language];
    if (timer !== null) global.clearTimeout(timer);
    timer = global.setTimeout(flush, delay);
  }
  return {read: () => read(storage), queue, flush, clear: () => {
    if (timer !== null) global.clearTimeout(timer);
    timer = null; latest = null;
    return clear(storage);
  }};
}
global.FlowStudioDraftStorage = {KEY, MAX_SOURCE, read, save, clear, create};
})(typeof window !== "undefined" ? window : globalThis);
