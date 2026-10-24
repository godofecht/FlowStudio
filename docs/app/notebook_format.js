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
    source += "# %%" + label + (appendNewline ? " [noeol]" : "") + "\n" + body + (appendNewline ? "\n" : "");
    if (bytes(source) > MAX_SOURCE_BYTES) throw Error("Notebook source exceeds the 2 MiB editor limit.");
  }
  return {language, source, ignoredOutputs: notebook.cells.some(cell => Array.isArray(cell.outputs) && cell.outputs.length > 0)};
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
  const cells = parsed.map(cell => {
    if (!cell || !["code", "markdown"].includes(cell.kind) || typeof cell.code !== "string")
      throw Error("Invalid parsed notebook cell.");
    let body = cell.code;
    const marker = /^[ \t]*#[ \t]*%%[^\r\n]*(?:\r\n|\n|\r|$)/.exec(source.slice(cell.start))?.[0] || "";
    if (/\[noeol\]/i.test(marker)) {
      if (!body.endsWith("\n")) throw Error("Invalid no-EOL notebook cell marker.");
      body = body.slice(0, -1);
    }
    checkText(body, MAX_CELL_BYTES, "Notebook cell");
    if (cell.kind === "markdown") return {cell_type:"markdown", metadata:{}, source:body};
    const result = outputs.get(cell.index);
    const rendered = [];
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
    return {cell_type:"code", metadata:{}, source:body,
      execution_count:result && result.ok ? 1 : null, outputs:rendered};
  });
  const name = language === "r" ? "ir" : "python3";
  const notebook = {cells, metadata:{kernelspec:{display_name:language === "r" ? "R" : "Python 3",
    language, name}, language_info:{name:language}}, nbformat:4, nbformat_minor:4};
  const json = JSON.stringify(notebook, null, 2) + "\n";
  checkText(json, MAX_JSON_BYTES, "Exported notebook");
  return json;
}
const api = Object.freeze({decode, encode, MAX_JSON_BYTES});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookFormat = api;
})(globalThis);
