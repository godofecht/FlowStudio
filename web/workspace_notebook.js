/* Export the current unsaved Python/R editor buffer as a local Jupyter notebook. */
(function (root) {
  "use strict";

  function mount(doc = document, exporter = root.FlowStudioNotebookExport,
                 urlApi = URL, scheduler = setTimeout) {
    const button = doc.getElementById("exportNotebook");
    const source = doc.getElementById("source");
    const language = doc.getElementById("language");
    const filename = doc.getElementById("fileLabel");
    const status = doc.getElementById("resultStatus");
    if (!button || !source || !language || !filename || !status ||
        !exporter || typeof exporter.buildNotebook !== "function" ||
        typeof exporter.exportFilename !== "function") return null;

    function message(text, state) {
      status.textContent = text;
      status.dataset.state = state;
    }

    function exportCurrent() {
      let url = null;
      try {
        if (language.value !== "python" && language.value !== "r")
          throw new Error("Notebook export supports Python and R only.");
        if (!source.value.trim()) throw new Error("Nothing to export from the editor.");
        const notebook = exporter.buildNotebook(source.value, language.value);
        const name = exporter.exportFilename(filename.textContent);
        const blob = new Blob([JSON.stringify(notebook, null, 2) + "\n"],
          { type: "application/x-ipynb+json" });
        url = urlApi.createObjectURL(blob);
        const link = doc.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        const completedUrl = url;
        url = null;
        scheduler(() => urlApi.revokeObjectURL(completedUrl), 1000);
        message("Exported " + name + " from the current editor buffer (without outputs).", "ok");
        return true;
      } catch (error) {
        if (url !== null) urlApi.revokeObjectURL(url);
        message(error.message || String(error), "error");
        return false;
      }
    }

    button.addEventListener("click", exportCurrent);
    return Object.freeze({ exportCurrent });
  }

  const api = Object.freeze({ mount });
  root.FlowStudioWorkspaceNotebook = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined" && document.getElementById("exportNotebook"))
    mount(document);
})(globalThis);
