/* Browser-local export of percent-delimited Python/R source as Jupyter Notebook v4. */
(function (global) {
"use strict";

function markdownSource(source) {
  return source.split(/\r?\n/).map(line => {
    const match = /^[ \t]*#(?: ?)(.*)$/.exec(line);
    return match ? match[1] : line;
  }).join("\n");
}

function buildNotebook(source, language) {
  if (language !== "python" && language !== "r")
    throw new Error("Notebook export supports Python and R; a Flow Jupyter kernel is not available.");
  if (!global.FlowStudioSourceCells || typeof global.FlowStudioSourceCells.parseCells !== "function")
    throw new Error("Source cell parser is unavailable.");
  const cells = global.FlowStudioSourceCells.parseCells(source).map(cell => {
    if (cell.kind === "markdown")
      return { cell_type: "markdown", id: "cell-" + (cell.index + 1), metadata: {}, source: markdownSource(cell.code) };
    return { cell_type: "code", id: "cell-" + (cell.index + 1), execution_count: null, metadata: {}, outputs: [], source: cell.code };
  });
  const kernelspec = language === "python" ? { display_name: "Python 3", language: "python", name: "python3" } :
    { display_name: "R", language: "R", name: "ir" };
  return { cells, metadata: { kernelspec, language_info: { name: language } }, nbformat: 4, nbformat_minor: 5 };
}

function exportFilename(name) {
  if (typeof name !== "string") throw new TypeError("Filename must be a string.");
  const leaf = name.split(/[\\/]/).pop().replace(/\.(?:py|r)$/i, "");
  const safe = leaf.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100).replace(/^\.+$/, "");
  return (safe || "notebook") + ".ipynb";
}

const api = { buildNotebook, exportFilename, markdownSource };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookExport = api;
})(globalThis);
