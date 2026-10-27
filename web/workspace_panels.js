"use strict";
/* Sidebar panel mounts: packages, examples, replay debugger.
 * Each panel mounts independently: a missing global or a failed mount is
 * logged and skipped, never silently disabling the other panels.
 * Coverage lives in the module suites (packages/examples/debug panels);
 * index.html wiring is asserted by contract tests.
 */
(function (global) {
const modules = [
  ["FlowStudioPackageManager", global.FlowStudioPackageManager],
  ["FlowStudioExamples", global.FlowStudioExamples],
  ["FlowStudioDebugPanel", global.FlowStudioDebugPanel]
];
const el = typeof global.document !== "undefined" && global.document.getElementById
  ? id => global.document.getElementById(id) : null;
if (!el) {
  if (global.console && global.console.error) global.console.error("workspace_panels: no document.");
  return;
}
const language = global.document.getElementById("language");
const exports = {};
let firstErrorPanel = null;

function mountPanel(name, thing, run) {
  if (!thing) {
    firstErrorPanel = firstErrorPanel || name;
    global.console.error("workspace_panels: " + name + " module missing; its panel will not load. " +
      "Reload the page (the script may not have finished downloading).");
    return;
  }
  try {
    run(thing);
  } catch (error) {
    firstErrorPanel = firstErrorPanel || name;
    global.console.error("workspace_panels: " + name + " failed to mount: " + (error && error.message ? error.message : error));
  }
}

/* Examples first: a curated gallery must load even if debug wiring changes. */
mountPanel("FlowStudioExamples", global.FlowStudioExamples, Examples => {
  Examples.mount(global.document, {
    host: el("examplesHost"),
    onOpen: (example, file) => {
      try {
        const current = global.FlowStudioApp.documents.active();
        if (current) global.FlowStudioApp.documents.setText(current.id, document.getElementById("source").value);
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
});

mountPanel("FlowStudioPackageManager", global.FlowStudioPackageManager, PackageManager => {
  const packagesPanel = PackageManager.mount(global.document, {
    target: el("packageTable"), input: el("packageSpec"),
    installButton: el("packageInstall"), listButton: el("packageList"),
    notice: message => { el("packageNotice").textContent = message; },
    language: () => language.value
  });
  packagesPanel.updateLanguage();
  el("packageInstall").addEventListener("click", () => void packagesPanel.install());
  el("packageList").addEventListener("click", () => void packagesPanel.list());
  exports.packagesPanel = packagesPanel;
});

mountPanel("FlowStudioDebugPanel", global.FlowStudioDebugPanel, DebugPanel => {
  const breakpoints = DebugPanel.createBreakpointStore();
  const activeDocumentId = () => {
    const app = global.FlowStudioApp;
    const doc = app && app.documents.active();
    return doc ? doc.id : null;
  };
  const debugPanel = DebugPanel.mount(global.document, {
    node: el("view-debug"),
    fetchFn: (route, init) => global.fetch(route, init),
    getSource: () => document.getElementById("source").value,
    getBreakpoints: () => breakpoints.lines(activeDocumentId()),
    onStep: step => global.FlowStudioApp.revealPosition(step.line, 1),
    notice: (message, state) => {
      el("resultStatus").textContent = message;
      el("resultStatus").dataset.state = state || "";
    }
  });
  const renderBreakpoints = () => {
    const lines = breakpoints.lines(activeDocumentId());
    el("debugBreakpoints").textContent = lines.length ?
      "Breakpoints on lines: " + lines.join(", ") : "No breakpoints yet.";
  };
  const cursorLine = () => {
    const source = document.getElementById("source");
    return source.value.slice(0, source.selectionStart).split("\n").length;
  };
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
  exports.breakpoints = breakpoints;
  exports.debugPanel = debugPanel;
  exports.renderBreakpoints = renderBreakpoints;
});

if ((typeof module === "undefined" || !module.exports) &&
    firstErrorPanel && global.console && global.console.warn) {
  global.console.warn("workspace_panels: first failing panel was " + firstErrorPanel);
}

global.FlowStudioWorkspacePanels = Object.freeze(exports);
})(typeof window !== "undefined" ? window : globalThis);
