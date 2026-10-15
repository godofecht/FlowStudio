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
  return { choose, refresh, create, hasProject: () => root !== null };
}
const api = { createProjectExplorer, validFilename };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProject = api;
})(globalThis);
