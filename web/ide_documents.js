/* FlowStudio open-document model.
 * Pure state: no DOM, no filesystem, no network. The editor view renders it.
 */
(function (global) {
"use strict";
const MAX_DOCUMENTS = 24;
const MAX_NAME = 256;
const LANGUAGES = Object.freeze(["flow", "r", "python"]);

function label(doc) {
  if (!doc) return "";
  return doc.path || doc.name;
}

function createModel(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? Math.min(options.limit, MAX_DOCUMENTS) : MAX_DOCUMENTS;
  const items = [];
  let activeId = null;
  let sequence = 0;

  function find(id) {
    return items.find(item => item.id === id) || null;
  }
  function list() {
    return items.slice();
  }
  function active() {
    return find(activeId);
  }
  function count() {
    return items.length;
  }
  function normalizeLanguage(value) {
    return LANGUAGES.includes(value) ? value : "flow";
  }
  function sameDocument(doc, spec) {
    if (typeof spec.path === "string" && spec.path && doc.path === spec.path) return true;
    return Boolean(spec.handle) && doc.handle === spec.handle;
  }
  function open(spec) {
    if (!spec || typeof spec.name !== "string" || !spec.name || spec.name.length > MAX_NAME)
      throw new TypeError("A document needs a name of 1–256 characters.");
    if (typeof spec.text !== "string")
      throw new TypeError("A document needs string content.");
    const existing = items.find(doc => sameDocument(doc, spec));
    if (existing) {
      activeId = existing.id;
      return { document: existing, created: false };
    }
    if (items.length >= limit)
      throw new RangeError("Close a document before opening more than " + limit + ".");
    const document_ = {
      id: "doc-" + (++sequence),
      name: spec.name,
      path: typeof spec.path === "string" && spec.path ? spec.path : null,
      language: normalizeLanguage(spec.language),
      text: spec.text,
      saved: typeof spec.baseline === "string" ? spec.baseline : spec.text,
      handle: spec.handle || null,
      dirty: false
    };
    items.push(document_);
    activeId = document_.id;
    return { document: document_, created: true };
  }
  function activate(id) {
    const doc = find(id);
    if (!doc) return null;
    activeId = doc.id;
    return doc;
  }
  function setText(id, text) {
    const doc = find(id);
    if (!doc || typeof text !== "string") return false;
    doc.text = text;
    doc.dirty = text !== doc.saved;
    return true;
  }
  function setDirty(id, isDirty) {
    const doc = find(id);
    if (!doc) return false;
    doc.dirty = Boolean(isDirty);
    return true;
  }
  function markSaved(id, text = null) {
    const doc = find(id);
    if (!doc) return null;
    if (typeof text === "string") doc.text = text;
    doc.saved = doc.text;
    doc.dirty = false;
    return doc;
  }
  function rename(id, name, path = null) {
    const doc = find(id);
    if (!doc) return null;
    if (typeof name === "string" && name && name.length <= MAX_NAME) doc.name = name;
    if (path === null || (typeof path === "string" && path)) doc.path = path;
    return doc;
  }
  function setLanguage(id, language) {
    const doc = find(id);
    if (!doc) return null;
    doc.language = normalizeLanguage(language);
    return doc;
  }
  function close(id) {
    const index = items.findIndex(item => item.id === id);
    if (index < 0) return null;
    const [closed] = items.splice(index, 1);
    if (closed.id === activeId) {
      const neighbour = items[index] || items[index - 1] || null;
      activeId = neighbour ? neighbour.id : null;
    }
    return { document: closed, activeId };
  }
  return Object.freeze({
    open, activate, active, find, list, count, close,
    setText, setDirty, markSaved, rename, setLanguage,
    limit: () => limit
  });
}

const api = Object.freeze({ createModel, label, MAX_DOCUMENTS, MAX_NAME, LANGUAGES });
global.FlowStudioDocuments = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
