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
  /* A dirty buffer keeps its own text on reopen, so a buffer still holding
   * the pre-Reader-removal pipeline source gets upgraded explicitly here.
   * files must already be the upgraded set. */
  const LEGACY_READER_MARKER = "for row in Reader";
  function upgradeOpenBuffers(docIds, files) {
    const documents = global.FlowStudioApp.documents;
    let touched = false;
    for (const id of docIds) {
      const doc = documents.find(id);
      if (!doc || !doc.text.includes(LEGACY_READER_MARKER)) continue;
      const file = files.find(candidate => candidate.name === doc.name);
      if (!file) continue;
      documents.setText(id, file.text);
      touched = true;
    }
    return touched;
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
    if (project.runner === "mathflow") {
      const runMath = el("runMathFlow");
      if (!runMath || runMath.disabled) return false;
      runMath.click();
      return true;
    }
    if (project.runProject) {
      // Multi-language pipelines run every file in order (Run project).
      const runAll = el("runProject");
      if (!runAll || runAll.disabled) return false;
      runAll.click();
      return true;
    }
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
    const upgraded = upgradeOpenBuffers(docIds, files);
    const target = activateFileName
      ? files.findIndex(file => file.name === activateFileName) : 0;
    const entry = docIds[target >= 0 ? target : 0];
    activateEntry(entry, files[target >= 0 ? target : 0].language);
    el("resultStatus").textContent = "Opened " + (project.title || project.id) +
      " as " + docIds.length + " editor tab(s)." +
      (upgraded ? " Legacy Flow source upgraded to the current pipeline." : "");
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
        // Saved projects keep the file text as last seen; projects saved
        // before the Reader removal carry Flow source that no longer parses.
        const fixed = Examples.upgradeFiles ? Examples.upgradeFiles(project.files) : null;
        if (fixed) project = { ...project, files: fixed };
        openProjectBuffers(project, project.files, file && file.name || null);
        if (fixed) saveOpenProjects();
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
    /* Debug: open the example, place its breakpoints, start the debugger. */
    onDebug: async (example) => {
      try {
        openProjectBuffers(example, example.files);
        persistOpenProject(example, example.files);
        const debuggerApi = global.FlowStudioDebugger && global.FlowStudioDebugger.instance;
        const editor = global.FlowStudioEditor && global.FlowStudioEditor.editor;
        const doc = global.FlowStudioApp.documents.active();
        if (!debuggerApi || !editor || !doc) throw new Error("The debugger is still loading.");
        const model = editor.getModel();
        const lines = (example.breakpoints || {})[doc.name] || [];
        debuggerApi.breakpoints.clear(model);
        for (const line of lines) debuggerApi.breakpoints.toggle(model, line);
        el("tab-debug").click();
        await debuggerApi.start();
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

  /* Ordered run plan for the active buffer's project: steps follow the
   * project's declared file order (the gallery authors that order as the
   * data dependency order, e.g. generate.py before analyse.R). Returns
   * null when the active buffer does not belong to an open project. */
  exports.projectRunPlan = () => {
    const app = global.FlowStudioApp;
    if (!app || !app.documents) return null;
    const active = app.documents.active();
    if (!active) return null;
    for (const [projectId, docIds] of openedProjects) {
      if (!docIds.includes(active.id)) continue;
      const meta = projectMeta.get(projectId);
      if (!meta || !Array.isArray(meta.files)) continue;
      const steps = [];
      for (let index = 0; index < docIds.length; index++) {
        const doc = app.documents.find(docIds[index]);
        const file = meta.files[index];
        if (doc && file) steps.push({ id: doc.id, name: file.name, language: doc.language });
      }
      if (steps.length) return { id: projectId, title: meta.title || projectId, steps };
      return null;
    }
    return null;
  };
});

/* The Packages view (web/ide_packages_view.js) mounts itself and uses
 * FlowStudioPackageManager for its validated install and list code. */

/* Debugging lives in web/ide_debugger.js (Flow via LLDB, Python, R). */

if ((typeof module === "undefined" || !module.exports) &&
    firstErrorPanel && global.console && global.console.warn) {
  global.console.warn("workspace_panels: first failing panel was " + firstErrorPanel);
}

global.FlowStudioWorkspacePanels = Object.freeze(exports);
})(typeof window !== "undefined" ? window : globalThis);
