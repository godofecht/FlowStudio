/* Strict, browser-local Jupyter v4 notebook to percent-source conversion. */
(function (global) {
"use strict";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CELLS = 1000;
const BOUNDARY = /^[ \t]*#[ \t]*%%(?:[ \t][^\r\n]*)?\r?$/m;
function languageOf(metadata) {
  const kernel = metadata && metadata.kernelspec || {};
  const info = metadata && metadata.language_info || {};
  const hints = [kernel.language, info.name, kernel.name]
    .filter(value => typeof value === "string" && value.trim())
    .map(value => value.trim().toLowerCase());
  if (!hints.length) throw new Error("Notebook kernel language is missing.");
  const classify = value => value === "r" || value === "ir" || value === "irkernel" ? "r" :
    value === "python" || /^python[0-9.]*$/.test(value) ? "python" : null;
  const languages = hints.map(classify);
  if (languages.some(value => value === null) || new Set(languages).size !== 1)
    throw new Error("Only unambiguous Python and R notebook kernels are supported.");
  return languages[0];
}
function cellText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(part => typeof part === "string"))
    return value.join("");
  throw new Error("Notebook cell source must be text or an array of text lines.");
}
function markdownToComments(text) {
  return text.split("\n").map(line => {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    return clean ? "# " + clean : "#";
  }).join("\n");
}
function importNotebook(raw) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_BYTES)
    throw new Error("Notebook exceeds the 2 MiB import limit.");
  let notebook;
  try { notebook = JSON.parse(raw); }
  catch (_) { throw new Error("Invalid notebook JSON."); }
  if (!notebook || typeof notebook !== "object" || Array.isArray(notebook) ||
      notebook.nbformat !== 4 || !Array.isArray(notebook.cells))
    throw new Error("A Jupyter v4 notebook is required.");
  if (notebook.cells.length === 0)
    throw new Error("Notebook has no cells to import.");
  if (notebook.cells.length > MAX_CELLS)
    throw new Error("Notebook exceeds the 1000-cell limit.");
  const language = languageOf(notebook.metadata);
  const parts = [];
  let discardedOutputs = 0;
  for (let index = 0; index < notebook.cells.length; index++) {
    const cell = notebook.cells[index];
    if (!cell || (cell.cell_type !== "code" && cell.cell_type !== "markdown"))
      throw new Error("Unsupported notebook cell type at index " + index + ".");
    const body = cellText(cell.source);
    if (cell.cell_type === "code" && BOUNDARY.test(body))
      throw new Error("Code cell " + (index + 1) + " contains a # %% boundary; conversion would change cell structure.");
    if (cell.cell_type === "code" && Array.isArray(cell.outputs))
      discardedOutputs += cell.outputs.length;
    const prefix = cell.cell_type === "markdown" ? "# %% [markdown]\n" : "# %%\n";
    parts.push(prefix + (cell.cell_type === "markdown" ? markdownToComments(body) : body));
  }
  const source = parts.map((part, index) => index + 1 < parts.length && !part.endsWith("\n") ? part + "\n" : part).join("");
  if (new TextEncoder().encode(source).length > MAX_BYTES)
    throw new Error("Converted source exceeds the 2 MiB limit.");
  return { source, language, cells: notebook.cells.length, discardedOutputs };
}
const api = Object.freeze({ importNotebook, languageOf, markdownToComments });
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookImport = api;
})(globalThis);
