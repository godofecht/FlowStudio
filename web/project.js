/* FlowStudio project explorer. Browser File System Access API only. */
(function (global) {
"use strict";
const editable = /\.(flow|r|py|txt|md|qmd|rmd|csv|tsv|json|toml|yaml|yml|rproj)$/i;
const WORD_START = /^[\p{L}\p{N}\p{M}_]/u;
const WORD_END = /[\p{L}\p{N}\p{M}_]$/u;
function validFilename(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255 ||
      name === "." || name === ".." || !editable.test(name) ||
      name.includes("/") || name.includes("\\")) return false;
  for (const char of name) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  return true;
}

function validFolderName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255 ||
      name === "." || name === ".." || name.trim() !== name ||
      /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) return false;
  for (const char of name) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  return true;
}

function validProjectSourcePath(path) {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  return parts.length <= 13 &&
    parts.slice(0, -1).every(validFolderName) &&
    validFilename(parts[parts.length - 1]);
}

/* Bounded, read-only literal search over browser-granted project files. */
async function searchProject(root, query, options = {}) {
  if (!root || root.kind !== "directory") throw new Error("Open a project folder first.");
  if (typeof query !== "string" || !query.trim() || query.length > 256)
    throw new Error("Search for 1–256 characters.");
  const MAX_DEPTH = 12, MAX_FILES = 1000, MAX_MATCHES = 200;
  const MAX_BYTES = 1024 * 1024, MAX_ENTRIES = 500;
  const metacharacters = "\\^$.*+?()[]{}|";
  const literal = [...query].map(ch => metacharacters.includes(ch) ? "\\" + ch : ch).join("");
  const expression = new RegExp(literal, options.caseSensitive ? "gu" : "giu");
  const matches = [];
  let scannedFiles = 0, skippedLarge = 0, truncated = false;
  function checkAbort() {
    if (options.signal && options.signal.aborted) {
      const error = new Error("Search cancelled");
      error.name = "AbortError";
      throw error;
    }
  }
  async function walk(directory, prefix, depth) {
    checkAbort();
    if (depth > MAX_DEPTH) { truncated = true; return; }
    const entries = [];
    for await (const [name, handle] of directory.entries()) {
      checkAbort();
      if (entries.length >= MAX_ENTRIES) { truncated = true; break; }
      entries.push({ name, handle });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const { name, handle } of entries) {
      checkAbort();
      if (matches.length >= MAX_MATCHES || scannedFiles >= MAX_FILES) {
        truncated = true;
        return;
      }
      const path = prefix + "/" + name;
      if (handle.kind === "directory") {
        await walk(handle, path, depth + 1);
        continue;
      }
      if (handle.kind !== "file" || !editable.test(name)) continue;
      const file = await handle.getFile();
      checkAbort();
      if (file.size > MAX_BYTES) { skippedLarge++; continue; }
      const source = await file.text();
      checkAbort();
      if (source.length > MAX_BYTES) { skippedLarge++; continue; }
      scannedFiles++;
      let line = 1, lineStart = 0;
      for (const found of source.matchAll(expression)) {
        checkAbort();
        if (matches.length >= MAX_MATCHES) { truncated = true; return; }
        const index = found.index;
        const end = index + found[0].length;
        if (options.wholeWord &&
            (WORD_END.test(source.slice(Math.max(0, index - 2), index)) ||
             WORD_START.test(source.slice(end, end + 2)))) continue;
        let newline = source.indexOf("\n", lineStart);
        while (newline >= 0 && newline < index) {
          line++;
          lineStart = newline + 1;
          newline = source.indexOf("\n", lineStart);
        }
        const lineEnd = newline < 0 ? source.length : newline;
        matches.push({
          path, handle, index, length: found[0].length,
          line, column: index - lineStart + 1,
          preview: source.slice(lineStart, Math.min(lineEnd, lineStart + 180))
        });
      }
    }
  }
  await walk(root, root.name, 0);
  return { matches, scannedFiles, skippedLarge, truncated };
}

function createProjectExplorer({ tree, status, openHandle, picker, onDeleted }) {
  let root = null, revision = 0;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function error(err) {
    if (err && err.name !== "AbortError") status(err.message || String(err), "error");
  }
  async function populate(dir, parent, prefix, depth, token) {
    if (token !== revision) return;
    if (depth > 12) { parent.append(element("p", "Depth limit reached.")); return; }
    const entries = [];
    for await (const [name, handle] of dir.entries()) {
      if (token !== revision) return;
      if (entries.length >= 500) { parent.append(element("p", "First 500 entries only.")); break; }
      if (handle.kind === "directory" || (handle.kind === "file" && editable.test(name))) {
        entries.push({ name, handle });
      }
    }
    entries.sort((a, b) => (a.handle.kind === "directory" ? 0 : 1) -
      (b.handle.kind === "directory" ? 0 : 1) || a.name.localeCompare(b.name));
    for (const { name, handle } of entries) {
      if (token !== revision) return;
      const path = prefix + "/" + name;
      if (handle.kind === "directory") {
        const details = element("details"), summary = element("summary", "Folder: " + name);
        const children = element("div");
        children.className = "project-children";
        details.append(summary, children);
        let loaded = false;
        details.addEventListener("toggle", async () => {
          if (!details.open || loaded || token !== revision) return;
          loaded = true;
          try { await populate(handle, children, path, depth + 1, token); }
          catch (err) { loaded = false; error(err); }
        });
        parent.append(details);
      } else {
        const button = element("button", "File: " + name);
        button.type = "button";
        button.className = "project-file";
        button.title = path;
        button.addEventListener("click", async () => {
          try { await openHandle(handle, path); } catch (err) { error(err); }
        });
        parent.append(button);
      }
    }
    if (entries.length === 0 && parent.children.length === 0) {
      parent.append(element("p", "No supported source files."));
    }
  }
  async function refresh() {
    const token = ++revision;
    tree.replaceChildren();
    if (!root) { tree.append(element("p", "Choose a folder.")); return; }
    tree.append(element("p", "Project: " + root.name));
    try { await populate(root, tree, root.name, 0, token); }
    catch (err) { error(err); }
  }
  async function choose() {
    if (typeof picker !== "function") {
      status("This browser does not support local folder access.", "error");
      return false;
    }
    try {
      const handle = await picker({ mode: "read" });
      if (!handle || handle.kind !== "directory") throw new Error("Not a directory");
      root = handle;
      await refresh();
      status("Opened project " + root.name, "ok");
      return true;
    } catch (err) { error(err); return false; }
  }
  async function create(relativePath) {
    if (!root) throw new Error("Open a project first.");
    if (!validProjectSourcePath(relativePath))
      throw new Error("Invalid project source path.");
    const parts = relativePath.split("/");
    let parent = root;
    for (const segment of parts.slice(0, -1)) {
      if (typeof parent.getDirectoryHandle !== "function")
        throw new Error("Nested folder access is unavailable.");
      parent = await parent.getDirectoryHandle(segment);
    }
    if (typeof parent.entries !== "function" ||
        typeof parent.getFileHandle !== "function" ||
        typeof parent.requestPermission !== "function")
      throw new Error("This browser does not support safe source creation.");
    if (await parent.requestPermission({ mode: "readwrite" }) !== "granted")
      throw new Error("Write permission is required to create source files.");
    const name = parts[parts.length - 1];
    for await (const [existing] of parent.entries()) {
      if (existing === name) throw new Error("Project entry already exists.");
    }
    const handle = await parent.getFileHandle(name, { create: true });
    async function rollback() {
      if (typeof parent.removeEntry !== "function")
        throw new Error("Browser cannot remove the new file.");
      const current = await parent.getFileHandle(name);
      if (typeof current.isSameEntry !== "function" ||
          !await current.isSameEntry(handle))
        throw new Error("New file handle changed before cleanup.");
      await parent.removeEntry(name);
    }
    let opened;
    try {
      opened = await openHandle(handle, root.name + "/" + relativePath);
    } catch (error) {
      try { await rollback(); }
      catch (cleanupError) {
        throw new Error("File created but could not be opened or safely removed: " +
          (cleanupError.message || String(cleanupError)), { cause: error });
      }
      await refresh();
      throw error;
    }
    if (opened === false) {
      await rollback();
      await refresh();
      return false;
    }
    await refresh();
    return opened;
  }

  async function createFolder(relativePath) {
    if (!root) throw new Error("Open a project first.");
    if (typeof relativePath !== "string") throw new Error("Invalid folder path.");
    const parts = relativePath.split("/");
    if (parts.length < 1 || parts.length > 12 || !parts.every(validFolderName))
      throw new Error("Invalid project folder path.");
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      if (typeof parent.getDirectoryHandle !== "function")
        throw new Error("Nested folder access is unavailable.");
      parent = await parent.getDirectoryHandle(part);
    }
    if (typeof parent.entries !== "function" ||
        typeof parent.getDirectoryHandle !== "function" ||
        typeof parent.requestPermission !== "function")
      throw new Error("This browser does not support project folder creation.");
    if (await parent.requestPermission({ mode: "readwrite" }) !== "granted")
      throw new Error("Write permission is required to create folders.");
    const name = parts[parts.length - 1];
    for await (const [existing] of parent.entries()) {
      if (existing === name) throw new Error("Project entry already exists.");
    }
    await parent.getDirectoryHandle(name, { create: true });
    await refresh();
    status("Created folder " + root.name + "/" + relativePath, "ok");
    return true;
  }

  // Delete only the file handle that the editor actually opened. A path alone
  // is never sufficient authority for destructive project operations.
  async function deleteFile(path, expectedHandle) {
    if (!root) throw new Error("Open a project first.");
    if (typeof path !== "string" || !path.startsWith(root.name + "/"))
      throw new Error("File is not in the opened project.");
    const segments = path.slice(root.name.length + 1).split("/");
    if (segments.length > 13 || segments.some(name => !name || name === "." ||
        name === ".." || name.includes("\\") || [...name].some(ch => ch.charCodeAt(0) < 32)))
      throw new Error("Invalid project file path.");
    const name = segments.pop();
    if (!validFilename(name)) throw new Error("Invalid project source filename.");
    let directory = root;
    for (const segment of segments) {
      if (typeof directory.getDirectoryHandle !== "function")
        throw new Error("Nested folder access is unavailable.");
      directory = await directory.getDirectoryHandle(segment);
    }
    if (typeof directory.getFileHandle !== "function" ||
        typeof directory.removeEntry !== "function" ||
        typeof directory.requestPermission !== "function")
      throw new Error("This browser does not support safe project deletion.");
    if (await directory.requestPermission({ mode: "readwrite" }) !== "granted")
      throw new Error("Write permission is required to delete project files.");
    const current = await directory.getFileHandle(name);
    if (!expectedHandle || expectedHandle.kind !== "file" ||
        typeof current.isSameEntry !== "function" ||
        !await current.isSameEntry(expectedHandle))
      throw new Error("File changed since it was opened; reopen before deleting.");
    await directory.removeEntry(name);
    if (typeof onDeleted === "function") onDeleted(expectedHandle, path);
    await refresh();
    status("Deleted " + path, "ok");
    return true;
  }
  return { choose, refresh, create, createFolder, deleteFile, search: (query, options) => searchProject(root, query, options), hasProject: () => root !== null };
}
const api = { createProjectExplorer, validFilename, validFolderName, validProjectSourcePath, searchProject };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProject = api;
})(globalThis);
