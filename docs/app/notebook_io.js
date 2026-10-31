/* Browser-local notebook file controls. */
(function (global) {
"use strict";
function create(options) {
  const {openButton, fileInput, saveButton, source, language, format, parseCells,
    isBusy, canReplace, getDocumentIdentity, onImported, onExport, getResults, getFilename, notice,
    bundleOpenButton, bundleFileInput, bundleSaveButton,
    rMarkdownOpenButton, rMarkdownFileInput, rMarkdown,
    quartoOpenButton, quartoFileInput, quarto} = options;
  // File reads can finish out of order. The most recent selection wins until
  // an import starts applying; never overwrite edits made while a read awaits.
  let importGeneration = 0;
  let applyingImport = false;
  async function importDocument(file, limit, tooLarge, errorPrefix, decode, successMessage) {
    if (!file) return;
    if (applyingImport) { notice("Wait for notebook import to finish."); return; }
    const token = ++importGeneration;
    if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
    if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit) {
      notice(tooLarge);
      return;
    }
    const initialSource = source.value, initialLanguage = language.value;
    const initialDocumentIdentity = getDocumentIdentity?.();
    try {
      const text = await file.text();
      if (token !== importGeneration) return;
      if (isBusy()) { notice("Wait for notebook execution to finish."); return; }
      if (getDocumentIdentity && getDocumentIdentity() !== initialDocumentIdentity) {
        notice("Notebook import cancelled: active document changed during file read.");
        return;
      }
      if (source.value !== initialSource || language.value !== initialLanguage) {
        notice("Notebook import cancelled: editor changed during file read.");
        return;
      }
      // File metadata alone is not a content budget; validate the actual bytes.
      if (typeof text !== "string" || new TextEncoder().encode(text).length > limit)
        throw Error("Imported document exceeds its byte limit.");
      const imported = decode(text);
      if (!canReplace()) return;
      applyingImport = true;
      try { await onImported(imported, file.name); }
      finally { applyingImport = false; }
      notice(successMessage(imported));
    } catch (error) {
      if (token === importGeneration)
        notice(errorPrefix + String(error.message || error));
    }
  }
  openButton.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    return importDocument(file, format.MAX_JSON_BYTES, "Notebook exceeds 4 MiB.",
      "Notebook import failed: ", text => format.decode(text), imported =>
        imported.entries?.length ?
          "Notebook imported with display-only saved outputs; interpreter state was not restored." +
            (imported.ignoredMetadata ? " Unsupported cell metadata was omitted." : "") +
            (imported.ignoredOutputs ? " Unsupported or oversized outputs were omitted." : "") :
          "Notebook imported. " +
            (imported.ignoredMetadata ? "Unsupported cell metadata was omitted. " : "") +
            (imported.ignoredOutputs ? "Unsupported outputs were omitted. " : "") +
            "Interpreter state was not loaded.");
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
    bundleFileInput.addEventListener("change", event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      return importDocument(file, format.MAX_JSON_BYTES, "FlowStudio notebook exceeds 4 MiB.",
        "FlowStudio notebook import failed: ", text => format.decodeBundle(text, parseCells),
        () => "FlowStudio notebook imported with saved outputs; interpreter state was not restored.");
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
    rMarkdownFileInput.addEventListener("change", event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      return importDocument(file, 4 * 1024 * 1024, "R Markdown exceeds 4 MiB.",
        "R Markdown import failed: ", text => rMarkdown.decode(text, parseCells), imported =>
          "R Markdown imported as source cells. " +
          (imported.metadataDiscarded ? "YAML metadata was not retained. " :
            "Supported YAML metadata is retained as inert Markdown. ") +
          "Inline R remains Markdown text; no code was executed.");
    });
  }
  if (quartoOpenButton && quartoFileInput && quarto) {
    quartoOpenButton.addEventListener("click", () => quartoFileInput.click());
    quartoFileInput.addEventListener("change", event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      return importDocument(file, 4 * 1024 * 1024, "Quarto document exceeds 4 MiB.",
        "Quarto import failed: ", text => quarto.decode(text, parseCells),
        () => "Quarto document imported as R/Python source cells; no code was executed. " +
          "Only inert scalar YAML and HTML format are supported.");
    });
  }
  return Object.freeze({});
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookIO = api;
})(globalThis);
