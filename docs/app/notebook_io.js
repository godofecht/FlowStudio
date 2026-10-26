/* Browser-local notebook file controls. */
(function (global) {
"use strict";
function create(options) {
  const {openButton, fileInput, saveButton, source, language, format, parseCells,
    isBusy, canReplace, onImported, onExport, getResults, getFilename, notice,
    bundleOpenButton, bundleFileInput, bundleSaveButton,
    rMarkdownOpenButton, rMarkdownFileInput, rMarkdown} = options;
  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
    if (file.size > format.MAX_JSON_BYTES) { notice("Notebook exceeds 4 MiB."); return; }
    try {
      const json = await file.text();
      if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
      const imported = format.decode(json);
      if (!canReplace()) return;
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
  if (bundleOpenButton && bundleFileInput && bundleSaveButton) {
    bundleOpenButton.addEventListener("click", () => bundleFileInput.click());
    bundleFileInput.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
      if (file.size > format.MAX_JSON_BYTES) { notice("FlowStudio notebook exceeds 4 MiB."); return; }
      try {
        const json = await file.text();
        if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
        const imported = format.decodeBundle(json, parseCells);
        if (!canReplace()) return;
        await onImported(imported, file.name);
        notice("FlowStudio notebook imported with saved outputs; interpreter state was not restored.");
      } catch (error) {
        notice("FlowStudio notebook import failed: " + String(error.message || error));
      }
    });
    bundleSaveButton.addEventListener("click", () => {
      if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
      try {
        const selected = language.value;
        const json = format.encodeBundle(source.value, selected,
          getResults(source.value, selected), parseCells);
        const name = getFilename().replace(/\.(?:py|r|flow|ipynb|fsnb)$/i, "") + ".fsnb";
        onExport(json, name);
        notice("Portable FlowStudio notebook exported locally.");
      } catch (error) {
        notice("FlowStudio notebook export failed: " + String(error.message || error));
      }
    });
  }
  if (rMarkdownOpenButton && rMarkdownFileInput && rMarkdown) {
    rMarkdownOpenButton.addEventListener("click", () => rMarkdownFileInput.click());
    rMarkdownFileInput.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
      if (file.size > 4 * 1024 * 1024) { notice("R Markdown exceeds 4 MiB."); return; }
      try {
        const text = await file.text();
        if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
        const imported = rMarkdown.decode(text, parseCells);
        if (!canReplace()) return;
        await onImported(imported, file.name);
        notice("R Markdown imported as source cells. " +
          (imported.metadataDiscarded ? "YAML metadata was not retained. " : "") +
          "Inline R remains Markdown text; no code was executed.");
      } catch (error) {
        notice("R Markdown import failed: " + String(error.message || error));
      }
    });
  }
  return Object.freeze({});
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookIO = api;
})(globalThis);
