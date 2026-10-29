/* Native Flow compiler diagnostics for the primary Monaco workspace.
 * Never invent a diagnostic: locations come from the real Flow check route.
 */
(function (global) {
"use strict";
const MAX_VISIBLE_OUTPUT = 12000;
function mount({editor, native, app, language, button, output, status, problems = null}) {
  if (!editor || typeof editor.createDecorationsCollection !== "function" ||
      !native || typeof native.checkSyntax !== "function" ||
      !app?.documents?.active || !language || !button || !output || !status)
    throw new Error("Missing native Flow diagnostics dependencies.");
  const decorations = editor.createDecorationsCollection();
  let generation = 0;
  let pending = false;
  let activeProblems = [];
  let problemSnapshot = null;
  function clearProblems() {
    activeProblems = [];
    problemSnapshot = null;
    if (problems) {
      problems.replaceChildren();
      problems.hidden = true;
    }
  }
  // Every jump is tied to the exact checked model, document and edit revision.
  // A click queued before a source edit must not navigate the replacement file.
  function navigateToProblem(index) {
    const snapshot = problemSnapshot;
    if (!snapshot || snapshot.generation !== generation ||
        editor.getModel() !== snapshot.model ||
        snapshot.model.getVersionId() !== snapshot.version ||
        app.documents.active()?.id !== snapshot.documentId || !available()) return false;
    const point = activeProblems[index];
    if (!point) return false;
    editor.setPosition(point);
    editor.revealPositionInCenterIfOutsideViewport(point);
    return true;
  }
  function renderProblems(errors, model, version, documentId, token) {
    clearProblems();
    activeProblems = errors.map(error => ({
      lineNumber: error.range.startLineNumber, column: error.range.startColumn
    }));
    problemSnapshot = {model, version, documentId, generation:token};
    if (!problems || !activeProblems.length) return;
    const owner = problems.ownerDocument;
    if (!owner || typeof owner.createElement !== "function") return;
    const entries = errors.map((error, index) => {
      const item = owner.createElement("button");
      item.type = "button";
      item.className = "flow-problem";
      // textContent, never HTML: compiler output can contain user source.
      item.textContent = "Line " + error.range.startLineNumber +
        ", column " + error.range.startColumn + ": " +
        error.options.hoverMessage.value;
      item.addEventListener("click", () => { navigateToProblem(index); });
      return item;
    });
    problems.replaceChildren(...entries);
    problems.hidden = false;
  }
  function available() {
    return language.value === "flow" && native.available() && !!editor.getModel();
  }
  function update() {
    button.disabled = pending || !available();
  }
  function invalidate() {
    generation++;
    pending = false;
    decorations.clear();
    clearProblems();
    output.hidden = true;
    output.textContent = "";
    update();
  }
  function show(message, ok) {
    output.textContent = message.slice(0, MAX_VISIBLE_OUTPUT);
    output.hidden = false;
    status.textContent = ok ? "Flow compile check passed." : "Flow compile check failed; see diagnostics.";
    status.dataset.state = ok ? "ok" : "error";
  }
  async function check() {
    if (pending || !available()) return false;
    const model = editor.getModel();
    const source = model.getValue();
    const doc = app.documents.active();
    if (!doc || !source.trim()) return false;
    const documentId = doc.id;
    const version = model.getVersionId();
    const token = ++generation;
    decorations.clear();
    clearProblems();
    output.hidden = true;
    pending = true;
    update();
    try {
      // This calls the existing strict, nonexecuting Flow 2.x compiler route.
      const result = await native.checkSyntax(source);
      if (token !== generation || editor.getModel() !== model ||
          model.getVersionId() !== version ||
          app.documents.active()?.id !== documentId || !available()) return false;
      if (!result || typeof result.ok !== "boolean" ||
          typeof result.output !== "string" || !Array.isArray(result.diagnostics))
        throw new Error("Invalid native Flow compiler response.");
      const errors = [];
      for (const diagnostic of result.diagnostics.slice(0, 64)) {
        if (!diagnostic || !Number.isSafeInteger(diagnostic.line) ||
            diagnostic.line < 1 || diagnostic.line > model.getLineCount() ||
            !Number.isSafeInteger(diagnostic.column) || diagnostic.column < 1 ||
            typeof diagnostic.message !== "string") continue;
        const column = Math.min(diagnostic.column, model.getLineMaxColumn(diagnostic.line));
        errors.push({
          range: {startLineNumber:diagnostic.line, startColumn:column,
            endLineNumber:diagnostic.line,
            endColumn:Math.min(column + 1, model.getLineMaxColumn(diagnostic.line))},
          options: {inlineClassName:"flowstudio-flow-error",
            hoverMessage:{value:diagnostic.message.slice(0, 512)}}
        });
      }
      decorations.set(errors);
      renderProblems(errors, model, version, documentId, token);
      show(result.output || (result.ok ? "Flow source passed compiler checking." :
        "Flow compiler rejected this source without a location."), result.ok);
      if (errors.length) navigateToProblem(0);
      return result.ok;
    } catch (error) {
      if (token === generation) show("Flow compiler check unavailable: " +
        String(error?.message || error), false);
      return false;
    } finally {
      if (token === generation) { pending = false; update(); }
    }
  }
  editor.onDidChangeModelContent(invalidate);
  editor.onDidChangeModel(invalidate);
  language.addEventListener("change", invalidate);
  button.addEventListener("click", () => { void check(); });
  update();
  return Object.freeze({check, invalidate, navigateToProblem});
}
const api = Object.freeze({mount});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioFlowDiagnostics = api;
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  if (!global.FlowStudioEditor?.editor || !global.FlowStudioNativeFlow || !global.FlowStudioApp) return;
  global.FlowStudioFlowDiagnosticsController = mount({
    editor:global.FlowStudioEditor.editor,
    native:global.FlowStudioNativeFlow,
    app:global.FlowStudioApp,
    language:document.getElementById("language"),
    button:document.getElementById("checkFlow"),
    output:document.getElementById("flowDiagnostics"),
    problems:document.getElementById("flowProblems"),
    status:document.getElementById("resultStatus")
  });
});
})(globalThis);
