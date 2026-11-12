/* Mounts the workspace explorer (web/ide_explorer.js) into the native IDE
 * shell and keeps open editor tabs consistent with file operations:
 * a renamed or moved file keeps its tab under the new path, a deleted file
 * closes its clean tab, and the active tab is revealed in the tree. */
(function (root) {
"use strict";

/* Re-resolve a file handle by walking from the folder root. Needed after a
 * folder rename or move, where handles to files inside it go stale. */
async function resolveFile(rootHandle, path) {
  const parts = path.split("/").slice(1);
  let directory = rootHandle;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(parts[parts.length - 1]);
}
const EDITORS_KEY = "flowstudio.workspace.editors.v1:";

/* Breadcrumb segments for a document path: folders are buttons that reveal
 * the folder in the explorer, the file is plain text. */
function crumbs(doc) {
  if (!doc) return [];
  const parts = (doc.path || doc.name || "").split("/").filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join("/"),
    current: index === parts.length - 1
  }));
}
function remapPath(path, oldPath, newPath) {
  if (path === oldPath) return newPath;
  if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
  return null;
}

function mount(doc, app, Explorer, options = {}) {
  const host = doc.getElementById("explorer");
  if (!host || !app || !Explorer) return null;
  const storage = options.storage !== undefined ? options.storage
    : (() => { try { return root.localStorage; } catch (_) { return null; } })();
  const handleStore = options.handleStore !== undefined ? options.handleStore
    : (root.indexedDB ? Explorer.createHandleStore(root.indexedDB) : null);
  const documents = app.documents;
  let explorer = null;
  const restored = new Set();

  function renderBreadcrumb() {
    const nav = doc.getElementById("breadcrumbPath");
    if (!nav) return;
    const active = documents.active && documents.active();
    const items = [];
    crumbs(active).forEach((crumb, index) => {
      if (index) {
        const sep = doc.createElement("span");
        sep.className = "crumb-sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "\u203a";
        items.push(sep);
      }
      if (crumb.current || !active.path) {
        const span = doc.createElement("span");
        span.className = crumb.current ? "crumb-current" : "";
        span.textContent = crumb.name;
        if (crumb.current) span.setAttribute("aria-current", "page");
        items.push(span);
      } else {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = crumb.name;
        button.title = "Reveal " + crumb.path + " in the explorer";
        button.addEventListener("click", () => {
          const tab = doc.getElementById("tab-files");
          if (tab) tab.click();
          if (index === 0) { explorer.focus(); return; }
          void explorer.reveal(crumb.path, true);
        });
        items.push(button);
      }
    });
    nav.replaceChildren(...items);
  }

  /* Remember which project files were open, and reopen them the first time
   * that folder is opened again on this page (VS Code restores editors per
   * workspace). Only paths are stored; contents are re-read from disk. */
  let switching = false;    // a project switch is closing and reopening tabs
  function saveEditors() {
    if (switching || !storage || !explorer || !explorer.hasRoot()) return;
    const prefix = explorer.rootName() + "/";
    const open = documents.list().filter(item => item.path && item.path.startsWith(prefix)).map(item => item.path);
    const active = documents.active && documents.active();
    try {
      storage.setItem(EDITORS_KEY + explorer.rootName(), JSON.stringify({
        open: open.slice(0, 30), active: active && active.path && active.path.startsWith(prefix) ? active.path : null
      }));
    } catch (_) { /* optional */ }
  }
  async function restoreEditors(handle) {
    const projects = root.FlowStudioProjects;
    if (!storage || !handle || (!projects && restored.has(handle.name))) return 0;
    restored.add(handle.name);
    let saved = null;
    try { saved = JSON.parse(storage.getItem(EDITORS_KEY + handle.name) || "null"); } catch (_) { saved = null; }
    if (!saved || !Array.isArray(saved.open)) return 0;
    const already = new Set(documents.list().map(item => item.path).filter(Boolean));
    let reopened = 0;
    for (const path of saved.open.slice(0, 30)) {
      if (typeof path !== "string" || already.has(path) || !path.startsWith(handle.name + "/")) continue;
      try {
        const fileHandle = await resolveFile(handle, path);
        if (await app.openEditorHandle(fileHandle, path)) reopened++;
      } catch (_) { /* a removed file is skipped */ }
    }
    if (typeof saved.active === "string") {
      const target = documents.list().find(item => item.path === saved.active);
      if (target) app.activateDocument(target.id);
    }
    if (reopened) app.status("Reopened " + reopened + " editor" + (reopened === 1 ? "" : "s") + " from " + handle.name, "ok");
    return reopened;
  }

  async function onEntryMoved({ kind, oldPath, newPath, handle }) {
    for (const item of documents.list()) {
      const next = item.path ? remapPath(item.path, oldPath, newPath) : null;
      if (!next) continue;
      let nextHandle = item.handle;
      if (kind === "file") nextHandle = handle;
      else {
        try { nextHandle = await resolveFile(explorer.root(), next); }
        catch (_) { nextHandle = null; }
      }
      item.handle = nextHandle;
      documents.rename(item.id, next.slice(next.lastIndexOf("/") + 1), next);
    }
    app.renderTabs();
    const active = documents.active && documents.active();
    const label = doc.getElementById("fileLabel");
    if (label && active) label.textContent = active.path || active.name;
  }
  function onEntryDeleted({ path }) {
    for (const item of documents.list()) {
      if (!item.path || (item.path !== path && !item.path.startsWith(path + "/"))) continue;
      if (!item.dirty) app.closeDocument(item.id);
    }
  }

  explorer = Explorer.mount({
    doc, host,
    status: app.status,
    openHandle: (handle, path) => app.openEditorHandle(handle, path),
    listDocuments: () => documents.list(),
    activePath: () => { const active = documents.active && documents.active(); return active ? active.path : null; },
    onRootChanged: handle => {
      app.adoptProjectRoot(handle);
      /* A project switch closes the previous project's tabs first. */
      if (root.FlowStudioProjects) {
        switching = true;
        Promise.resolve(root.FlowStudioProjects.rootChanged(handle, restoreEditors))
          .catch(error => app.status("Could not open the project: " + (error && error.message || error), "error"))
          .finally(() => { switching = false; saveEditors(); });
      } else if (handle) void restoreEditors(handle);
    },
    beforeRootChange: () => (root.FlowStudioProjects ? root.FlowStudioProjects.beforeSwitch() : true),
    emptyActions: () => [
      { id: "newProject", label: "New project...", primary: true,
        run: () => { if (root.FlowStudioProjects) root.FlowStudioProjects.newProject(); } },
      { id: "examples", label: "Browse examples",
        run: () => { const tab = doc.getElementById("tab-examples"); if (tab) tab.click(); } }
    ],
    onEntryMoved,
    onEntryDeleted,
    picker: typeof root.showDirectoryPicker === "function" ? opts => root.showDirectoryPicker(opts) : null,
    createApi: root.FlowStudioProjectCreate,
    renameApi: root.FlowStudioProjectRename,
    fileSave: root.FlowStudioFileSave,
    validFilename: root.FlowStudioProject.validFilename,
    confirm: message => root.confirm(message),
    clipboard: root.navigator && root.navigator.clipboard,
    storage,
    handleStore
  });

  /* Re-render decorations and follow the active tab, like VS Code's autoReveal. */
  let lastActive = null;
  let pending = false;
  doc.addEventListener("flowstudio:documents", () => {
    if (pending) return;
    pending = true;
    Promise.resolve().then(() => {
      pending = false;
      renderBreadcrumb();
      saveEditors();
      const active = documents.active && documents.active();
      const path = active ? active.path : null;
      if (path && path !== lastActive && explorer.hasRoot()) {
        lastActive = path;
        void explorer.reveal(path, false);
      } else {
        lastActive = path;
        explorer.render();
      }
    });
  });

  /* Shortcuts: VS Code view switches, plus Alt+F1 (JetBrains "select in"). */
  doc.addEventListener("keydown", event => {
    const mod = event.ctrlKey || event.metaKey;
    const key = (event.key || "").toLowerCase();
    if (mod && event.shiftKey && key === "e") {
      event.preventDefault();
      app.commands.showExplorer();
    } else if (mod && event.shiftKey && key === "f") {
      event.preventDefault();
      app.commands.findInProject();
    } else if (event.altKey && event.key === "F1") {
      event.preventDefault();
      app.commands.revealActiveFile();
    }
  });
  renderBreadcrumb();
  return explorer;
}

const api = Object.freeze({ mount, resolveFile, remapPath, crumbs });
root.FlowStudioWorkspace = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && root.FlowStudioApp && root.FlowStudioExplorer) {
  try {
    root.FlowStudioWorkspaceExplorer = mount(document, root.FlowStudioApp, root.FlowStudioExplorer);
  } catch (error) {
    if (root.console) root.console.error("FlowStudio explorer failed to mount: " + (error && error.message));
  }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
