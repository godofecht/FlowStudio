/* Browser-local notebook file controls. */
(function (global) {
"use strict";
function create(options) {
  const {openButton, fileInput, saveButton, source, language, format, parseCells,
    isBusy, canReplace, onImported, onExport, getResults, getFilename, notice} = options;
  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
    if (file.size > format.MAX_JSON_BYTES) { notice("Notebook exceeds 4 MiB."); return; }
    if (!canReplace()) return;
    try {
      const imported = format.decode(await file.text());
      await onImported(imported, file.name);
      notice("Notebook imported. Previous outputs and metadata were not loaded.");
    } catch (error) { notice("Notebook import failed: " + String(error.message || error)); }
  });
  saveButton.addEventListener("click", () => {
    if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
    try {
      const selected = language.value;
      const json = format.encode(source.value, selected, getResults(source.value, selected), parseCells);
      const name = getFilename().replace(/\.(?:py|r|flow|ipynb)$/i, "") + ".ipynb";
      onExport(json, name);
      notice("Notebook exported locally.");
    } catch (error) { notice("Notebook export failed: " + String(error.message || error)); }
  });
  return Object.freeze({});
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookIO = api;
})(globalThis);
