/* FlowStudio project explorer. Browser File System Access API only. */
(function (global) {
"use strict";
const editable = /\.(flow|r|py|txt|md|qmd|rmd|csv|tsv|json|toml|yaml|yml|rproj)$/i;
function validFilename(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255 ||
      name === "." || name === ".." || !editable.test(name) ||
      name.includes("/") || name.includes("\\")) return false;
  for (const char of name) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  return true;
}

/* Bounded, read-only literal/regex search over browser-granted project files. */
async function searchProject(root, query, options = {}) {
  if (!root || root.kind !== "directory") throw new Error("Open a project folder first.");
  if (typeof query !== "string" || !query.trim() || query.length > 256)
    throw new Error("Search for 1–256 characters.");
  const MAX_DEPTH = 12, MAX_FILES = 1000, MAX_MATCHES = 200;
  const MAX_BYTES = 1024 * 1024, MAX_ENTRIES = 500;
  const metacharacters = "\\^$.*+?()[]{}|";
  const literal = [...query].map(ch => metacharacters.includes(ch) ? "\\" + ch : ch).join("");
  const body = options.regex ? query : literal;
  const pattern = options.wholeWord
    ? "(?<![\\p{L}\\p{N}_])(?:" + body + ")(?![\\p{L}\\p{N}_])" : body;
  let expression;
  try {
    expression = new RegExp(pattern, (options.caseSensitive ? "g" : "gi") +
      (options.regex ? "m" : "") + "u");
  } catch (error) {
    throw new Error("Invalid regular expression: " + error.message);
  }
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
      const maxBytes = options.regex ? 128 * 1024 : MAX_BYTES;
      if (file.size > maxBytes) { skippedLarge++; continue; }
      const source = await file.text();
      checkAbort();
      if (source.length > maxBytes) { skippedLarge++; continue; }
      scannedFiles++;
      let line = 1, lineStart = 0;
      for (const found of source.matchAll(expression)) {
        checkAbort();
        if (matches.length >= MAX_MATCHES) { truncated = true; return; }
        const index = found.index;
        let newline = source.indexOf("\n", lineStart);
        while (newline >= 0 && newline < index) {
          line++;
          lineStart = newline + 1;
          newline = source.indexOf("\n", lineStart);
        }
        const lineEnd = newline < 0 ? source.length : newline;
        matches.push({
          path, handle, index, length: found[0].length, text: found[0],
          line, column: index - lineStart + 1,
          preview: source.slice(lineStart, Math.min(lineEnd, lineStart + 180))
        });
      }
    }
  }
  await walk(root, root.name, 0);
  return { matches, scannedFiles, skippedLarge, truncated };
}

function createProjectExplorer({ tree, status, openHandle, picker }) {
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
  async function create(name) {
    if (!root) throw new Error("Open a project first.");
    if (!validFilename(name)) throw new Error("Invalid source filename.");
    const handle = await root.getFileHandle(name, { create: true });
    const opened = await openHandle(handle, root.name + "/" + name);
    await refresh();
    return opened;
  }
  return { choose, refresh, create, search: (query, options) => searchProject(root, query, options), hasProject: () => root !== null };
}
const api = { createProjectExplorer, validFilename, searchProject };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProject = api;
})(globalThis);
