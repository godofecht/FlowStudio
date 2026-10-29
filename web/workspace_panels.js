"use strict";
/* Sidebar panel mounts: packages, examples, replay debugger.
 * Each panel mounts independently: a missing global or a failed mount is
 * logged and skipped, never silently disabling the other panels.
 * Coverage lives in the module suites (packages/examples/debug panels);
 * index.html wiring is asserted by contract tests.
 */
(function (global) {
const store = (function () {
  let storage = null;
  try { storage = global.localStorage || null; } catch (_) { storage = null; }
  return global.FlowStudioSavedProjects
    ? global.FlowStudioSavedProjects.createStore(storage) : null;
})();
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
  const openedProjects = new Map();   // saved project id -> document ids per file
  const projectMeta = new Map();      // saved project id -> { title, files }
  function syncDoc(doc, file) {
    const documents = global.FlowStudioApp.documents;
    if (doc && !doc.dirty) documents.setText(doc.id, file.text);
    else if (!doc) {
      const created = documents.open({ name: file.name, text: file.text,
        language: file.language, baseline: "" });
      return created.document.id;
    }
    return doc.id;
  }
  function activateEntry(docId, languageName) {
    global.FlowStudioApp.activateDocument(docId);
    language.value = languageName;
    language.dispatchEvent(new Event("change"));
  }
  /* Opening a project also runs its entry file, so plot-producing examples
   * put a figure on the Plots tab without an extra click. Execution failures
   * surface through the normal editor/console status, never as thrown errors. */
  function runExampleEntry(project) {
    const commands = global.FlowStudioApp && global.FlowStudioApp.commands;
    if (!commands || typeof commands.runDocument !== "function") return false;
    const docIds = openedProjects.get(project.id) || [];
    if (!docIds.length) return false;
    try { return commands.runDocument(docIds[0]); }
    catch (_) { return false; }
  }
  /* Opens (reopens) every project file as an editor buffer, activating the
   * entry file — or the requested file when given. */
  function openProjectBuffers(project, files, activateFileName = null) {
    const documents = global.FlowStudioApp.documents;
    if (!files.length) {
      el("resultStatus").textContent = "This example runs in the console instead.";
      el("resultStatus").dataset.state = "ok";
      return;
    }
    const known = openedProjects.get(project.id) || [];
    const docIds = [];
    for (const file of files) {
      const existing = known.find(id => {
        const doc = documents.find(id);
        return doc && doc.name === file.name && doc.language === file.language;
      });
      docIds.push(syncDoc(documents.find(existing), file));
    }
    openedProjects.set(project.id, docIds);
    projectMeta.set(project.id, { title: project.title || project.id, files });
    const target = activateFileName
      ? files.findIndex(file => file.name === activateFileName) : 0;
    const entry = docIds[target >= 0 ? target : 0];
    activateEntry(entry, files[target >= 0 ? target : 0].language);
    el("resultStatus").textContent = "Opened " + (project.title || project.id) +
      " as " + docIds.length + " editor tab(s).";
    el("resultStatus").dataset.state = "ok";
    if (typeof global.console !== "undefined" && global.console.log) {
      global.console.log("FlowStudioExamples opened " + project.id +
        " (" + docIds.length + " buffers).");
    }
  }
  /* Snapshot the live document texts of a project's buffers so the saved
   * project preserves user edits, not just the example template. */
  function projectFilesSnapshot(projectId, files) {
    const documents = global.FlowStudioApp.documents;
    const known = openedProjects.get(projectId) || [];
    return files.map((file, index) => {
      const doc = documents.find(known[index]);
      return { name: file.name, language: file.language,
        text: doc ? doc.text : file.text };
    });
  }
  function persistOpenProject(project, files) {
    if (!store || !project || !Array.isArray(files) || !files.length) return;
    try {
      const snapshot = projectFilesSnapshot(project.id, files);
      store.upsert({ id: project.id, title: project.title || project.id,
        savedAt: Date.now(), files: snapshot });
      projectMeta.set(project.id, { title: project.title || project.id, files });
    } catch (error) {
      // Persistence failures must never break opening an example.
      if (global.console && global.console.warn)
        global.console.warn("workspace_panels: could not save project: " + error.message);
    }
  }
  function saveOpenProjects() {
    if (!store) return;
    for (const [id, meta] of projectMeta)
      persistOpenProject({ id, title: meta.title }, meta.files);
  }
  Examples.mount(global.document, {
    host: el("examplesHost"),
    saved: (() => ({
      list: () => store ? store.list().filter(project =>
        Array.isArray(project.files) && project.files.length) : []
    }))(),
    onReopenProject: (project, file) => {
      try {
        if (!project || !Array.isArray(project.files)) return false;
        openProjectBuffers(project, project.files, file && file.name || null);
        return true;
      } catch (error) {
        el("resultStatus").textContent = error.message || String(error);
        el("resultStatus").dataset.state = "error";
        return false;
      }
    },
    onForgetProject: (id) => {
      if (!store) return false;
      const removed = store.remove(id);
      openedProjects.delete(id);
      projectMeta.delete(id);
      return removed;
    },
    onOpenProject: (example) => {
      try {
        openProjectBuffers(example, example.files);
        persistOpenProject(example, example.files);
        if (runExampleEntry(example)) {
          el("resultStatus").textContent = "Opened " + (example.title || example.id) +
            ", running the entry file now.";
          el("resultStatus").dataset.state = "ok";
        }
      } catch (error) {
        el("resultStatus").textContent = error.message || String(error);
        el("resultStatus").dataset.state = "error";
      }
    },
    onOpen: (example, file) => {
      try {
        const openedId = syncDoc(null, file);
        openedProjects.set(example.id, [openedId]);
        projectMeta.set(example.id, { title: example.title, files: [file] });
        activateEntry(openedId, file.language);
        if (runExampleEntry(example)) {
          el("resultStatus").textContent = "Opened " + file.name +
            " and running it now.";
        } else {
          el("resultStatus").textContent = "Opened example: " + example.title;
        }
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
  });  if (typeof global.document !== "undefined" && global.document.addEventListener) {
    global.document.addEventListener("visibilitychange", () => {
      if (global.document.visibilityState === "hidden") saveOpenProjects();
    });
    if (typeof global.addEventListener === "function")
      global.addEventListener("beforeunload", saveOpenProjects);
  }
  exports.saveOpenProjects = saveOpenProjects;
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
    getDocId: activeDocumentId,
    getBreakpoints: () => breakpoints.lines(activeDocumentId()),
    previousButton: el("debugPrevious"), nextButton: el("debugNext"),
    previousBreakpointButton: el("debugPreviousBp"),
    nextBreakpointButton: el("debugNextBp"),
    onStep: step => global.FlowStudioApp.revealPosition(step.line, 1),
    onOutput: output => {
      const text = "\n> Python debug trace\n" + output +
        (output.endsWith("\n") ? "" : "\n");
      if (global.FlowStudioConsoleIO) global.FlowStudioConsoleIO.write(text, "python");
      else {
        const consolePane = el("console");
        consolePane.textContent += text;
        consolePane.scrollTop = consolePane.scrollHeight;
      }
    },
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
  // The existing native CPython debugger already implements genuine pausing
  // in the persistent Python kernel. Mount its tested browser controller in
  // the native workspace rather than substituting another replay tracer.
  // An empty live breakpoint input inherits the editor's cursor breakpoints;
  // explicit entries support the backend's bounded numeric conditions.
  const NativePython = global.FlowStudioNativeFlow;
  const LivePython = global.FlowStudioPythonDebugPanel;
  if (NativePython && LivePython) {
    const liveBreakpointInput = el("liveDebugBreakpoints");
    const liveBreakpoints = {
      get value() {
        return liveBreakpointInput.value.trim() ||
          breakpoints.lines(activeDocumentId()).join(",");
      }
    };
    exports.liveDebugPanel = LivePython.create({
      native: NativePython, source: el("source"), language,
      breakpoints: liveBreakpoints,
      pauseOnException: el("liveDebugPauseException"),
      startButton: el("liveDebugStart"), stepButton: el("liveDebugStep"),
      nextButton: el("liveDebugNext"), finishButton: el("liveDebugFinish"),
      continueButton: el("liveDebugContinue"), stopButton: el("liveDebugStop"),
      statusButton: el("liveDebugStatus"), target: el("liveDebugOutput"),
      frameHost: el("liveDebugFrames"),
      getDocId: activeDocumentId,
      onFrame: frame => global.FlowStudioApp.revealPosition(frame.line, 1),
      notice: message => {
        el("resultStatus").textContent = message;
        el("resultStatus").dataset.state = message.includes("error") ? "error" : "ok";
      }
    });
  } else {
    el("liveDebugOutput").textContent = "Native Python debugger scripts unavailable.";
  }
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
