/* FlowStudio local-only recovery for unsaved editor buffers.
 * Never restores a filesystem handle or silently overwrites an opened file.
 */
(function (root) {
  "use strict";

  const KEY = "flowstudio.editor.draft.v1";
  const MAX_BYTES = 131072;
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const LANGUAGES = new Set(["flow", "r", "python"]);
  const encoder = new TextEncoder();

  function validDraft(value, now = Date.now()) {
    if (!value || value.version !== 1 || typeof value.code !== "string" ||
        !LANGUAGES.has(value.language) || typeof value.label !== "string" ||
        !Number.isFinite(value.savedAt) || value.savedAt > now + 60000 ||
        now - value.savedAt > MAX_AGE_MS ||
        encoder.encode(value.code).length > MAX_BYTES) return false;
    return true;
  }

  function createStore(storage, clock = Date.now) {
    function load() {
      try {
        const raw = storage.getItem(KEY);
        if (!raw || raw.length > MAX_BYTES * 2) return null;
        const parsed = JSON.parse(raw);
        return validDraft(parsed, clock()) ? parsed : null;
      } catch (_) { return null; }
    }
    function save(code, language, label) {
      if (typeof code !== "string" || !LANGUAGES.has(language) ||
          encoder.encode(code).length > MAX_BYTES) return false;
      const draft = {version: 1, code, language, label: String(label).slice(0, 256), savedAt: clock()};
      try { storage.setItem(KEY, JSON.stringify(draft)); return true; }
      catch (_) { return false; }
    }
    function clear() {
      try { storage.removeItem(KEY); return true; }
      catch (_) { return false; }
    }
    return Object.freeze({load, save, clear});
  }

  function mount(doc = document, storage = root.localStorage, scheduler = root) {
    const source = doc.getElementById("source");
    const language = doc.getElementById("language");
    const dirty = doc.getElementById("dirty");
    const label = doc.getElementById("fileLabel");
    const header = doc.querySelector("header");
    if (!source || !language || !dirty || !label || !header ||
        doc.getElementById("editorRecovery")) return null;
    const store = createStore(storage);
    const bar = doc.createElement("div");
    bar.id = "editorRecovery";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Unsaved editor recovery");
    const message = doc.createElement("span");
    message.setAttribute("role", "status");
    const restore = doc.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore draft";
    const discard = doc.createElement("button");
    discard.type = "button";
    discard.textContent = "Discard draft";
    bar.append(message, restore, discard);
    header.append(bar);

    let pending = store.load();
    let timer = null;
    let eligible = true;
    function show() {
      bar.hidden = !pending || !eligible;
      if (pending) message.textContent = "Unsaved local draft (" + pending.language + ")";
    }
    function flush() {
      timer = null;
      if (pending || dirty.hidden) return;
      store.save(source.value, language.value, label.textContent || "untitled");
    }
    function changed() {
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = scheduler.setTimeout(flush, 600);
    }
    function clearedByEditor() {
      if (!dirty.hidden) return;
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = null;
      if (!pending) store.clear();
    }
    restore.addEventListener("click", () => {
      if (!pending || !dirty.hidden || !eligible) return;
      let draft = pending;
      pending = null;
      // Auto-upgrade: a draft saved before the Reader removal holds Flow
      // source that no longer parses; refresh it from the curated gallery.
      const gallery = root.FlowStudioExamples;
      if (draft.language === "flow" && gallery &&
          typeof gallery.upgradeFiles === "function") {
        const fixed = gallery.upgradeFiles([{ name: draft.label || "buffer.flow",
          language: draft.language, text: draft.code }]);
        if (fixed) draft = { ...draft, code: fixed[0].text };
      }
      source.value = draft.code;
      language.value = draft.language;
      // No FileSystemFileHandle is restored: a subsequent Save As is required.
      label.textContent = "Recovered draft. Save as a new file.";
      source.dispatchEvent(new Event("input", {bubbles: true}));
      show();
      source.focus();
    });
    discard.addEventListener("click", () => {
      pending = null;
      store.clear();
      show();
    });
    source.addEventListener("input", changed);
    const observer = new MutationObserver(clearedByEditor);
    observer.observe(dirty, {attributes: true, attributeFilter: ["hidden"]});
    const labelObserver = new MutationObserver(() => { eligible = false; show(); });
    labelObserver.observe(label, {childList: true, subtree: true, characterData: true});
    if (scheduler.addEventListener) scheduler.addEventListener("pagehide", flush);
    show();
    return Object.freeze({flush, show, dispose() {
      if (timer !== null) scheduler.clearTimeout(timer);
      observer.disconnect();
      labelObserver.disconnect();
      if (scheduler.removeEventListener) scheduler.removeEventListener("pagehide", flush);
    }});
  }

  root.FlowStudioEditorRecovery = Object.freeze({KEY, MAX_BYTES, validDraft, createStore, mount});
  if (typeof module !== "undefined" && module.exports) module.exports = root.FlowStudioEditorRecovery;
  if (typeof document !== "undefined") {
    try { if (root.localStorage) mount(document, root.localStorage); } catch (_) { /* storage disabled */ }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
