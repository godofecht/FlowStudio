"use strict";
/* Local source import and Jupyter notebook download. No server upload or execution. */
const el = id => document.getElementById(id);
let sourceFilename = "untitled.py";

async function importSource(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error("Source file exceeds 2 MiB.");
  const notebookFile = /\.ipynb$/i.test(file.name);
  const lang = /\.py$/i.test(file.name) ? "python" : /\.r$/i.test(file.name) ? "r" : null;
  if (!notebookFile && !lang)
    throw new Error("Only Python .py, R .R and Jupyter .ipynb files can be imported.");
  const text = await file.text();
  const converted = notebookFile ? FlowStudioNotebookImport.importNotebook(text) : null;
  const source = converted ? converted.source : text;
  FlowStudioSourceCells.parseCells(source);
  el("source").value = source;
  el("language").value = converted ? converted.language : lang;
  sourceFilename = notebookFile ?
    file.name.replace(/\.ipynb$/i, converted.language === "r" ? ".R" : ".py") : file.name;
  el("status").textContent = converted ?
    "Imported " + converted.cells + " notebook cells from " + file.name +
      " (discarded " + converted.discardedOutputs + " saved outputs)." :
    "Loaded " + file.name;
}

function exportNotebook() {
  try {
    const notebook = FlowStudioNotebookExport.buildNotebook(el("source").value, el("language").value);
    const blob = new Blob([JSON.stringify(notebook, null, 2) + "\n"], {type: "application/x-ipynb+json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = FlowStudioNotebookExport.exportFilename(sourceFilename);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    el("status").textContent = "Exported " + link.download + "; source only, without outputs.";
  } catch (error) {
    el("status").textContent = error.message || String(error);
  }
}

el("importFile").addEventListener("change", async event => {
  try { await importSource(event.target.files[0]); }
  catch (error) { el("status").textContent = error.message || String(error); }
  finally { event.target.value = ""; }
});
el("export").addEventListener("click", exportNotebook);
