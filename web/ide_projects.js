/* Projects: one open at a time, each with its own files and editor tabs.
 *
 * A project is a folder. It can be a folder on disk (opened through the
 * browser's folder access) or a local project kept in the browser's private
 * file system (OPFS) under projects/<name>. Examples open as local projects
 * too, so the explorer shows exactly the example's files and edits persist.
 *
 * Switching projects closes every tab of the previous one. Dirty files with
 * a place on disk are saved first when the user agrees; untitled scratch
 * buffers are listed and dropped. The new project reopens the tabs it had
 * last time, or its entry file.
 */
(function (root) {
"use strict";

const META_KEY = "flowstudio.project.meta:";
const ENTRY_GUESSES = ["app.flow", "main.flow", "main.py", "analysis.R", "main.R"];

const FLOW_MAIN = `# A Flow program. Run it with Ctrl+Enter, or press F5 to debug it.

function square(n: i32) -> i32 {
    return n * n
}

function main() -> i32 {
    let mut total: i32 = 0
    let mut i: i32 = 1
    while i <= 10 {
        total = total + square(i)
        i = i + 1
    }
    println("sum of squares 1..10 =", total)
    return 0
}
`;
const PYTHON_MAIN = `# Python runs in a persistent session: variables stay for the console.
import statistics

scores = [71, 88, 64, 93, 79]
mean = statistics.mean(scores)
print(f"mean score: {mean:.1f}")
print(f"spread: {statistics.stdev(scores):.2f}")
`;
const R_MAIN = `# R runs in a persistent session: objects stay for the console.
scores <- c(71, 88, 64, 93, 79)
cat("mean score:", mean(scores), "\\n")
summary(scores)
plot(scores, type = "b", main = "Scores")
`;

function graphicsTemplateFiles() {
  const list = Array.isArray(root.FlowStudioGraphicsExamples) ? root.FlowStudioGraphicsExamples : [];
  const tiles = list.find(item => item.id === "graphics-bouncing-tiles");
  return tiles ? tiles.files.map(file => ({ name: file.name, language: file.language, text: file.text }))
    : [{ name: "app.flow", language: "flow", text: 'import "stdlib/gfx.flow"\n\nfunction main() -> i32 {\n    let g = gfx_open(320, 200, "App")\n    while gfx_frame_pump(g) {\n        gfx_clear(g, 20, 24, 30)\n        gfx_fill_rect(g, 140, 80, 40, 40, 250, 196, 92)\n        gfx_present(g)\n        gfx_wait_frame(g, 60)\n    }\n    gfx_close(g)\n    return 0\n}\n' }];
}
function polyglotTemplateFiles() {
  const list = Array.isArray(root.FlowStudioPolyglotExamples) ? root.FlowStudioPolyglotExamples : [];
  const pipeline = list.find(item => item.id === "polyglot-epidemic-pipeline") || list[0];
  return pipeline ? pipeline.files.map(file => ({ name: file.name, language: file.language, text: file.text })) : [];
}
const TEMPLATES = Object.freeze([
  { id: "flow-app", title: "Flow graphics app", detail: "Draw with stdlib/gfx.flow. Runs in the Preview and reloads as you type.",
    files: graphicsTemplateFiles, entry: "app.flow" },
  { id: "flow", title: "Flow program", detail: "A console program compiled to native code. F5 debugs it with LLDB.",
    files: () => [{ name: "main.flow", language: "flow", text: FLOW_MAIN }], entry: "main.flow" },
  { id: "polyglot", title: "Flow, Python and R", detail: "Three files that hand data along in one session.",
    files: polyglotTemplateFiles, entry: null, runProject: true },
  { id: "python", title: "Python script", detail: "A persistent Python session with its variables in the side panel.",
    files: () => [{ name: "main.py", language: "python", text: PYTHON_MAIN }], entry: "main.py" },
  { id: "r", title: "R analysis", detail: "A persistent R session with plots in the Plots view.",
    files: () => [{ name: "analysis.R", language: "r", text: R_MAIN }], entry: "analysis.R" }
]);

/* ---------- files for AI tools opened in the project folder ----------
 * AGENTS.md is read by Codex, Cursor and others, CLAUDE.md by Claude Code,
 * and .mcp.json registers the FlowStudio MCP server so those tools can check
 * and run Flow through FlowStudio. info is { mcpServer, url } from the
 * server; without it the MCP file is left out. */
const AGENT_FILE_NAMES = Object.freeze(["AGENTS.md", "CLAUDE.md", ".mcp.json"]);
function agentFiles(info) {
  const server = info && info.mcpServer ? info.mcpServer : null;
  const url = info && info.url ? info.url : "http://127.0.0.1:8751";
  const guide = server ? server.replace(/mcp\/flowstudio_mcp\.py$/, "docs/FLOW_FOR_AI.md") : "docs/FLOW_FOR_AI.md in the FlowStudio folder";
  const agents = `# Working on this project with an AI tool

This project is written in Flow, a statically typed language that compiles
to C. AI models know little Flow, so check everything you write.

## Use FlowStudio's tools

FlowStudio runs on ${url}. Its MCP server (registered in .mcp.json) gives
you these tools:

- flowstudio_flow_guide: the verified Flow guide. Read it before writing Flow.
- flowstudio_check_code: parse and type check Flow without running it.
- flowstudio_run_code: build and run a Flow program and return its output.
- flowstudio_editor_state: the file, selection and errors open in FlowStudio.
- flowstudio_propose_edit: show the user a diff in FlowStudio to accept.

Check every Flow program with flowstudio_check_code. When it has a main
function and opens no window, also run it with flowstudio_run_code, because
some errors only appear when the C compiler builds it. Fix errors until both
pass. Without FlowStudio, \`flow run file.flow\` does the same from a shell.

The guide is also a file: ${guide}

## Flow in brief

- \`function name(a: i32) -> f64 { ... }\`. No semicolons. Comments start with #.
- \`function main() -> i32\` returns 0.
- \`let\` is immutable, \`let mut\` is mutable. \`else if\` is \`elif\`.
- \`for i in 0 to n\` counts 0 to n - 1. There is no for-each over arrays.
- Arrays have a fixed size: \`let mut xs: array<f64, 8> = [0.0]\`. Pass
  \`span<f64>\` to functions and read \`.len\`. There is no length() or push().
- \`println("x =", x)\` takes several values. println of an array prints a
  pointer, so loop over it.
- Graphics apps import "stdlib/gfx.flow" and "stdlib/text.flow". Check them
  and do not run them, because they open a window.
- In FlowStudio, \`import flowstudio { py, r, py_num, r_num, fmt }\` calls the
  live Python and R sessions.
`;
  const files = [
    { name: "AGENTS.md", language: "markdown", text: agents },
    { name: "CLAUDE.md", language: "markdown", text: "Read AGENTS.md in this folder. It explains how to write and check Flow with FlowStudio's MCP tools.\n" }
  ];
  if (server) {
    files.push({ name: ".mcp.json", language: "json", text: JSON.stringify({ mcpServers: { flowstudio: {
      type: "stdio", command: "python3", args: [server], env: { FLOWSTUDIO_URL: url.replace(/\/$/, "") } } } }, null, 2) + "\n" });
  }
  return files;
}

function slug(name) {
  const base = String(name || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "project";
}
function guessEntry(names) {
  for (const guess of ENTRY_GUESSES) if (names.includes(guess)) return guess;
  return names.find(name => /\.(flow|py|r)$/i.test(name)) || null;
}

/* ---------- the browser's private file system ---------- */
function createLocalStore(storageManager) {
  let rootPromise = null;
  function opfs() {
    if (!storageManager || typeof storageManager.getDirectory !== "function")
      return Promise.reject(new Error("This browser has no private file system for local projects."));
    if (!rootPromise) rootPromise = storageManager.getDirectory();
    return rootPromise;
  }
  async function projectsDir() { return (await opfs()).getDirectoryHandle("projects", { create: true }); }
  async function exists(dir, name) {
    try { await dir.getDirectoryHandle(name); return true; } catch (_) { return false; }
  }
  async function writeFiles(dir, files, overwrite) {
    for (const file of files) {
      let handle = null;
      if (!overwrite) { try { handle = await dir.getFileHandle(file.name); continue; } catch (_) { handle = null; } }
      handle = await dir.getFileHandle(file.name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file.text);
      await writable.close();
    }
  }
  return {
    available: () => Boolean(storageManager && typeof storageManager.getDirectory === "function"),
    async create(name, files) {
      const dir = await projectsDir();
      let folder = slug(name), n = 1;
      while (await exists(dir, folder)) folder = slug(name) + "-" + (++n);
      const handle = await dir.getDirectoryHandle(folder, { create: true });
      await writeFiles(handle, files, true);
      return handle;
    },
    /* An example keeps one folder; files the user edited are left alone. */
    async example(id, files) {
      const dir = await projectsDir();
      const handle = await dir.getDirectoryHandle(slug(id), { create: true });
      await writeFiles(handle, files, false);
      return handle;
    },
    async reset(handle, files) { await writeFiles(handle, files, true); },
    async isLocal(handle) {
      try { return Boolean(handle && await (await opfs()).resolve(handle)); } catch (_) { return false; }
    }
  };
}

function mount(doc, options = {}) {
  const el = id => doc.getElementById(id);
  const app = () => options.app || root.FlowStudioApp || null;
  const explorer = () => options.explorer || root.FlowStudioWorkspaceExplorer || null;
  const local = options.localStore || createLocalStore(root.navigator && root.navigator.storage);
  const agentInfo = options.agentInfo || (async () => {
    const assistant = root.FlowStudioAssistant;
    if (!assistant) return null;
    await assistant.ready;
    return assistant.info();
  });
  let storage = options.storage;
  if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }
  const switcher = el("projectSwitcher"), nameNode = el("projectName"), menu = el("projectMenu");
  const listeners = new Set();
  let current = null;           // { name, handle, local, meta }
  let pending = null;           // { entry, meta, openAll } for the next root change
  let recents = [];
  let localNames = new Set();

  function status(message, kind) { const a = app(); if (a && a.status) a.status(message, kind); }
  function readMeta(name) {
    try { return JSON.parse((storage && storage.getItem(META_KEY + name)) || "null"); } catch (_) { return null; }
  }
  function writeMeta(name, meta) {
    try { if (storage) storage.setItem(META_KEY + name, JSON.stringify(meta)); } catch (_) { /* optional */ }
  }
  function render() {
    if (nameNode) nameNode.textContent = current ? current.name : "No project";
    if (switcher) switcher.dataset.local = current && current.local ? "true" : "false";
    if (doc.title !== undefined) doc.title = current ? current.name + " - FlowStudio" : "FlowStudio";
  }

  /* ---------- confirm before leaving a project with unsaved work ---------- */
  function ask(message, choices) {
    const dialog = el("projectDialog");
    if (!dialog || typeof dialog.showModal !== "function")
      return Promise.resolve(root.confirm && root.confirm(message) ? choices[0].value : "cancel");
    const text = el("projectDialogText"), actions = el("projectDialogActions");
    text.textContent = message;
    actions.replaceChildren();
    return new Promise(resolve => {
      for (const choice of choices) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        if (choice.primary) button.className = "primary";
        button.addEventListener("click", () => { dialog.close(); resolve(choice.value); });
        actions.append(button);
      }
      dialog.addEventListener("cancel", () => resolve("cancel"), { once: true });
      dialog.showModal();
      const first = actions.querySelector(".primary") || actions.firstChild;
      if (first) first.focus();
    });
  }
  let approved = false;   // the user already agreed to leave for this switch
  async function beforeSwitch() {
    if (approved) { approved = false; return true; }
    const a = app();
    if (!a) return true;
    if (a.saveEditorBuffer) a.saveEditorBuffer();
    const dirty = a.documents.list().filter(item => item.dirty);
    if (!dirty.length) return true;
    const saveable = dirty.filter(item => item.handle && typeof item.handle.createWritable === "function");
    const scratch = dirty.filter(item => !saveable.includes(item));
    const names = dirty.map(item => item.path || item.name).slice(0, 6).join(", ");
    let message = dirty.length + (dirty.length === 1 ? " file has" : " files have") + " unsaved changes: " + names + ".";
    if (scratch.length) message += " Untitled buffers are not kept when you switch projects.";
    const choice = await ask(message, [
      ...(saveable.length ? [{ label: "Save and switch", value: "save", primary: true }] : []),
      { label: saveable.length ? "Discard changes" : "Discard and switch", value: "discard", primary: !saveable.length },
      { label: "Cancel", value: "cancel" }
    ]);
    if (choice === "cancel") return false;
    if (choice === "save" && a.saveAllDocuments) {
      try { await a.saveAllDocuments(); }
      catch (error) { status("Could not save: " + (error.message || error), "error"); return false; }
    }
    return true;
  }

  /* ---------- the switch itself (called by the workspace on root change) ---------- */
  /* The explorer does not wait for this, so callers that open a project
   * wait on lastSwitch before touching its tabs. */
  let lastSwitch = Promise.resolve();
  function rootChanged(handle, restoreEditors) {
    lastSwitch = switchTo(handle, restoreEditors);
    return lastSwitch;
  }
  async function switchTo(handle, restoreEditors) {
    const a = app();
    const plan = pending;
    pending = null;
    if (a && a.closeAllDocuments) a.closeAllDocuments();
    if (root.FlowStudioAppPreview && root.FlowStudioAppPreview.running()) root.FlowStudioAppPreview.stop();
    if (!handle) {
      current = null;
      render();
      if (a) a.createUntitled();
      emit();
      return;
    }
    const isLocal = await local.isLocal(handle);
    if (plan && plan.meta) writeMeta(handle.name, plan.meta);
    current = { name: handle.name, handle, local: isLocal, meta: plan && plan.meta ? plan.meta : readMeta(handle.name) };
    if (isLocal) localNames.add(handle.name);
    render();
    let opened = 0;
    if (plan && plan.openAll && a) {
      for (const name of plan.openAll) {
        try { if (await a.openEditorHandle(await handle.getFileHandle(name), handle.name + "/" + name)) opened++; }
        catch (_) { /* a file the user deleted is skipped */ }
      }
    } else if (restoreEditors) opened = await restoreEditors(handle);
    const entry = plan && plan.entry;
    if (a && (!opened || entry)) {
      const names = [];
      if (handle.values) for await (const item of handle.values()) if (item.kind === "file") names.push(item.name);
      const target = entry && names.includes(entry) ? entry : (!opened ? guessEntry(names) : null);
      const path = target ? handle.name + "/" + target : null;
      const already = path && a.documents.list().find(item => item.path === path);
      if (already) a.activateDocument(already.id);
      else if (target) {
        try { await a.openEditorHandle(await handle.getFileHandle(target), path); opened++; }
        catch (_) { /* unreadable entry */ }
      }
    }
    if (a && !a.documents.count()) a.createUntitled();
    status("Opened project " + handle.name, "ok");
    emit();
  }
  function emit() { for (const listener of listeners) { try { listener(current); } catch (_) {} } }

  /* ---------- opening ---------- */
  async function openHandle(handle, plan) {
    const ex = explorer();
    if (!ex) { status("The explorer is still loading.", "error"); return false; }
    pending = plan || null;
    const ok = await ex.setRoot(handle);
    if (!ok) { pending = null; return false; }
    await lastSwitch;
    return true;
  }
  async function createProject({ name, template, location }) {
    const spec = TEMPLATES.find(item => item.id === template) || TEMPLATES[0];
    const files = spec.files();
    if (!files.length) throw new Error("That template has no files.");
    let info = null;
    try { info = await agentInfo(); } catch (_) { info = null; }
    const written = files.concat(agentFiles(info).filter(extra => !files.some(file => file.name === extra.name)));
    let handle;
    if (location === "disk") {
      if (typeof root.showDirectoryPicker !== "function") throw new Error("This browser cannot create folders on disk.");
      const parent = await root.showDirectoryPicker({ mode: "readwrite", id: "flowstudio-new-project" });
      let folder = slug(name), n = 1;
      for (;;) {
        try { await parent.getDirectoryHandle(folder); folder = slug(name) + "-" + (++n); }
        catch (_) { break; }
      }
      handle = await parent.getDirectoryHandle(folder, { create: true });
      for (const file of written) {
        const fileHandle = await handle.getFileHandle(file.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(file.text);
        await writable.close();
      }
    } else handle = await local.create(name, written);
    const meta = { template: spec.id, files: files.map(file => file.name), runProject: Boolean(spec.runProject) };
    return openHandle(handle, { entry: spec.entry || files[0].name, meta,
      openAll: files.length <= 4 ? files.map(file => file.name) : null });
  }
  async function openExample(example) {
    if (!example || !Array.isArray(example.files) || !example.files.length) return false;
    const handle = await local.example(example.id, example.files);
    const meta = { example: example.id, title: example.title, files: example.files.map(file => file.name),
      runner: example.runner || null, runProject: Boolean(example.runProject) };
    const same = current && current.handle && current.handle.isSameEntry && await current.handle.isSameEntry(handle).catch(() => false);
    if (same) {
      writeMeta(handle.name, meta);
      current.meta = meta;
      const a = app();
      const entryPath = handle.name + "/" + example.files[0].name;
      const doc_ = a && a.documents.list().find(item => item.path === entryPath);
      if (doc_) a.activateDocument(doc_.id);
      else if (a) await a.openEditorHandle(await handle.getFileHandle(example.files[0].name), entryPath);
      return true;
    }
    return openHandle(handle, { entry: example.files[0].name, meta,
      openAll: example.files.map(file => file.name) });
  }
  async function closeProject() {
    const ex = explorer();
    if (!current || !ex) return false;
    return ex.close();
  }
  /* Steps for Run project: the project's declared file order. */
  function runPlan() {
    const a = app();
    if (!current || !current.meta || !Array.isArray(current.meta.files) || !a) return null;
    const steps = [];
    for (const name of current.meta.files) {
      const doc_ = a.documents.list().find(item => item.path === current.name + "/" + name);
      if (doc_) steps.push({ id: doc_.id, name, language: doc_.language });
    }
    return steps.length ? { id: current.meta.example || current.name, title: current.meta.title || current.name, steps } : null;
  }

  /* ---------- the New Project dialog ---------- */
  function newProject(templateId) {
    const dialog = el("newProjectDialog");
    if (!dialog || typeof dialog.showModal !== "function") return false;
    const list = el("npTemplates"), nameInput = el("npName"), error = el("npError");
    const diskOption = el("npLocationDisk");
    if (diskOption) diskOption.disabled = typeof root.showDirectoryPicker !== "function";
    let chosen = TEMPLATES.find(item => item.id === templateId) || TEMPLATES[0];
    list.replaceChildren();
    for (const spec of TEMPLATES) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "np-template";
      button.setAttribute("role", "radio");
      button.dataset.template = spec.id;
      const title = doc.createElement("span");
      title.className = "np-template-title";
      title.textContent = spec.title;
      const detail = doc.createElement("span");
      detail.className = "np-template-detail";
      detail.textContent = spec.detail;
      button.append(title, detail);
      button.addEventListener("click", () => { chosen = spec; sync(); });
      button.addEventListener("dblclick", () => { chosen = spec; sync(); void submit(); });
      list.append(button);
    }
    function sync() {
      for (const button of list.children) {
        const on = button.dataset.template === chosen.id;
        button.setAttribute("aria-checked", on ? "true" : "false");
        button.tabIndex = on ? 0 : -1;
      }
      if (!nameInput.dataset.edited) nameInput.value = chosen.id === "flow-app" ? "my-flow-app" :
        chosen.id === "polyglot" ? "polyglot-pipeline" : "my-" + chosen.id + "-project";
    }
    nameInput.dataset.edited = "";
    nameInput.oninput = () => { nameInput.dataset.edited = "true"; };
    error.hidden = true;
    sync();
    async function submit() {
      const location = diskOption && diskOption.checked ? "disk" : "local";
      error.hidden = true;
      /* Ask before creating anything, so a cancel leaves no folder behind. */
      if (!(await beforeSwitch())) return;
      approved = true;
      try {
        dialog.close();
        await createProject({ name: nameInput.value, template: chosen.id, location });
      } catch (failure) {
        approved = false;
        if (failure && failure.name === "AbortError") return;
        error.textContent = failure.message || String(failure);
        error.hidden = false;
        if (!dialog.open) dialog.showModal();
      }
    }
    el("npCreate").onclick = () => void submit();
    el("npCancel").onclick = () => dialog.close();
    dialog.onkeydown = event => {
      if (event.key === "Enter" && event.target.tagName !== "BUTTON") { event.preventDefault(); void submit(); }
    };
    dialog.showModal();
    nameInput.select();
    return true;
  }

  /* ---------- the switcher menu ---------- */
  async function refreshRecents() {
    const ex = explorer();
    recents = ex ? ex.recents() : [];
    for (const item of recents) if (item.handle && await local.isLocal(item.handle)) localNames.add(item.name);
  }
  function menuItem(label, onClick, extra) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    if (extra) {
      const tag = doc.createElement("span");
      tag.className = "pm-tag";
      tag.textContent = extra;
      button.append(tag);
    }
    button.addEventListener("click", () => { closeMenu(); onClick(); });
    return button;
  }
  function closeMenu() {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    switcher.setAttribute("aria-expanded", "false");
  }
  async function openMenu() {
    await refreshRecents();
    menu.replaceChildren();
    menu.append(menuItem("New project…", () => newProject()));
    menu.append(menuItem("Open folder…", async () => {
      const ex = explorer();
      if (ex) { pending = null; await ex.choose(); }
    }));
    if (current) menu.append(menuItem("Close project", () => void closeProject()));
    const others = recents.filter(item => !current || item.name !== current.name).slice(0, 8);
    if (others.length) {
      const label = doc.createElement("div");
      label.className = "menu-label";
      label.textContent = "Recent";
      menu.append(doc.createElement("hr"), label);
      for (const item of others)
        menu.append(menuItem(item.name, () => void openRecent(item), localNames.has(item.name) ? "local" : "disk"));
    }
    menu.hidden = false;
    switcher.setAttribute("aria-expanded", "true");
    const first = menu.querySelector("[role='menuitem']");
    if (first) first.focus();
  }
  async function openRecent(item) {
    const ex = explorer();
    if (!ex || !item) return false;
    return ex.reopen(item);
  }
  if (switcher && menu) {
    switcher.addEventListener("click", event => {
      event.stopPropagation();
      if (menu.hidden) void openMenu(); else closeMenu();
    });
    doc.addEventListener("click", event => { if (!menu.contains(event.target)) closeMenu(); });
    menu.addEventListener("keydown", event => {
      const items = Array.from(menu.querySelectorAll("[role='menuitem']"));
      const index = items.indexOf(doc.activeElement);
      if (event.key === "Escape") { closeMenu(); switcher.focus(); }
      else if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length].focus(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    });
  }

  /* Reopen the last project when the browser still grants access to it. */
  async function restoreLast() {
    const a = app(), ex = explorer();
    if (!a || !ex || ex.hasRoot()) return false;
    if (a.documents.list().some(item => item.dirty)) return false;
    await refreshRecents();
    const last = recents[0];
    if (!last || !last.handle) return false;
    try {
      if (typeof last.handle.queryPermission === "function" &&
          (await last.handle.queryPermission({ mode: "readwrite" })) !== "granted") return false;
      return await ex.setRoot(last.handle);
    } catch (_) { return false; }
  }

  render();
  return Object.freeze({
    TEMPLATES, newProject, createProject, openExample, closeProject, openRecent, restoreLast,
    beforeSwitch, rootChanged, runPlan, refreshRecents,
    recents: () => recents.slice(),
    current: () => (current ? { name: current.name, local: current.local, meta: current.meta } : null),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  });
}

const api = Object.freeze({ mount, createLocalStore, TEMPLATES, slug, guessEntry, agentFiles, AGENT_FILE_NAMES });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioProjectsModule = api;
if (typeof document !== "undefined" && document.getElementById("projectSwitcher")) {
  try {
    root.FlowStudioProjects = mount(document, {});
    const restore = () => {
      if (!root.FlowStudioWorkspaceExplorer || !root.FlowStudioApp) { setTimeout(restore, 100); return; }
      void root.FlowStudioProjects.restoreLast();
    };
    setTimeout(restore, 300);
  } catch (error) {
    if (root.console) root.console.error("FlowStudio projects failed to mount: " + (error && error.message));
  }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
