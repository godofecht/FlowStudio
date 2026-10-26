"use strict";
/* Sidebar panel mounts: packages, examples, replay debugger.
 * Runs after the workspace script; shares its globals (el, documents, src,
 * language, status, writeConsole, consolePane, revealPosition).
 * Coverage lives in the module suites (packages/examples/debug panels);
 * index.html wiring is asserted by contract tests.
 */
(function (global) {
const { FlowStudioPackageManager, FlowStudioExamples, FlowStudioDebugPanel } = global;
const el = typeof global.document !== "undefined" ? id => global.document.getElementById(id) : null;
if (!FlowStudioPackageManager || !FlowStudioExamples || !FlowStudioDebugPanel || !el) return;

const language = global.document.getElementById("language");

const packagesPanel = FlowStudioPackageManager.mount(global.document, {
  target: el("packageTable"), input: el("packageSpec"),
  installButton: el("packageInstall"), listButton: el("packageList"),
  notice: message => { el("packageNotice").textContent = message; },
  language: () => language.value
});
packagesPanel.updateLanguage();
el("packageInstall").addEventListener("click", () => void packagesPanel.install());
el("packageList").addEventListener("click", () => void packagesPanel.list());

FlowStudioExamples.mount(global.document, {
  host: el("examplesHost"),
  onOpen: (example, file) => {
    try {
      const current = global.FlowStudioApp.documents.active();
      if (current) global.FlowStudioApp.documents.setText(current.id, el("source").value);
      const opened = global.FlowStudioApp.documents.open({ name: file.name,
        text: file.text, language: file.language, baseline: "" });
      global.FlowStudioApp.activateDocument(opened.document.id);
      language.value = file.language;
      language.dispatchEvent(new Event("change"));
      el("resultStatus").textContent = "Opened example: " + example.title;
      el("resultStatus").dataset.state = "ok";
    } catch (error) {
      el("resultStatus").textContent = error.message || String(error);
      el("resultStatus").dataset.state = "error";
    }
  },
  onDemo: async (example) => {
    const consolePane = el("console");
    if (global.FlowStudioConsoleIO) global.FlowStudioConsoleIO.write("\n> Python → R interop demo\n");
    else consolePane.textContent += "\n> Python → R interop demo\n";
    let ok = false;
    try {
      const response = await global.fetch(example.demoRoute, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
        body: ""
      });
      const text = await response.text();
      if (global.FlowStudioConsoleIO) global.FlowStudioConsoleIO.write(text + "\n");
      else consolePane.textContent += text + "\n";
      ok = response.ok;
      consolePane.scrollTop = consolePane.scrollHeight;
    } catch (error) {
      consolePane.textContent += String(error) + "\n";
    }
    el("resultStatus").textContent = "Interop demo finished";
    el("resultStatus").dataset.state = ok ? "ok" : "error";
  }
});

const breakpoints = FlowStudioDebugPanel.createBreakpointStore();
let activeDocumentId = () => {
  const app = global.FlowStudioApp;
  const doc = app && app.documents.active();
  return doc ? doc.id : null;
};
const debugPanel = FlowStudioDebugPanel.mount(global.document, {
  node: el("view-debug"),
  fetchFn: (route, init) => global.fetch(route, init),
  getSource: () => el("source").value,
  getBreakpoints: () => breakpoints.lines(activeDocumentId()),
  onStep: step => global.FlowStudioApp.revealPosition(step.line, 1),
  notice: (message, state) => {
    el("resultStatus").textContent = message;
    el("resultStatus").dataset.state = state || "";
  }
});
function renderBreakpoints() {
  const lines = breakpoints.lines(activeDocumentId());
  el("debugBreakpoints").textContent = lines.length ?
    "Breakpoints on lines: " + lines.join(", ") : "No breakpoints yet.";
}
function cursorLine() {
  const source = el("source");
  return source.value.slice(0, source.selectionStart).split("\n").length;
}
el("debugToggleBp").addEventListener("click", () => {
  const docId = activeDocumentId();
  if (!docId) { el("resultStatus").textContent = "No active buffer."; return; }
  if (!breakpoints.toggle(docId, cursorLine())) {
    el("resultStatus").textContent = "Breakpoint limit reached.";
    el("resultStatus").dataset.state = "error";
  }
  renderBreakpoints();
});
el("debugClearBp").addEventListener("click", () => {
  const docId = activeDocumentId();
  if (docId) breakpoints.clear(docId);
  renderBreakpoints();
});
el("debugRun").addEventListener("click", async () => {
  if (language.value !== "python") {
    el("resultStatus").textContent = "The replay tracer runs Python only today.";
    el("resultStatus").dataset.state = "error";
    return;
  }
  const result = await debugPanel.run();
  if (result) {
    renderBreakpoints();
    const first = debugPanel.current();
    if (first) global.FlowStudioApp.revealPosition(first.line, 1);
    el("resultStatus").textContent = result.ok ?
      "Trace finished; scrub the steps." : "Execution failed; see the console.";
    el("resultStatus").dataset.state = result.ok ? "ok" : "error";
  }
});

global.FlowStudioWorkspacePanels = Object.freeze({
  packagesPanel, breakpoints, debugPanel, renderBreakpoints
});
})(globalThis);
