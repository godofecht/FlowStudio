/* Bounded browser-local recovery of completed notebook cell outputs.
 * Recovery never resumes interpreter state or re-executes code.
 */
(function (global) {
"use strict";
const KEY = "flowstudio.browser.notebook.outputs.v1";
const MAX_RECORD_BYTES = 1048576;
const MAX_SOURCE_BYTES = 131072;
const MAX_ENTRIES = 128;
const MAX_OUTPUT = 131072;
const MAX_PLOTS = 4;
const MAX_PNG = 524288;
const PNG = /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
const encoder = new TextEncoder();
// Share the import/export validator; never persist unverified Jupyter records.
const format = global.FlowStudioNotebookFormat ||
  (typeof require === "function" ? require("./notebook_format.js") : null);

function normalise(source, language, entries) {
  if (typeof source !== "string" || encoder.encode(source).length > MAX_SOURCE_BYTES ||
      !["python", "r", "flow"].includes(language) || !Array.isArray(entries) || entries.length > MAX_ENTRIES)
    return null;
  let lastIndex = -1;
  const safe = [];
  for (const entry of entries) {
    if (!entry || entry.kind !== "code" || !Number.isSafeInteger(entry.index) ||
        entry.index <= lastIndex || entry.index > 4096 || typeof entry.ok !== "boolean" ||
        typeof entry.output !== "string" || encoder.encode(entry.output).length > MAX_OUTPUT ||
        typeof entry.truncated !== "boolean" || !Array.isArray(entry.plots) ||
        entry.plots.length > MAX_PLOTS) return null;
    const plots = [];
    for (const plot of entry.plots) {
      if (!plot || typeof plot.png !== "string" || plot.png.length > MAX_PNG ||
          !PNG.test(plot.png)) return null;
      plots.push({png:plot.png});
    }
    const saved = {index:entry.index, kind:"code", ok:entry.ok,
      output:entry.output, truncated:entry.truncated, plots};
    if (entry.jupyterOutputs !== undefined) {
      if (!format || typeof format.safeJupyterOutputs !== "function") return null;
      const canonical = format.safeJupyterOutputs(entry.jupyterOutputs, {...entry, plots});
      if (!canonical) return null;
      // The validator deliberately drops unsupported metadata. Recovery must
      // reject such records rather than silently claiming lossless persistence.
      try {
        if (JSON.stringify(canonical) !== JSON.stringify(entry.jupyterOutputs)) return null;
      } catch (_) { return null; }
      saved.jupyterOutputs = canonical;
    }
    safe.push(saved);
    lastIndex = entry.index;
  }
  const record = {version:1, source, language, entries:safe};
  return encoder.encode(JSON.stringify(record)).length <= MAX_RECORD_BYTES ? record : null;
}
function save(storage, source, language, entries) {
  if (!storage) return false;
  try {
    const record = normalise(source, language, entries);
    if (!record) return false;
    storage.setItem(KEY, JSON.stringify(record));
    return true;
  } catch (_) { return false; }
}
function read(storage, source, language) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > MAX_RECORD_BYTES) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || parsed.source !== source ||
        parsed.language !== language) return null;
    const valid = normalise(parsed.source, parsed.language, parsed.entries);
    if (!valid || JSON.stringify(valid) !== raw) return null;
    return valid.entries;
  } catch (_) { return null; }
}
function clear(storage) {
  try { storage?.removeItem(KEY); return true; }
  catch (_) { return false; }
}
const api = Object.freeze({KEY, normalise, save, read, clear});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookRecovery = api;
})(globalThis);
