/* Loss-aware Jupyter nbformat 4.4 import/export for the browser's percent-cell editor.
 * Notebook JSON is data, never evaluated or inserted as HTML. No network requests.
 */
(function (global) {
"use strict";
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_CELLS = 256;
const MAX_CELL_BYTES = 65536;
const MAX_PNG_BASE64 = 1398104;
const MARKER = /^[ \t]*#[ \t]*%%(?:[ \t][^\r\n]*)?$/m;
const PNG = /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/;
const encoder = new TextEncoder();
const MAX_CELL_META = 2048;
function bytes(text) { return encoder.encode(text).length; }
function checkText(text, max, name) {
  if (typeof text !== "string" || bytes(text) > max) throw Error(name + " exceeds its supported size or is not text.");
  return text;
}
function languageOf(name) {
  const value = String(name || "").toLowerCase();
  if (value === "python" || value === "python3") return "python";
  if (value === "r") return "r";
  return null;
}
function sourceString(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(part => typeof part === "string")) return value.join("");
  throw Error("Notebook cell source must be a string or array of strings.");
}
/* Inert cell metadata: no execution, HTML rendering or dynamic imports. */
function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
function validTags(tags) {
  return Array.isArray(tags) && tags.length <= 32 && tags.every(tag => {
    if (typeof tag !== "string" || bytes(tag) > 80 || tag.includes("\0")) return false;
    try { encodeURIComponent(tag); return true; } catch (_) { return false; }
  });
}
function importMetadata(cell, state) {
  const meta = {};
  if (cell.id !== undefined) {
    if (validId(cell.id)) meta.id = cell.id;
    else state.ignoredMetadata = true;
  }
  if (cell.metadata !== undefined) {
    if (!cell.metadata || typeof cell.metadata !== "object" || Array.isArray(cell.metadata)) {
      state.ignoredMetadata = true;
    } else {
      if (Object.keys(cell.metadata).some(key => key !== "tags"))
        state.ignoredMetadata = true;
      if (cell.metadata.tags !== undefined) {
        if (validTags(cell.metadata.tags)) meta.tags = cell.metadata.tags;
        else state.ignoredMetadata = true;
      }
    }
  }
  if (cell.attachments !== undefined) state.ignoredMetadata = true;
  if (!Object.keys(meta).length) return "";
  let encoded = encodeURIComponent(JSON.stringify(meta));
  if (bytes(encoded) > MAX_CELL_META) {
    delete meta.tags;
    state.ignoredMetadata = true;
    if (!Object.keys(meta).length) return "";
    encoded = encodeURIComponent(JSON.stringify(meta));
  }
  return " meta=" + encoded;
}
function exportMetadata(marker) {
  const tokens = marker.match(/(?:^|\s)meta=/g);
  if (!tokens) return {};
  const match = /(?:^|\s)meta=([^\s\r\n]+)/.exec(marker);
  if (tokens.length !== 1 || !match || bytes(match[1]) > MAX_CELL_META)
    throw Error("Invalid Jupyter cell metadata marker.");
  let meta;
  try { meta = JSON.parse(decodeURIComponent(match[1])); }
  catch (_) { throw Error("Invalid Jupyter cell metadata marker."); }
  if (!meta || typeof meta !== "object" || Array.isArray(meta) ||
      !Object.keys(meta).length ||
      Object.keys(meta).some(key => key !== "id" && key !== "tags") ||
      (meta.id !== undefined && !validId(meta.id)) ||
      (meta.tags !== undefined && !validTags(meta.tags)))
    throw Error("Invalid Jupyter cell metadata marker.");
  return meta;
}

/* Import only inert text and PNG snapshots from untrusted Jupyter output.
 * HTML, JavaScript, SVG, widgets, metadata and execution state are never loaded.
 */
const MAX_IMPORT_RESULTS = 128;
const MAX_IMPORT_OUTPUTS = 64;
const MAX_IMPORT_PLOTS = 8;
const MAX_IMPORT_PNG = 524288;
const MAX_IMPORT_TEXT = 131072;
const MAX_IMPORT_TOTAL = 1048576;
function importOutputText(value, state, cell) {
  let raw;
  try { raw = sourceString(value); }
  catch (_) { state.ignored = true; return; }
  for (const character of raw) {
    const point = character.codePointAt(0);
    const length = point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4;
    if (cell.used + length > MAX_IMPORT_TEXT || state.used + length > MAX_IMPORT_TOTAL) {
      cell.truncated = true;
      state.ignored = true;
      return;
    }
    cell.output += character;
    cell.used += length;
    state.used += length;
  }
}
function importCellOutputs(cell, index, language, state) {
  if (cell.outputs === undefined || cell.outputs === null) return;
  if (!Array.isArray(cell.outputs)) { state.ignored = true; return; }
  if (!cell.outputs.length) return;
  state.hadOutputs = true;
  if (state.entries.length >= MAX_IMPORT_RESULTS) { state.ignored = true; return; }
  const result = {index, kind:"code", language, ok:true, output:"",
    truncated:false, plots:[], images:[], used:0};
  for (const item of cell.outputs.slice(0, MAX_IMPORT_OUTPUTS)) {
    if (!item || typeof item !== "object") { state.ignored = true; continue; }
    if (item.output_type === "stream" && ["stdout", "stderr"].includes(item.name)) {
      importOutputText(item.text, state, result);
    } else if (item.output_type === "error") {
      result.ok = false;
      const fallback = String(item.ename || "Error") + ": " + String(item.evalue || "");
      const traceback = Array.isArray(item.traceback) ? item.traceback : null;
      importOutputText(traceback && traceback.every(line => typeof line === "string")
        ? traceback.join("\n") : fallback, state, result);
    } else if (item.output_type === "execute_result" || item.output_type === "display_data") {
      if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) {
        state.ignored = true;
        continue;
      }
      if (Object.hasOwn(item.data, "text/plain"))
        importOutputText(item.data["text/plain"], state, result);
      if (Object.hasOwn(item.data, "image/png")) {
        let png;
        try { png = sourceString(item.data["image/png"]).replace(/\s/g, ""); }
        catch (_) { png = ""; }
        if (png.length <= MAX_IMPORT_PNG && PNG.test(png) &&
            result.plots.length < MAX_IMPORT_PLOTS) result.plots.push({png});
        else state.ignored = true;
      }
      if (Object.keys(item.data).some(key => key !== "text/plain" && key !== "image/png"))
        state.ignored = true;
    } else state.ignored = true;
  }
  if (cell.outputs.length > MAX_IMPORT_OUTPUTS) state.ignored = true;
  if (result.output || result.plots.length || !result.ok) {
    delete result.used;
    const preserved = safeJupyterOutputs(cell.outputs, result);
    if (preserved) result.jupyterOutputs = preserved;
    state.entries.push(result);
  }
}

/* Preserve only inert Jupyter output records that exactly match the bounded
 * display snapshot. No HTML, SVG, widgets, original execution counts or metadata.
 */
function safeJupyterOutputs(items, result) {
  if (!Array.isArray(items) || items.length > MAX_IMPORT_OUTPUTS ||
      !result || result.truncated || typeof result.output !== "string" ||
      !Array.isArray(result.plots) || typeof result.ok !== "boolean") return null;
  const safe = [], pngs = [];
  let text = "", failed = false;
  try {
    for (const item of items) {
      if (!item || typeof item !== "object") return null;
      if (item.output_type === "stream" && ["stdout", "stderr"].includes(item.name)) {
        const value = sourceString(item.text);
        text += value;
        safe.push({output_type:"stream", name:item.name, text:value});
      } else if (item.output_type === "error") {
        if (typeof item.ename !== "string" || typeof item.evalue !== "string" ||
            bytes(item.ename) > 256 || bytes(item.evalue) > 1024 ||
            !Array.isArray(item.traceback) || item.traceback.length > 64 ||
            !item.traceback.every(line => typeof line === "string" && bytes(line) <= 4096))
          return null;
        failed = true;
        text += item.traceback.join("\n");
        safe.push({output_type:"error", ename:item.ename, evalue:item.evalue,
          traceback:[...item.traceback]});
      } else if (item.output_type === "display_data" || item.output_type === "execute_result") {
        if (!item.data || typeof item.data !== "object" || Array.isArray(item.data) ||
            Object.keys(item.data).length === 0 ||
            Object.keys(item.data).some(key => key !== "text/plain" && key !== "image/png"))
          return null;
        const payload = {};
        if (Object.hasOwn(item.data, "text/plain")) {
          payload["text/plain"] = sourceString(item.data["text/plain"]);
          text += payload["text/plain"];
        }
        if (Object.hasOwn(item.data, "image/png")) {
          const png = sourceString(item.data["image/png"]).replace(/\s/g, "");
          if (png.length > MAX_IMPORT_PNG || !PNG.test(png)) return null;
          pngs.push(png);
          payload["image/png"] = png;
        }
        const output = {output_type:item.output_type, metadata:{}, data:payload};
        if (item.output_type === "execute_result") output.execution_count = null;
        safe.push(output);
      } else return null;
      if (bytes(text) > MAX_IMPORT_TEXT || pngs.length > MAX_IMPORT_PLOTS) return null;
    }
  } catch (_) { return null; }
  if (text !== result.output || failed !== !result.ok ||
      pngs.length !== result.plots.length ||
      pngs.some((png, index) => !result.plots[index] || result.plots[index].png !== png))
    return null;
  return safe;
}

function decode(json) {
  checkText(json, MAX_JSON_BYTES, "Notebook JSON");
  let notebook;
  try { notebook = JSON.parse(json); }
  catch (_) { throw Error("Notebook is not valid JSON."); }
  if (!notebook || notebook.nbformat !== 4 || !Array.isArray(notebook.cells) ||
      notebook.cells.length > MAX_CELLS) throw Error("Only Jupyter nbformat 4 notebooks with at most 256 cells are supported.");
  const language = languageOf(notebook.metadata?.language_info?.name || notebook.metadata?.kernelspec?.language);
  if (!language) throw Error("Only Python and R notebooks can be opened in the browser workspace.");
  let source = "";
  const imported = {entries:[], ignored:false, hadOutputs:false, used:0, ignoredMetadata:false};
  const seenIds = new Set();
  for (let index = 0; index < notebook.cells.length; index++) {
    const cell = notebook.cells[index];
    if (!cell || (cell.cell_type !== "code" && cell.cell_type !== "markdown"))
      throw Error("Unsupported notebook cell type at position " + (index + 1) + ".");
    const body = checkText(sourceString(cell.source), MAX_CELL_BYTES, "Notebook cell");
    if (body.includes("\0")) throw Error("Notebook cells cannot contain NUL bytes.");
    if (MARKER.test(body.replace(/\r\n?/g, "\n")))
      throw Error("Cell " + (index + 1) + " contains a percent-cell marker that cannot be represented without changing source.");
    const appendNewline = index + 1 < notebook.cells.length && body.length > 0 && !/[\r\n]$/.test(body);
    const label = cell.cell_type === "markdown" ? " [markdown]" : "";
    const metadata = importMetadata(cell, imported);
    if (validId(cell.id)) {
      if (seenIds.has(cell.id)) throw Error("Duplicate Jupyter cell ID: " + cell.id);
      seenIds.add(cell.id);
    }
    source += "# %%" + label + (appendNewline ? " [noeol]" : "") + metadata + "\n" + body + (appendNewline ? "\n" : "");
    if (bytes(source) > MAX_SOURCE_BYTES) throw Error("Notebook source exceeds the 2 MiB editor limit.");
    if (cell.cell_type === "code") importCellOutputs(cell, index, language, imported);
  }
  return {language, source, entries:imported.entries,
    ignoredOutputs:imported.ignored, hadOutputs:imported.hadOutputs,
    ignoredMetadata:imported.ignoredMetadata};
}
function encode(source, language, entries, parseCells) {
  if (!languageOf(language) || languageOf(language) !== language)
    throw Error("Notebook export supports Python and R only.");
  checkText(source, MAX_SOURCE_BYTES, "Editor source");
  if (typeof parseCells !== "function") throw TypeError("Source-cell parser is required.");
  const parsed = source ? parseCells(source) : [];
  if (!Array.isArray(parsed) || parsed.length > MAX_CELLS)
    throw Error("Notebook exceeds the 256-cell export limit.");
  if (parsed.some(cell => cell.kind === "code" && cell.language && cell.language !== language))
    throw Error("Mixed-language cells cannot be exported as a single-kernel .ipynb; save the source file instead.");
  const outputs = new Map();
  if (Array.isArray(entries)) for (const entry of entries) {
    if (entry && Number.isInteger(entry.index) && entry.index >= 0 && entry.index < parsed.length && entry.kind === "code")
      outputs.set(entry.index, entry);
  }
  const usedIds = new Set();
  let hasIds = false;
  const cells = parsed.map(cell => {
    if (!cell || !["code", "markdown"].includes(cell.kind) || typeof cell.code !== "string")
      throw Error("Invalid parsed notebook cell.");
    let body = cell.code;
    const marker = /^[ \t]*#[ \t]*%%[^\r\n]*(?:\r\n|\n|\r|$)/.exec(source.slice(cell.start))?.[0] || "";
    const meta = exportMetadata(marker);
    if (meta.id) {
      if (usedIds.has(meta.id)) throw Error("Duplicate Jupyter cell ID: " + meta.id);
      usedIds.add(meta.id);
      hasIds = true;
    }
    const cellMetadata = meta.tags === undefined ? {} : {tags:meta.tags};
    const cellId = meta.id ? {id:meta.id} : {};
    if (/\[noeol\]/i.test(marker)) {
      if (!body.endsWith("\n")) throw Error("Invalid no-EOL notebook cell marker.");
      body = body.slice(0, -1);
    }
    checkText(body, MAX_CELL_BYTES, "Notebook cell");
    if (cell.kind === "markdown") return {cell_type:"markdown", metadata:cellMetadata, source:body, ...cellId};
    const result = outputs.get(cell.index);
    const rendered = [];
    if (result && result.jupyterOutputs !== undefined) {
      const preserved = safeJupyterOutputs(result.jupyterOutputs, result);
      if (!preserved) throw Error("Saved Jupyter output records no longer match the displayed snapshot.");
      rendered.push(...preserved);
    } else {
      if (result && typeof result.output === "string" && result.output) {
        rendered.push({output_type:"stream", name:result.ok === false ? "stderr" : "stdout",
          text:checkText(result.output, 131072, "Cell output")});
      }
      if (result && Array.isArray(result.plots)) {
        for (const plot of result.plots.slice(0, 8)) {
          if (plot && typeof plot.png === "string" && plot.png.length <= MAX_PNG_BASE64 && PNG.test(plot.png))
            rendered.push({output_type:"display_data", metadata:{}, data:{"image/png":plot.png}});
        }
      }
    }
    return {cell_type:"code", metadata:cellMetadata, source:body,
      execution_count:null, outputs:rendered, ...cellId};
  });
  // Jupyter 4.5 requires unique IDs on every cell.
  if (hasIds) for (let index = 0; index < cells.length; index++) {
    if (cells[index].id) continue;
    const base = "flowstudio-" + (index + 1);
    let candidate = base, suffix = 1;
    while (usedIds.has(candidate)) candidate = base + "-" + suffix++;
    cells[index].id = candidate;
    usedIds.add(candidate);
  }
  const name = language === "r" ? "ir" : "python3";
  const notebook = {cells, metadata:{kernelspec:{display_name:language === "r" ? "R" : "Python 3",
    language, name}, language_info:{name:language}}, nbformat:4, nbformat_minor:hasIds ? 5 : 4};
  const json = JSON.stringify(notebook, null, 2) + "\n";
  checkText(json, MAX_JSON_BYTES, "Exported notebook");
  return json;
}

/* FlowStudio's portable, explicitly multi-kernel notebook format.
 * Unlike .ipynb, this stores exact percent-cell source and per-cell language
 * without claiming that Jupyter can execute Flow/R/Python in one kernel.
 * Results are display-only snapshots, never interpreter state.
 */
const BUNDLE_FORMAT = "flowstudio-notebook";
const MAX_BUNDLE_RESULTS = 128;
const MAX_BUNDLE_PNG = 524288;
function exactKeys(object, keys) {
  return object !== null && typeof object === "object" && !Array.isArray(object) &&
    Object.keys(object).length === keys.length &&
    Object.keys(object).every(key => keys.includes(key));
}
function bundleCells(source, parseCells) {
  if (typeof parseCells !== "function") throw TypeError("Source-cell parser is required.");
  const cells = parseCells(checkText(source, MAX_SOURCE_BYTES, "Notebook source"));
  if (!Array.isArray(cells) || cells.length > MAX_CELLS)
    throw Error("FlowStudio notebook exceeds the 256-cell limit.");
  for (const cell of cells) {
    if (!cell || !["code", "markdown"].includes(cell.kind) || typeof cell.code !== "string")
      throw Error("Invalid FlowStudio notebook source cell.");
    checkText(cell.code, MAX_CELL_BYTES, "Notebook cell");
  }
  return cells;
}
function bundleResults(entries, cells, language, strict) {
  if (!Array.isArray(entries) || entries.length > MAX_BUNDLE_RESULTS)
    throw Error("FlowStudio notebook exceeds the 128-result limit.");
  const results = [];
  let previous = -1;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" ||
        (strict && !exactKeys(entry, ["index", "language", "ok", "output", "truncated", "plots"])))
      throw Error("Invalid FlowStudio notebook result.");
    const index = entry.index;
    const cell = Number.isSafeInteger(index) && index >= 0 ? cells[index] : null;
    if (!cell || cell.kind !== "code" || index <= previous)
      throw Error("Notebook results must refer to unique, ascending code cells.");
    const selected = cell.language || language;
    if (entry.language !== undefined && entry.language !== selected)
      throw Error("Notebook result language does not match its source cell.");
    if (typeof entry.ok !== "boolean" || typeof entry.truncated !== "boolean" ||
        !Array.isArray(entry.plots) || entry.plots.length > 8)
      throw Error("Invalid FlowStudio notebook result metadata.");
    checkText(entry.output, 131072, "Notebook output");
    const plots = entry.plots.map(plot => {
      if (!plot || typeof plot.png !== "string" ||
          (strict && !exactKeys(plot, ["png"])) ||
          plot.png.length > MAX_BUNDLE_PNG || !PNG.test(plot.png))
        throw Error("Invalid or oversized notebook PNG.");
      return {png:plot.png};
    });
    results.push({index, language:selected, ok:entry.ok,
      output:entry.output, truncated:entry.truncated, plots});
    previous = index;
  }
  return results;
}
function encodeBundle(source, language, entries, parseCells) {
  if (!["flow", "python", "r"].includes(language))
    throw Error("Unsupported FlowStudio notebook default language.");
  const cells = bundleCells(source, parseCells);
  const results = bundleResults(entries, cells, language, false);
  const json = JSON.stringify({format:BUNDLE_FORMAT, version:1, language, source, results}, null, 2) + "\n";
  checkText(json, MAX_JSON_BYTES, "FlowStudio notebook");
  return json;
}
function decodeBundle(json, parseCells) {
  checkText(json, MAX_JSON_BYTES, "FlowStudio notebook");
  let data;
  try { data = JSON.parse(json); }
  catch (_) { throw Error("FlowStudio notebook is not valid JSON."); }
  if (!exactKeys(data, ["format", "version", "language", "source", "results"]) ||
      data.format !== BUNDLE_FORMAT || data.version !== 1 ||
      !["flow", "python", "r"].includes(data.language))
    throw Error("Not a supported FlowStudio notebook v1.");
  const cells = bundleCells(data.source, parseCells);
  const results = bundleResults(data.results, cells, data.language, true);
  return {language:data.language, source:data.source,
    entries:results.map(result => ({...result, kind:"code", images:[]}))};
}

const api = Object.freeze({decode, encode, encodeBundle, decodeBundle, safeJupyterOutputs, MAX_JSON_BYTES});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookFormat = api;
})(globalThis);
