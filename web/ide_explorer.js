/* FlowStudio workspace explorer.
 *
 * A file tree for a browser-granted project folder, modelled on the VS Code
 * explorer and the JetBrains project view: lazy folders, keyboard navigation
 * (WAI-ARIA tree pattern), type-ahead selection, inline create and rename,
 * a context menu, drag-and-drop moves, open/modified decorations, and a
 * remembered list of recent folders.
 *
 * All file access goes through the File System Access API handles the user
 * granted. Nothing is sent to the native server. Writes reuse the checked
 * FlowStudioProjectCreate / FlowStudioProjectRename / FlowStudioFileSave
 * modules, so the explorer adds no new write path of its own except
 * directory removal and verified cross-folder moves.
 */
(function (global) {
"use strict";

const HIDDEN = new Set([".git", ".DS_Store", "Thumbs.db"]);
const MAX_ENTRIES = 500;
const MAX_DEPTH = 12;
const MAX_RECENT = 6;
const TYPEAHEAD_MS = 900;
const EXPANDED_KEY = "flowstudio.explorer.expanded.v1:";

/* ---------- pure helpers ---------- */

const KINDS = [
  [/\.flow$/i, "Fl", "flow"],
  [/\.(r|rproj)$/i, "R", "r"],
  [/\.py$/i, "Py", "python"],
  [/\.(rmd|qmd|md)$/i, "M", "markdown"],
  [/\.(csv|tsv)$/i, "T", "data"],
  [/\.(json|toml|ya?ml)$/i, "{}", "config"],
  [/\.txt$/i, "Tx", "text"]
];
function fileBadge(name) {
  for (const [pattern, label, tone] of KINDS) if (pattern.test(name)) return { label, tone };
  return { label: "", tone: "other" };
}
function compareEntries(a, b) {
  const folder = (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1);
  if (folder) return folder;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
function joinRel(parentRel, name) { return parentRel ? parentRel + "/" + name : name; }
function parentRel(rel) {
  const index = rel.lastIndexOf("/");
  return index < 0 ? "" : rel.slice(0, index);
}

function makeNode(name, kind, handle, parent) {
  return {
    name, kind, handle, parent,
    rel: parent ? joinRel(parent.rel, name) : "",
    depth: parent ? parent.depth + 1 : 0,
    children: null, expanded: !parent, loading: null, truncated: false
  };
}
function createTree(rootHandle) {
  if (!rootHandle || rootHandle.kind !== "directory")
    throw new Error("Choose a folder to open as the workspace.");
  return makeNode(rootHandle.name, "directory", rootHandle, null);
}

/* Reads one directory level. Children keep identity across reloads so the
 * expansion state of unchanged subfolders survives a refresh. */
async function loadChildren(node) {
  if (node.kind !== "directory") return [];
  if (node.depth >= MAX_DEPTH) { node.children = []; node.truncated = true; return node.children; }
  const previous = new Map((node.children || []).map(child => [child.name + "\0" + child.kind, child]));
  const entries = [];
  let truncated = false;
  for await (const [name, handle] of node.handle.entries()) {
    if (HIDDEN.has(name)) continue;
    if (entries.length >= MAX_ENTRIES) { truncated = true; break; }
    if (handle.kind !== "file" && handle.kind !== "directory") continue;
    const kept = previous.get(name + "\0" + handle.kind);
    if (kept) { kept.handle = handle; entries.push(kept); }
    else entries.push(makeNode(name, handle.kind, handle, node));
  }
  entries.sort(compareEntries);
  node.children = entries;
  node.truncated = truncated;
  return entries;
}

function visibleRows(root) {
  const rows = [];
  (function walk(node) {
    for (const child of node.children || []) {
      rows.push(child);
      if (child.kind === "directory" && child.expanded) walk(child);
    }
  })(root);
  return rows;
}
function findByRel(root, rel) {
  if (!rel) return root;
  let node = root;
  for (const part of rel.split("/")) {
    node = (node.children || []).find(child => child.name === part);
    if (!node) return null;
  }
  return node;
}
/* VS Code style type-ahead: the next row after the current one whose name
 * starts with the typed prefix, wrapping, case-insensitive. */
function typeAheadIndex(rows, currentIndex, prefix) {
  if (!prefix || !rows.length) return -1;
  const wanted = prefix.toLocaleLowerCase();
  const start = prefix.length > 1 ? Math.max(currentIndex, 0) : currentIndex + 1;
  for (let step = 0; step < rows.length; step++) {
    const index = (start + step + rows.length) % rows.length;
    if (rows[index].name.toLocaleLowerCase().startsWith(wanted)) return index;
  }
  return -1;
}
function isInside(rel, folderRel) {
  return folderRel === "" || rel === folderRel || rel.startsWith(folderRel + "/");
}

/* ---------- file operations over granted handles ---------- */

async function exists(directory, name) {
  try { await directory.getFileHandle(name); return true; }
  catch (error) {
    if (error && error.name === "NotFoundError") return false;
    if (error && error.name === "TypeMismatchError") return true;
    throw error;
  }
}
async function sameEntry(a, b) {
  if (a && typeof a.isSameEntry === "function") return a.isSameEntry(b);
  return a === b;
}

/* Move one file into another folder. Uses the atomic handle.move() where the
 * browser offers it; otherwise copy, verify, then remove the original. On an
 * ambiguous failure after the copy, both files are kept. */
async function moveFile({ from, handle, name, to, fileSave }) {
  if (!from || !to || from.kind !== "directory" || to.kind !== "directory")
    throw new Error("Move needs a source and a destination folder.");
  if (await sameEntry(from, to)) return { handle, moved: false };
  if (await exists(to, name)) throw new Error("\"" + name + "\" already exists in the destination folder.");
  if (typeof handle.move === "function") {
    try {
      await handle.move(to, name);
      return { handle, moved: true };
    } catch (error) {
      if (!error || (error.name !== "NotSupportedError" && error.name !== "NotAllowedError" &&
          error.name !== "TypeError")) throw error;
    }
  }
  const baseline = await fileSave.readSnapshot(handle);
  const destination = await to.getFileHandle(name, { create: true });
  let copied = false;
  try {
    await fileSave.writeIfUnchanged(destination, "", baseline);
    copied = true;
    if (await fileSave.readSnapshot(destination) !== baseline)
      throw new Error("Copied file could not be verified; original kept.");
    const current = await from.getFileHandle(name);
    if (!(await sameEntry(current, handle)) || await fileSave.readSnapshot(current) !== baseline)
      throw new Error("Source changed during the move; original kept.");
    await from.removeEntry(name);
    return { handle: destination, moved: true };
  } catch (error) {
    if (copied) throw new Error("Move incomplete; check both copies of \"" + name + "\". " +
      (error.message || String(error)), { cause: error });
    try { if (await fileSave.readSnapshot(destination) === "") await to.removeEntry(name); }
    catch (_) { /* keep the original failure */ }
    throw error;
  }
}
async function countEntries(directory, limit = 2000) {
  let files = 0, folders = 0;
  const stack = [directory];
  while (stack.length && files + folders < limit) {
    const current = stack.pop();
    for await (const [, handle] of current.entries()) {
      if (handle.kind === "directory") { folders++; stack.push(handle); }
      else files++;
      if (files + folders >= limit) break;
    }
  }
  return { files, folders, capped: files + folders >= limit };
}

/* Folder rename and move. File System Access only offers handle.move() in
 * some browsers, and not for user folders in Chromium today, so the fallback
 * copies the folder byte for byte into a new one, verifies every file, and
 * only then removes the original. Any failure before that point removes the
 * partial copy and leaves the original untouched. */
const MAX_FOLDER_ENTRIES = 1000;
const MAX_FOLDER_BYTES = 64 * 1024 * 1024;
async function readBytes(handle) {
  const file = await handle.getFile();
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new TextEncoder().encode(await file.text());
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function copyFolderContents(source, destination, budget) {
  for await (const [name, handle] of source.entries()) {
    if (++budget.entries > MAX_FOLDER_ENTRIES)
      throw new Error("Folder has more than " + MAX_FOLDER_ENTRIES + " entries; move it outside FlowStudio.");
    if (handle.kind === "directory") {
      const child = await destination.getDirectoryHandle(name, { create: true });
      await copyFolderContents(handle, child, budget);
      continue;
    }
    const bytes = await readBytes(handle);
    budget.bytes += bytes.length;
    if (budget.bytes > MAX_FOLDER_BYTES)
      throw new Error("Folder is larger than 64 MB; move it outside FlowStudio.");
    const target = await destination.getFileHandle(name, { create: true });
    const writer = await target.createWritable();
    try { await writer.write(bytes); await writer.close(); }
    catch (error) {
      if (typeof writer.abort === "function") { try { await writer.abort(); } catch (_) { /* keep error */ } }
      throw error;
    }
    if (!sameBytes(await readBytes(target), bytes))
      throw new Error("Copied file could not be verified: " + name);
  }
}
async function moveFolder({ from, handle, name, to, nextName = name }) {
  if (!from || !to || from.kind !== "directory" || to.kind !== "directory" || !handle || handle.kind !== "directory")
    throw new Error("Folder move needs a folder, its parent and a destination.");
  if (await exists(to, nextName)) throw new Error("\"" + nextName + "\" already exists there.");
  if (typeof handle.move === "function") {
    try {
      if (await sameEntry(from, to)) await handle.move(nextName);
      else await handle.move(to, nextName);
      return { handle, copied: false };
    } catch (error) {
      if (!error || (error.name !== "NotSupportedError" && error.name !== "NotAllowedError" &&
          error.name !== "TypeError" && error.name !== "InvalidModificationError")) throw error;
    }
  }
  const created = await to.getDirectoryHandle(nextName, { create: true });
  try {
    await copyFolderContents(handle, created, { entries: 0, bytes: 0 });
  } catch (error) {
    try { await to.removeEntry(nextName, { recursive: true }); } catch (_) { /* report the copy failure */ }
    throw error;
  }
  try { await from.removeEntry(name, { recursive: true }); }
  catch (error) {
    throw new Error("Copied \"" + name + "\" to \"" + nextName + "\" but could not remove the original. " +
      "Both folders are kept. " + (error.message || String(error)), { cause: error });
  }
  return { handle: created, copied: true };
}

/* ---------- recent folders (IndexedDB holds the granted handles) ---------- */

function createHandleStore(indexedDB, dbName = "flowstudio-explorer") {
  const STORE = "recent";
  function open() {
    return new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function run(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  return {
    async list() {
      try { const value = await run("readonly", store => store.get("folders")); return Array.isArray(value) ? value : []; }
      catch (_) { return []; }
    },
    async remember(handle) {
      const list = await this.list();
      const kept = [];
      for (const item of list) {
        if (!item || !item.handle) continue;
        let same = false;
        try { same = await sameEntry(item.handle, handle); } catch (_) { same = false; }
        if (!same) kept.push(item);
      }
      const next = [{ handle, name: handle.name, opened: Date.now() }, ...kept].slice(0, MAX_RECENT);
      try { await run("readwrite", store => store.put(next, "folders")); } catch (_) { /* optional */ }
      return next;
    },
    async forget(handle) {
      const list = await this.list();
      const kept = [];
      for (const item of list) {
        let same = false;
        try { same = await sameEntry(item.handle, handle); } catch (_) { same = false; }
        if (!same) kept.push(item);
      }
      try { await run("readwrite", store => store.put(kept, "folders")); } catch (_) { /* optional */ }
      return kept;
    }
  };
}

/* ---------- icons (static, trusted markup) ---------- */

const SVG = (body) => '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + "</svg>";
const ICONS = {
  chevron: SVG('<path d="M6 4l4 4-4 4"/>'),
  folder: SVG('<path d="M1.8 4.2c0-.6.5-1 1-1h3.1l1.4 1.5h5.9c.6 0 1 .4 1 1v6.6c0 .6-.4 1-1 1H2.8c-.5 0-1-.4-1-1z"/>'),
  folderOpen: SVG('<path d="M1.8 12.3V4.2c0-.6.5-1 1-1h3.1l1.4 1.5h5c.6 0 1 .4 1 1v1.2"/><path d="M1.8 12.3l1.9-4.6c.2-.4.5-.6.9-.6h9.6c.5 0 .8.5.6.9l-1.7 4.3c-.2.4-.5.6-.9.6H2.8"/>'),
  file: SVG('<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>'),
  newFile: SVG('<path d="M3.5 1.8h5l3 3v4.4"/><path d="M8.5 1.8v3h3"/><path d="M3.5 1.8v12.4h5"/><path d="M12 10.5v4M10 12.5h4"/>'),
  newFolder: SVG('<path d="M14.2 8.2V5.7c0-.6-.4-1-1-1H7.3L5.9 3.2H2.8c-.5 0-1 .4-1 1v8.1c0 .6.5 1 1 1h6"/><path d="M12.3 10v4.4M10.1 12.2h4.4"/>'),
  refresh: SVG('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.2v3h-3"/>'),
  collapse: SVG('<path d="M5 6.5L8 3.5l3 3M5 9.5l3 3 3-3"/>'),
  more: SVG('<circle cx="3.5" cy="8" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="12.5" cy="8" r=".6" fill="currentColor"/>'),
  close: SVG('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>')
};

/* ---------- controller ---------- */

function mount(options) {
  const doc = options.doc || global.document;
  const host = options.host;
  if (!host) throw new Error("Explorer host element is missing.");
  const status = options.status || (() => {});
  const openHandle = options.openHandle;
  const listDocuments = options.listDocuments || (() => []);
  const activePath = options.activePath || (() => null);
  const onRootChanged = options.onRootChanged || (() => {});
  const onEntryMoved = options.onEntryMoved || (() => {});
  const onEntryDeleted = options.onEntryDeleted || (() => {});
  const picker = options.picker || null;
  const createApi = options.createApi;
  const renameApi = options.renameApi;
  const fileSave = options.fileSave;
  const validFilename = options.validFilename || (() => true);
  const confirmChange = options.confirm || (message => global.confirm(message));
  const clipboard = options.clipboard || null;
  const storage = options.storage || null;
  const handles = options.handleStore || null;

  let tree = null;
  let focusedRel = null;
  let editing = null;           // {mode:"new-file"|"new-folder"|"rename", folder, node}
  let menu = null;
  let typed = "", typedAt = 0;
  let dragRel = null;
  let renderToken = 0;
  let recents = [];

  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = (name, className) => {
    const span = el("span", "ex-icon" + (className ? " " + className : ""));
    span.innerHTML = ICONS[name];
    return span;
  };
  const report = error => {
    if (error && error.name === "AbortError") return;
    status((error && error.message) || String(error), "error");
  };
  const fullPath = node => tree.name + (node.rel ? "/" + node.rel : "");

  /* Layout: header (root name + actions), tree, empty state. */
  host.replaceChildren();
  host.classList.add("explorer");
  const header = el("div", "ex-header");
  const title = el("button", "ex-title");
  title.type = "button";
  const titleChevron = icon("chevron", "ex-chevron open");
  const titleText = el("span", "ex-title-text", "No folder opened");
  title.append(titleChevron, titleText);
  const actions = el("div", "ex-actions");
  actions.setAttribute("role", "toolbar");
  actions.setAttribute("aria-label", "Explorer actions");
  function action(name, label, run) {
    const button = el("button", "ex-action");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.action = name;
    button.append(icon(name === "newFile" ? "newFile" : name === "newFolder" ? "newFolder" :
      name === "refresh" ? "refresh" : name === "collapse" ? "collapse" : "more"));
    button.addEventListener("click", event => { event.stopPropagation(); run(event); });
    actions.append(button);
    return button;
  }
  action("newFile", "New file", () => beginCreate("new-file"));
  action("newFolder", "New folder", () => beginCreate("new-folder"));
  action("refresh", "Refresh explorer", () => void refresh());
  action("collapse", "Collapse folders", () => collapseAll());
  action("more", "More explorer actions", event => openMenu(null, event.currentTarget));
  header.append(title, actions);

  const list = el("ul", "ex-tree");
  list.setAttribute("role", "tree");
  list.setAttribute("aria-label", "Project files");
  list.tabIndex = 0;
  const empty = el("div", "ex-empty");
  const hint = el("div", "ex-typeahead");
  hint.hidden = true;
  hint.setAttribute("aria-live", "polite");
  host.append(header, list, empty, hint);

  title.addEventListener("click", () => {
    if (!tree) return;
    tree.expanded = !tree.expanded;
    render();
  });

  /* ---------- rendering ---------- */

  function openDocs() {
    const byPath = new Map();
    for (const item of listDocuments()) if (item && item.path) byPath.set(item.path, item);
    return byPath;
  }
  function rowId(index) { return "ex-row-" + index; }

  function render() {
    const token = ++renderToken;
    const hasRoot = !!tree;
    host.classList.toggle("has-root", hasRoot);
    for (const button of actions.querySelectorAll(".ex-action"))
      button.disabled = !hasRoot && button.dataset.action !== "more";
    titleText.textContent = hasRoot ? tree.name : "No folder opened";
    title.title = hasRoot ? tree.name : "";
    titleChevron.classList.toggle("open", hasRoot && tree.expanded);
    title.setAttribute("aria-expanded", String(hasRoot && tree.expanded));
    empty.hidden = hasRoot;
    list.hidden = !hasRoot || !tree.expanded;
    if (!hasRoot) { renderEmpty(); list.replaceChildren(); return; }

    const docs = openDocs();
    const active = activePath();
    const rows = visibleRows(tree);
    if (focusedRel !== null && !rows.some(row => row.rel === focusedRel))
      focusedRel = rows.length ? rows[0].rel : null;
    const items = [];
    if (editing && editing.mode !== "rename" && editing.folder === tree)
      items.push(inputRow(tree, 0));
    rows.forEach((node, index) => {
      if (token !== renderToken) return;
      const li = el("li", "ex-row");
      li.id = rowId(index);
      li.setAttribute("role", "treeitem");
      li.setAttribute("aria-level", String(node.depth));
      li.setAttribute("aria-selected", String(node.rel === focusedRel));
      li.dataset.rel = node.rel;
      li.dataset.kind = node.kind;
      li.style.setProperty("--depth", String(node.depth - 1));
      li.draggable = true;
      li.title = fullPath(node);
      if (node.kind === "directory") {
        li.setAttribute("aria-expanded", String(node.expanded));
        li.append(icon("chevron", "ex-chevron" + (node.expanded ? " open" : "")),
          icon(node.expanded ? "folderOpen" : "folder", "ex-folder"));
      } else {
        const badge = fileBadge(node.name);
        const glyph = el("span", "ex-badge tone-" + badge.tone, badge.label);
        if (!badge.label) { glyph.textContent = ""; glyph.append(icon("file")); }
        li.append(el("span", "ex-chevron-space"), glyph);
        if (!validFilename(node.name)) li.classList.add("unsupported");
      }
      if (editing && editing.mode === "rename" && editing.node === node) {
        li.append(inputField(node.name));
      } else {
        li.append(el("span", "ex-name", node.name));
      }
      const path = fullPath(node);
      const opened = docs.get(path);
      if (node.kind === "file" && opened) {
        li.classList.add("is-open");
        if (opened.dirty) {
          li.classList.add("is-dirty");
          const dot = el("span", "ex-dirty", "M");
          dot.title = "Unsaved changes";
          li.append(dot);
        }
      }
      if (node.kind === "directory") {
        let dirty = false;
        for (const [docPath, item] of docs) if (item.dirty && docPath.startsWith(path + "/")) dirty = true;
        if (dirty) { const dot = el("span", "ex-dirty-dot"); dot.title = "Contains unsaved files"; li.append(dot); }
      }
      if (active && path === active) li.classList.add("is-active");
      if (node.rel === dragRel) li.classList.add("is-dragging");
      items.push(li);
      if (node.kind === "directory" && node.expanded) {
        if (editing && editing.mode !== "rename" && editing.folder === node)
          items.push(inputRow(node, node.depth));
        if (node.loading && !node.children) items.push(noteRow("Loading...", node.depth));
        else if (node.children && !node.children.length && !(editing && editing.folder === node))
          items.push(noteRow("Empty folder", node.depth));
        if (node.truncated) items.push(noteRow(node.depth >= MAX_DEPTH ? "Folder depth limit reached" :
          "First " + MAX_ENTRIES + " entries shown", node.depth));
      }
    });
    if (!rows.length && !(editing && editing.folder === tree))
      items.push(noteRow(tree.loading ? "Loading..." : "This folder is empty. Use New file to start.", 0));
    list.replaceChildren(...items);
    const focusIndex = rows.findIndex(row => row.rel === focusedRel);
    if (focusIndex >= 0) list.setAttribute("aria-activedescendant", rowId(focusIndex));
    else list.removeAttribute("aria-activedescendant");
    const input = list.querySelector(".ex-input");
    if (input) { input.focus(); if (editing && editing.mode === "rename") selectStem(input); }
  }
  function noteRow(text, depth) {
    const li = el("li", "ex-note", text);
    li.setAttribute("role", "none");
    li.style.setProperty("--depth", String(depth));
    return li;
  }
  function selectStem(input) {
    const dot = input.value.lastIndexOf(".");
    try { input.setSelectionRange(0, dot > 0 ? dot : input.value.length); } catch (_) { /* fake DOM */ }
  }
  function inputRow(folder, depth) {
    const li = el("li", "ex-row ex-editing");
    li.setAttribute("role", "none");
    li.style.setProperty("--depth", String(depth));
    li.append(el("span", "ex-chevron-space"),
      editing.mode === "new-folder" ? icon("folder", "ex-folder") : icon("file"),
      inputField(""));
    return li;
  }
  function inputField(initial) {
    const wrap = el("span", "ex-input-wrap");
    const input = el("input", "ex-input");
    input.type = "text";
    input.value = initial;
    input.spellcheck = false;
    input.setAttribute("aria-label", editing.mode === "rename" ? "New name" :
      editing.mode === "new-folder" ? "New folder name" : "New file name");
    const message = el("span", "ex-input-error");
    message.hidden = true;
    message.setAttribute("role", "alert");
    let committed = false;
    function validate() {
      const problem = problemWith(input.value);
      message.hidden = !problem;
      message.textContent = problem || "";
      input.setAttribute("aria-invalid", String(!!problem && input.value.length > 0));
      return problem;
    }
    input.addEventListener("input", validate);
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); committed = true; void commit(input.value, validate); }
      else if (event.key === "Escape") { event.preventDefault(); committed = true; cancelEdit(); }
    });
    input.addEventListener("blur", () => {
      if (committed || !editing) return;
      committed = true;
      // VS Code commits a valid name on blur and drops an empty or invalid one.
      if (input.value.trim() && !problemWith(input.value)) void commit(input.value, validate);
      else cancelEdit();
    });
    input.addEventListener("click", event => event.stopPropagation());
    wrap.append(input, message);
    return wrap;
  }
  function problemWith(raw) {
    const name = raw.trim();
    if (!editing) return null;
    if (!name) return "Enter a name.";
    const parts = name.split("/");
    if (editing.mode === "rename" && parts.length > 1) return "Names cannot contain \"/\".";
    if (parts.some(part => !createApi.validFolderName(part)))
      return "That name contains characters a file name cannot use.";
    const leaf = parts[parts.length - 1];
    const isFile = editing.mode === "new-file" || (editing.mode === "rename" && editing.node.kind === "file");
    if (isFile && !validFilename(leaf))
      return "Use a supported source extension: .flow .py .R .md .qmd .Rmd .csv .tsv .json .toml .yaml .txt";
    const folder = editing.mode === "rename" ? editing.node.parent : editing.folder;
    if (parts.length === 1 && folder.children &&
        folder.children.some(child => child.name === leaf && child !== editing.node))
      return "\"" + leaf + "\" already exists here.";
    return null;
  }

  function renderEmpty() {
    const parts = [];
    parts.push(el("p", "ex-empty-title", "No folder opened"));
    parts.push(el("p", "ex-empty-text", "Open a folder to browse, create and rename files. " +
      "Files stay on this device; FlowStudio reads them through your browser."));
    const open = el("button", "ex-primary", "Open folder...");
    open.type = "button";
    open.dataset.action = "openFolder";
    open.addEventListener("click", () => void choose());
    if (typeof picker !== "function") {
      open.disabled = true;
      parts.push(open, el("p", "ex-empty-text", "This browser cannot open local folders. Use Chrome, Edge or another Chromium browser."));
    } else parts.push(open);
    if (recents.length) {
      parts.push(el("p", "ex-section-label", "Recent"));
      const ul = el("ul", "ex-recent");
      for (const item of recents) {
        const li = el("li");
        const button = el("button", "ex-recent-item");
        button.type = "button";
        button.append(icon("folder", "ex-folder"), el("span", "ex-name", item.name));
        button.title = "Reopen " + item.name;
        button.addEventListener("click", () => void reopen(item));
        const forget = el("button", "ex-recent-forget");
        forget.type = "button";
        forget.title = "Remove " + item.name + " from recent folders";
        forget.setAttribute("aria-label", forget.title);
        forget.append(icon("close"));
        forget.addEventListener("click", async () => {
          if (handles) recents = await handles.forget(item.handle);
          render();
        });
        li.append(button, forget);
        ul.append(li);
      }
      parts.push(ul);
    }
    empty.replaceChildren(...parts);
  }

  /* ---------- root management ---------- */

  async function setRoot(handle, remember = true) {
    tree = createTree(handle);
    focusedRel = null;
    editing = null;
    tree.loading = loadChildren(tree);
    render();
    try { await tree.loading; } finally { tree.loading = null; }
    await restoreExpanded();
    focusedRel = tree.children && tree.children.length ? tree.children[0].rel : null;
    render();
    onRootChanged(handle);
    if (remember && handles) {
      try { recents = await handles.remember(handle); } catch (_) { /* optional */ }
    }
    return true;
  }
  async function choose() {
    if (typeof picker !== "function") {
      status("This browser does not support local folder access.", "error");
      return false;
    }
    try {
      const handle = await picker({ mode: "readwrite", id: "flowstudio-workspace" });
      if (!handle || handle.kind !== "directory") throw new Error("Choose a folder.");
      await setRoot(handle);
      status("Opened folder " + handle.name, "ok");
      return true;
    } catch (error) { report(error); return false; }
  }
  async function reopen(item) {
    try {
      const handle = item.handle;
      if (typeof handle.queryPermission === "function") {
        let state = await handle.queryPermission({ mode: "readwrite" });
        if (state !== "granted" && typeof handle.requestPermission === "function")
          state = await handle.requestPermission({ mode: "readwrite" });
        if (state !== "granted") throw new Error("Permission to open " + item.name + " was not granted.");
      }
      await setRoot(handle);
      status("Reopened folder " + item.name, "ok");
      return true;
    } catch (error) {
      if (error && error.name === "NotFoundError") {
        status(item.name + " no longer exists; removed from recent folders.", "error");
        if (handles) recents = await handles.forget(item.handle);
        render();
        return false;
      }
      report(error);
      return false;
    }
  }
  function close() {
    tree = null;
    focusedRel = null;
    editing = null;
    render();
    onRootChanged(null);
  }

  /* ---------- expansion ---------- */

  function saveExpanded() {
    if (!storage || !tree) return;
    const open = [];
    (function walk(node) {
      for (const child of node.children || [])
        if (child.kind === "directory" && child.expanded) { open.push(child.rel); walk(child); }
    })(tree);
    try { storage.setItem(EXPANDED_KEY + tree.name, JSON.stringify(open.slice(0, 200))); }
    catch (_) { /* optional */ }
  }
  async function restoreExpanded() {
    if (!storage || !tree) return;
    let open = [];
    try { open = JSON.parse(storage.getItem(EXPANDED_KEY + tree.name) || "[]"); } catch (_) { open = []; }
    if (!Array.isArray(open)) return;
    open.sort((a, b) => a.split("/").length - b.split("/").length);
    for (const rel of open.slice(0, 200)) {
      if (typeof rel !== "string") continue;
      const node = findByRel(tree, rel);
      if (!node || node.kind !== "directory") continue;
      node.expanded = true;
      try { await loadChildren(node); } catch (_) { node.expanded = false; }
    }
  }
  async function expand(node, value = true) {
    if (node.kind !== "directory") return;
    node.expanded = value;
    if (value && !node.children) {
      node.loading = loadChildren(node);
      render();
      try { await node.loading; }
      catch (error) { node.expanded = false; report(error); }
      finally { node.loading = null; }
    }
    saveExpanded();
    render();
  }
  function collapseAll() {
    if (!tree) return;
    (function walk(node) {
      for (const child of node.children || []) if (child.kind === "directory") { child.expanded = false; walk(child); }
    })(tree);
    const focused = focusedRel ? findByRel(tree, focusedRel) : null;
    if (focused && focused.depth > 1) {
      let top = focused;
      while (top.parent && top.parent !== tree) top = top.parent;
      focusedRel = top.rel;
    }
    saveExpanded();
    render();
  }
  async function refresh(folder = null) {
    if (!tree) return;
    const reload = async node => {
      if (node.kind !== "directory" || !node.children) return;
      await loadChildren(node);
      for (const child of node.children) if (child.expanded) await reload(child);
    };
    try { await reload(folder || tree); }
    catch (error) { report(error); }
    render();
  }
  /* Expand the ancestors of a project path and select it. */
  async function reveal(path, focus = false) {
    if (!tree || typeof path !== "string") return false;
    const prefix = tree.name + "/";
    if (!path.startsWith(prefix)) return false;
    const parts = path.slice(prefix.length).split("/");
    let node = tree;
    for (let i = 0; i < parts.length; i++) {
      if (!node.children) { try { await loadChildren(node); } catch (_) { return false; } }
      const next = node.children.find(child => child.name === parts[i]);
      if (!next) return false;
      if (i < parts.length - 1) next.expanded = true;
      node = next;
    }
    focusedRel = node.rel;
    saveExpanded();
    render();
    if (focus) list.focus();
    const row = list.querySelector('[data-rel="' + cssEscape(node.rel) + '"]');
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    return true;
  }
  function cssEscape(value) {
    return global.CSS && typeof global.CSS.escape === "function" ? global.CSS.escape(value)
      : String(value).replace(/["\\]/g, "\\$&");
  }

  /* ---------- create / rename / delete / move ---------- */

  function targetFolder() {
    if (!tree) return null;
    const node = focusedRel ? findByRel(tree, focusedRel) : null;
    if (!node) return tree;
    return node.kind === "directory" ? node : node.parent;
  }
  async function beginCreate(mode, folder = null) {
    if (!tree) { status("Open a folder first.", "error"); return; }
    const target = folder || targetFolder();
    if (target !== tree && !target.expanded) await expand(target, true);
    else if (!target.children) await loadChildren(target);
    editing = { mode, folder: target, node: null };
    render();
  }
  function beginRename(node) {
    if (!node || node === tree) return;
    editing = { mode: "rename", folder: node.parent, node };
    render();
  }
  function cancelEdit() {
    editing = null;
    render();
    list.focus();
  }
  async function commit(raw, validate) {
    if (!editing) return;
    if (validate()) {
      // Keep the field open so the message stays readable; re-arm commit.
      const input = list.querySelector(".ex-input");
      if (input) input.focus();
      return;
    }
    const job = editing;
    const name = raw.trim();
    editing = null;
    try {
      if (job.mode === "rename") await renameNode(job.node, name);
      else await createIn(job.folder, name, job.mode === "new-folder" ? "directory" : "file");
    } catch (error) {
      report(error);
      render();
    }
    list.focus();
  }
  async function createIn(folder, name, kind) {
    const rel = joinRel(folder.rel, name);
    const parts = name.split("/");
    // Create intermediate folders the user typed, one verified level at a time.
    let parent = folder;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parent.children) await loadChildren(parent);
      let next = parent.children.find(child => child.name === parts[i] && child.kind === "directory");
      if (!next) {
        await createApi.createDirectory(tree.handle, joinRel(parent.rel, parts[i]));
        await loadChildren(parent);
        next = parent.children.find(child => child.name === parts[i]);
      }
      next.expanded = true;
      if (!next.children) await loadChildren(next);
      parent = next;
    }
    const leaf = parts[parts.length - 1];
    if (kind === "directory") {
      await createApi.createDirectory(tree.handle, joinRel(parent.rel, leaf));
    } else {
      await createApi.createFile(tree.handle, joinRel(parent.rel, leaf), validFilename);
    }
    parent.expanded = true;
    await loadChildren(parent);
    const created = parent.children.find(child => child.name === leaf);
    focusedRel = created ? created.rel : rel;
    saveExpanded();
    render();
    if (kind === "file" && created) {
      await openHandle(created.handle, fullPath(created));
      status("Created " + fullPath(created), "ok");
    } else status("Created folder " + (created ? fullPath(created) : name), "ok");
  }
  function openDocUnder(path) {
    const result = [];
    for (const item of listDocuments())
      if (item && item.path && (item.path === path || item.path.startsWith(path + "/"))) result.push(item);
    return result;
  }
  async function renameNode(node, nextName) {
    if (nextName === node.name) { render(); return; }
    const oldPath = fullPath(node);
    const affected = openDocUnder(oldPath);
    if (affected.some(item => item.dirty))
      throw new Error("Save or close the modified files under \"" + node.name + "\" before renaming.");
    const parent = node.parent;
    let handle;
    if (node.kind === "file") {
      if (typeof node.handle.move === "function") {
        try {
          if (await exists(parent.handle, nextName)) throw new Error("\"" + nextName + "\" already exists.");
          await node.handle.move(nextName);
          handle = node.handle;
        } catch (error) {
          if (!error || (error.name !== "NotSupportedError" && error.name !== "NotAllowedError" &&
              error.name !== "TypeError")) throw error;
        }
      }
      if (!handle) {
        const baseline = await fileSave.readSnapshot(node.handle);
        const result = await renameApi.rename({ parent: parent.handle, handle: node.handle,
          name: node.name, nextName, baseline, fileSaveApi: fileSave, validFilename,
          confirmRename: () => true });
        if (!result) return;
        handle = result.handle;
      }
    } else {
      handle = (await moveFolder({ from: parent.handle, handle: node.handle, name: node.name,
        to: parent.handle, nextName })).handle;
    }
    await loadChildren(parent);
    const renamed = parent.children.find(child => child.name === nextName);
    if (renamed && node.kind === "directory") {
      renamed.expanded = node.expanded;
      if (node.expanded) await loadChildren(renamed);
    }
    focusedRel = renamed ? renamed.rel : joinRel(parent.rel, nextName);
    saveExpanded();
    render();
    const newPath = tree.name + "/" + joinRel(parent.rel, nextName);
    onEntryMoved({ kind: node.kind, oldPath, newPath, handle: renamed ? renamed.handle : handle });
    status("Renamed to " + nextName, "ok");
  }
  async function deleteNode(node) {
    if (!node || node === tree) return false;
    const path = fullPath(node);
    const affected = openDocUnder(path);
    if (affected.some(item => item.dirty)) {
      status("Save or close the modified files under \"" + node.name + "\" before deleting.", "error");
      return false;
    }
    let message = "Delete \"" + node.name + "\" permanently from this folder? This cannot be undone.";
    if (node.kind === "directory") {
      let counts = null;
      try { counts = await countEntries(node.handle); } catch (_) { counts = null; }
      if (counts && (counts.files || counts.folders))
        message = "Delete the folder \"" + node.name + "\" and its " + counts.files + (counts.capped ? "+" : "") +
          " files and " + counts.folders + " subfolders permanently? This cannot be undone.";
    }
    if (!confirmChange(message)) return false;
    try {
      const rows = visibleRows(tree);
      const index = rows.indexOf(node);
      if (node.kind === "directory") await node.parent.handle.removeEntry(node.name, { recursive: true });
      else {
        const current = await node.parent.handle.getFileHandle(node.name);
        if (!(await sameEntry(current, node.handle)))
          throw new Error("\"" + node.name + "\" was replaced on disk; delete refused.");
        await node.parent.handle.removeEntry(node.name);
      }
      await loadChildren(node.parent);
      const after = visibleRows(tree);
      focusedRel = after.length ? after[Math.min(Math.max(index, 0), after.length - 1)].rel : null;
      saveExpanded();
      render();
      onEntryDeleted({ kind: node.kind, path });
      status("Deleted " + path, "ok");
      return true;
    } catch (error) { report(error); render(); return false; }
  }
  async function moveNode(node, folder) {
    if (!node || !folder || folder.kind !== "directory" || node === tree) return false;
    if (node.parent === folder) return false;
    if (node.kind === "directory" && isInside(folder.rel, node.rel))
      { status("A folder cannot move into itself.", "error"); return false; }
    const oldPath = fullPath(node);
    const affected = openDocUnder(oldPath);
    if (affected.some(item => item.dirty)) {
      status("Save the modified files under \"" + node.name + "\" before moving.", "error");
      return false;
    }
    try {
      let handle;
      if (node.kind === "file") {
        handle = (await moveFile({ from: node.parent.handle, handle: node.handle, name: node.name,
          to: folder.handle, fileSave })).handle;
      } else {
        handle = (await moveFolder({ from: node.parent.handle, handle: node.handle, name: node.name,
          to: folder.handle })).handle;
      }
      const oldParent = node.parent;
      await loadChildren(oldParent);
      folder.expanded = true;
      await loadChildren(folder);
      const moved = folder.children.find(child => child.name === node.name);
      focusedRel = moved ? moved.rel : null;
      saveExpanded();
      render();
      const newPath = tree.name + "/" + joinRel(folder.rel, node.name);
      onEntryMoved({ kind: node.kind, oldPath, newPath, handle: moved ? moved.handle : handle });
      status("Moved " + node.name + " to " + (folder === tree ? tree.name : fullPath(folder)), "ok");
      return true;
    } catch (error) { report(error); render(); return false; }
  }
  async function copyText(text, label) {
    try {
      if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("Clipboard unavailable.");
      await clipboard.writeText(text);
      status("Copied " + label, "ok");
    } catch (error) { report(error); }
  }

  /* ---------- context menu ---------- */

  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
  }
  function menuItems(node) {
    if (!tree) return [
      ["Open folder...", () => void choose(), ""]
    ];
    const items = [];
    if (node && node.kind === "file") items.push(["Open", () => void openNode(node), "Enter"], null);
    items.push(["New file...", () => void beginCreate("new-file", node ? (node.kind === "directory" ? node : node.parent) : tree), ""]);
    items.push(["New folder...", () => void beginCreate("new-folder", node ? (node.kind === "directory" ? node : node.parent) : tree), ""]);
    if (node) {
      items.push(null);
      items.push(["Copy path", () => void copyText(fullPath(node), "path"), ""]);
      items.push(["Copy relative path", () => void copyText(node.rel, "relative path"), ""]);
      items.push(null);
      items.push(["Rename...", () => beginRename(node), "F2"]);
      items.push(["Delete", () => void deleteNode(node), "Del"]);
    }
    items.push(null);
    if (node && node.kind === "directory") items.push(["Collapse folder", () => void expand(node, false), ""]);
    items.push(["Refresh", () => void refresh(), ""]);
    items.push(["Collapse all folders", () => collapseAll(), ""]);
    items.push(null);
    items.push(["Open another folder...", () => void choose(), ""]);
    items.push(["Close folder", () => close(), ""]);
    return items;
  }
  function openMenu(node, anchor, point = null) {
    closeMenu();
    menu = el("div", "ex-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", node ? node.name + " actions" : "Explorer actions");
    const buttons = [];
    for (const item of menuItems(node)) {
      if (!item) { if (menu.lastChild && menu.lastChild.tagName !== "HR") menu.append(el("hr")); continue; }
      const [label, run, shortcut] = item;
      const button = el("button", "ex-menu-item");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.tabIndex = -1;
      button.append(el("span", "", label));
      if (shortcut) button.append(el("kbd", "", shortcut));
      button.addEventListener("click", event => {
        event.stopPropagation();
        closeMenu();
        run();
      });
      buttons.push(button);
      menu.append(button);
    }
    if (menu.lastChild && menu.lastChild.tagName === "HR") menu.lastChild.remove();
    menu.addEventListener("keydown", event => {
      const index = buttons.indexOf(doc.activeElement);
      if (event.key === "ArrowDown") { event.preventDefault(); buttons[(index + 1) % buttons.length].focus(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length].focus(); }
      else if (event.key === "Home") { event.preventDefault(); buttons[0].focus(); }
      else if (event.key === "End") { event.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); closeMenu(); list.focus(); }
    });
    doc.body.append(menu);
    let x, y;
    if (point) { x = point.x; y = point.y; }
    else {
      const rect = anchor.getBoundingClientRect();
      x = rect.left; y = rect.bottom + 2;
    }
    const width = global.innerWidth || 1024, height = global.innerHeight || 768;
    const box = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, width - box.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, height - box.height - 4)) + "px";
    if (buttons[0]) buttons[0].focus();
  }
  doc.addEventListener("mousedown", event => { if (menu && !menu.contains(event.target)) closeMenu(); }, true);
  global.addEventListener && global.addEventListener("blur", closeMenu);

  /* ---------- tree interaction ---------- */

  function rowNode(target) {
    const row = target && target.closest ? target.closest(".ex-row[data-rel]") : null;
    return row ? findByRel(tree, row.dataset.rel) : null;
  }
  async function openNode(node) {
    if (!node || node.kind !== "file") return false;
    if (!validFilename(node.name)) {
      status("\"" + node.name + "\" is not a supported text file type.", "error");
      return false;
    }
    try { return await openHandle(node.handle, fullPath(node)); }
    catch (error) { report(error); return false; }
  }
  list.addEventListener("click", event => {
    const node = rowNode(event.target);
    if (!node) return;
    focusedRel = node.rel;
    if (node.kind === "directory") void expand(node, !node.expanded);
    else { render(); void openNode(node); }
  });
  list.addEventListener("contextmenu", event => {
    if (!tree) return;
    event.preventDefault();
    const node = rowNode(event.target);
    if (node) { focusedRel = node.rel; render(); }
    openMenu(node, null, { x: event.clientX, y: event.clientY });
  });
  empty.addEventListener("contextmenu", event => { event.preventDefault(); openMenu(null, null, { x: event.clientX, y: event.clientY }); });
  list.addEventListener("keydown", event => {
    if (!tree || editing) return;
    const rows = visibleRows(tree);
    if (!rows.length) {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); openMenu(null, title);
      }
      return;
    }
    let index = rows.findIndex(row => row.rel === focusedRel);
    if (index < 0) index = 0;
    const node = rows[index];
    const move = next => {
      focusedRel = rows[Math.max(0, Math.min(rows.length - 1, next))].rel;
      render();
      const row = list.querySelector('[data-rel="' + cssEscape(focusedRel) + '"]');
      if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
    };
    const mod = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(index + 1); return;
      case "ArrowUp": event.preventDefault(); move(index - 1); return;
      case "Home": event.preventDefault(); move(0); return;
      case "End": event.preventDefault(); move(rows.length - 1); return;
      case "PageDown": event.preventDefault(); move(index + 10); return;
      case "PageUp": event.preventDefault(); move(index - 10); return;
      case "ArrowRight":
        event.preventDefault();
        if (node.kind === "directory" && !node.expanded) void expand(node, true);
        else if (node.kind === "directory" && node.children && node.children.length) move(index + 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (node.kind === "directory" && node.expanded) void expand(node, false);
        else if (node.parent && node.parent !== tree) { focusedRel = node.parent.rel; render(); }
        return;
      case "Enter":
        event.preventDefault();
        if (node.kind === "directory") void expand(node, !node.expanded);
        else void openNode(node);
        return;
      case " ":
        if (typed) break;
        event.preventDefault();
        if (node.kind === "directory") void expand(node, !node.expanded);
        else void openNode(node);
        return;
      case "F2": event.preventDefault(); beginRename(node); return;
      case "Delete": event.preventDefault(); void deleteNode(node); return;
      case "Backspace": if (mod) { event.preventDefault(); void deleteNode(node); return; } break;
      case "ContextMenu":
        event.preventDefault();
        openMenu(node, list.querySelector('[data-rel="' + cssEscape(node.rel) + '"]') || title);
        return;
      case "F10":
        if (event.shiftKey) {
          event.preventDefault();
          openMenu(node, list.querySelector('[data-rel="' + cssEscape(node.rel) + '"]') || title);
          return;
        }
        break;
      case "Escape":
        if (typed) { event.preventDefault(); typed = ""; hint.hidden = true; }
        return;
      default: break;
    }
    if (mod && event.altKey && (event.key === "n" || event.key === "N")) {
      event.preventDefault(); void beginCreate("new-file"); return;
    }
    if (event.key.length === 1 && !mod && !event.altKey) {
      const now = Date.now();
      typed = now - typedAt > TYPEAHEAD_MS ? event.key : typed + event.key;
      typedAt = now;
      const found = typeAheadIndex(rows, index, typed);
      hint.textContent = found >= 0 ? typed : typed + " (no match)";
      hint.hidden = false;
      hint.classList.toggle("miss", found < 0);
      clearTimeout(hint.timer);
      hint.timer = setTimeout(() => { hint.hidden = true; typed = ""; }, TYPEAHEAD_MS * 2);
      if (found >= 0) { event.preventDefault(); move(found); }
    }
  });

  /* Drag files and folders onto a folder row, or onto the header for the root. */
  list.addEventListener("dragstart", event => {
    const node = rowNode(event.target);
    if (!node || editing) { event.preventDefault(); return; }
    dragRel = node.rel;
    try { event.dataTransfer.setData("text/plain", fullPath(node)); event.dataTransfer.effectAllowed = "move"; }
    catch (_) { /* optional */ }
  });
  list.addEventListener("dragend", () => {
    dragRel = null;
    for (const row of list.querySelectorAll(".drop-target")) row.classList.remove("drop-target");
    title.classList.remove("drop-target");
    render();
  });
  function dropFolderFor(target) {
    if (target && target.closest && target.closest(".ex-title")) return tree;
    const node = rowNode(target);
    if (!node) return null;
    return node.kind === "directory" ? node : node.parent;
  }
  function onDragOver(event) {
    if (dragRel === null || !tree) return;
    const folder = dropFolderFor(event.target);
    const dragged = findByRel(tree, dragRel);
    for (const row of list.querySelectorAll(".drop-target")) row.classList.remove("drop-target");
    title.classList.remove("drop-target");
    if (!folder || !dragged || dragged.parent === folder ||
        (dragged.kind === "directory" && isInside(folder.rel, dragged.rel))) return;
    event.preventDefault();
    try { event.dataTransfer.dropEffect = "move"; } catch (_) { /* optional */ }
    if (folder === tree) title.classList.add("drop-target");
    else {
      const row = list.querySelector('[data-rel="' + cssEscape(folder.rel) + '"]');
      if (row) row.classList.add("drop-target");
    }
  }
  async function onDrop(event) {
    if (dragRel === null || !tree) return;
    event.preventDefault();
    const folder = dropFolderFor(event.target);
    const dragged = findByRel(tree, dragRel);
    dragRel = null;
    title.classList.remove("drop-target");
    if (folder && dragged) await moveNode(dragged, folder);
    else render();
  }
  list.addEventListener("dragover", onDragOver);
  title.addEventListener("dragover", onDragOver);
  list.addEventListener("drop", event => void onDrop(event));
  title.addEventListener("drop", event => void onDrop(event));

  /* ---------- startup ---------- */

  render();
  if (handles) {
    handles.list().then(items => { recents = items.filter(item => item && item.handle); if (!tree) render(); })
      .catch(() => {});
  }

  return Object.freeze({
    choose, reopen, close, refresh, reveal, collapseAll, render,
    newFile: folder => beginCreate("new-file", folder || null),
    newFolder: folder => beginCreate("new-folder", folder || null),
    renamePath: path => { const node = tree && findByRel(tree, path.slice(tree.name.length + 1)); if (node) beginRename(node); },
    deletePath: path => { const node = tree && findByRel(tree, path.slice(tree.name.length + 1)); return node ? deleteNode(node) : false; },
    movePath: (path, folderPath) => {
      if (!tree) return false;
      const node = findByRel(tree, path.slice(tree.name.length + 1));
      const folder = folderPath === tree.name ? tree : findByRel(tree, folderPath.slice(tree.name.length + 1));
      return moveNode(node, folder);
    },
    root: () => (tree ? tree.handle : null),
    rootName: () => (tree ? tree.name : null),
    hasRoot: () => !!tree,
    setRoot: handle => setRoot(handle),
    recents: () => recents.slice(),
    focus: () => list.focus()
  });
}

const api = Object.freeze({
  mount, createTree, loadChildren, visibleRows, findByRel, typeAheadIndex, fileBadge,
  compareEntries, moveFile, moveFolder, countEntries, createHandleStore, isInside, parentRel
});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioExplorer = api;
})(globalThis);
