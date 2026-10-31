/* FlowStudio project explorer. Browser File System Access API only. */
(function (global) {
"use strict";
function creationApi() {
  const api = global.FlowStudioProjectCreate ||
    (typeof require === "function" ? require("./project_create.js") : null);
  if (!api) throw new Error("Project creation helper unavailable.");
  return api;
}
const editable = /\.(flow|r|py|txt|md|qmd|rmd|csv|tsv|json|toml|yaml|yml|rproj)$/i;
function validFilename(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255 ||
      name === "." || name === ".." || !editable.test(name) ||
      name.includes("/") || name.includes("\\")) return false;
  for (const char of name) if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return false;
  return true;
}

function utf8SourceBytes(source, limit = Infinity) {
  let bytes = 0;
  for (let i = 0; i < source.length; i++) {
    const unit = source.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        const error = new Error("Project source contains invalid Unicode.");
        error.name = "UnsafeProjectSourceError";
        throw error;
      }
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      const error = new Error("Project source contains invalid Unicode.");
      error.name = "UnsafeProjectSourceError";
      throw error;
    } else {
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    }
    if (bytes > limit) return bytes;
  }
  return bytes;
}

async function readProjectText(file, limit) {
  if (file.size > limit) throw Error("Project source exceeds size limit.");
  let source;
  if (typeof file.arrayBuffer === "function") {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > limit) throw Error("Project source exceeds size limit.");
    try {
      source = new TextDecoder("utf-8", {fatal:true, ignoreBOM:true}).decode(bytes);
    } catch (_) {
      const error = Error("Project source is not valid UTF-8.");
      error.name = "UnsafeProjectSourceError";
      throw error;
    }
  } else {
    source = await file.text();
  }
  if (utf8SourceBytes(source, limit) > limit) {
    const error = new Error("Project source exceeds UTF-8 byte limit.");
    error.name = "OversizedProjectSourceError";
    throw error;
  }
  if (source.includes("\0")) {
    const error = Error("Project source contains binary NUL data.");
    error.name = "UnsafeProjectSourceError";
    throw error;
  }
  return source;
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
  let scannedFiles = 0, skippedLarge = 0, skippedUnsafe = 0, truncated = false;
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
      let source;
      try { source = await readProjectText(file, maxBytes); }
      catch (error) {
        if (error.name === "UnsafeProjectSourceError") { skippedUnsafe++; continue; }
        if (error.name === "OversizedProjectSourceError") { skippedLarge++; continue; }
        throw error;
      }
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
  return { matches, scannedFiles, skippedLarge, skippedUnsafe, truncated };
}


/* Two-phase, bounded local project replacement. Preview never writes files. */
function replacementEngine() {
  const engine = global.FlowStudioEditorFind ||
    (typeof require === "function" ? require("./editor_find.js") : null);
  if (!engine || typeof engine.findMatches !== "function" ||
      typeof engine.replaceAll !== "function")
    throw new Error("The source replacement engine is unavailable.");
  return engine;
}
function checkReplacementAbort(signal) {
  if (signal && signal.aborted) {
    const error = new Error("Project replacement cancelled.");
    error.name = "AbortError";
    throw error;
  }
}
async function planProjectReplace(root, query, replacement, options = {}) {
  if (typeof replacement !== "string" || replacement.length > 10000)
    throw new Error("Replacement must be at most 10,000 characters.");
  try { encodeURIComponent(replacement); }
  catch (_) { throw new Error("Replacement contains invalid Unicode."); }
  const found = await searchProject(root, query, options);
  if (found.truncated || found.skippedLarge || found.skippedUnsafe)
    throw new Error("Project search was incomplete; narrow the query or remove oversized/unsafe-encoding files before replacing.");
  const engine = replacementEngine();
  const groups = new Map();
  for (const hit of found.matches) {
    if (!groups.has(hit.handle))
      groups.set(hit.handle, { handle: hit.handle, path: hit.path, hits: [] });
    groups.get(hit.handle).hits.push(hit);
  }
  if (groups.size > 50)
    throw new Error("Project replacement is limited to 50 changed files.");
  let budget = 0;
  const files = [];
  for (const entry of groups.values()) {
    checkReplacementAbort(options.signal);
    const file = await entry.handle.getFile();
    const limit = options.regex ? 128 * 1024 : 1024 * 1024;
    if (file.size > limit) throw new Error("File grew since search: " + entry.path);
    const before = await readProjectText(file, limit);
    checkReplacementAbort(options.signal);
    if (before.length > limit) throw new Error("File grew since search: " + entry.path);
    const matches = engine.findMatches(before, query, options);
    if (matches.truncated || matches.matches.length !== entry.hits.length ||
        matches.matches.some((hit, i) => hit.index !== entry.hits[i].index ||
          hit.end - hit.index !== entry.hits[i].length ||
          before.slice(hit.index, hit.end) !== entry.hits[i].text))
      throw new Error("File changed since search; retry: " + entry.path);
    const updated = engine.replaceAll(before, query, replacement, options);
    if (updated.count !== entry.hits.length)
      throw new Error("Replacement count changed; retry: " + entry.path);
    if (updated.value.includes("\0"))
      throw new Error("Project replacement would introduce binary NUL data.");
    const updatedBytes = utf8SourceBytes(updated.value, limit);
    if (updatedBytes > limit)
      throw new Error("Project replacement exceeds the per-file UTF-8 byte limit.");
    budget += utf8SourceBytes(before, limit) + updatedBytes;
    if (budget > 8 * 1024 * 1024)
      throw new Error("Project replacement exceeds the 8 MiB UTF-8 preview budget.");
    if (updated.value !== before)
      files.push({ path: entry.path, handle: entry.handle, before, after: updated.value, count: updated.count });
  }
  return { root, matches: found.matches.length, files };
}
async function applyProjectReplacement(plan, options = {}) {
  if (!plan || !Array.isArray(plan.files) || plan.files.length > 50)
    throw new Error("Invalid project replacement preview.");
  for (const entry of plan.files) {
    checkReplacementAbort(options.signal);
    if (options.isBlocked && await options.isBlocked(entry))
      throw new Error("Close the open editor tab before replacing " + entry.path + ".");
    if (typeof entry.handle.createWritable !== "function")
      throw new Error("Write access is unavailable for " + entry.path + ".");
    const current = await entry.handle.getFile();
    if (await readProjectText(current, 8 * 1024 * 1024) !== entry.before)
      throw new Error("File changed since preview; no files replaced: " + entry.path);
  }
  let completed = 0, matches = 0;
  // A failed close may have changed its file. Include that attempted write.
  const attempted = [];
  try {
    for (const entry of plan.files) {
      checkReplacementAbort(options.signal);
      if (options.isBlocked && await options.isBlocked(entry))
        throw new Error("An editor tab was opened during replacement: " + entry.path);
      const current = await entry.handle.getFile();
      if (await readProjectText(current, 8 * 1024 * 1024) !== entry.before)
        throw new Error("File changed during replacement: " + entry.path);
      attempted.push(entry);
      const writer = await entry.handle.createWritable();
      try {
        await writer.write(entry.after);
        await writer.close();
      } catch (error) {
        if (typeof writer.abort === "function") {
          try { await writer.abort(); } catch (_) { /* preserve original error */ }
        }
        throw error;
      }
      const saved = await entry.handle.getFile();
      if (await readProjectText(saved, 8 * 1024 * 1024) !== entry.after)
        throw new Error("Could not verify the written file: " + entry.path);
      completed++;
      matches += entry.count;
    }
  } catch (error) {
    if (!attempted.length) throw error;
    let restored = 0, unchanged = 0;
    const unresolved = [];
    // Best-effort compensation, not a transaction. A crash, external edit,
    // denied permission or newly opened editor can prevent restoration.
    // Never overwrite contents differing from both the before/after images.
    for (const entry of attempted.reverse()) {
      try {
        if (options.isBlocked && await options.isBlocked(entry))
          throw new Error("open in the editor");
        const current = await entry.handle.getFile();
        const contents = await readProjectText(current, 8 * 1024 * 1024);
        if (contents === entry.before) { unchanged++; continue; }
        if (contents !== entry.after)
          throw new Error("changed outside this operation");
        const writer = await entry.handle.createWritable();
        try {
          await writer.write(entry.before);
          await writer.close();
        } catch (rollbackError) {
          if (typeof writer.abort === "function") {
            try { await writer.abort(); } catch (_) { /* preserve rollback failure */ }
          }
          throw rollbackError;
        }
        const verified = await entry.handle.getFile();
        if (await readProjectText(verified, 8 * 1024 * 1024) !== entry.before)
          throw new Error("restored bytes could not be verified");
        restored++;
      } catch (rollbackError) {
        unresolved.push(entry.path + " (" + (rollbackError.message || String(rollbackError)) + ")");
      }
    }
    const failure = new Error("Replacement failed after " + completed +
      " verified files (" + matches + " matches): " + (error.message || String(error)) +
      ". Recovery restored " + restored + " files; " + unchanged + " were unchanged." +
      (unresolved.length ? " Manual recovery required for: " + unresolved.join("; ") + "." :
        " All attempted files match their original preview contents."));
    failure.name = error.name || "Error";
    throw failure;
  }
  return { files: completed, matches };
}

/* Undo is a second, conflict-checked write, never an unconditional rollback. */
function reverseProjectReplacement(plan) {
  if (!plan || !Array.isArray(plan.files) || plan.files.length > 50)
    throw new Error("Invalid project replacement history.");
  return {root:plan.root, matches:plan.matches, files:plan.files.map(entry => ({
    path:entry.path, handle:entry.handle, before:entry.after,
    after:entry.before, count:entry.count
  }))};
}

function createProjectExplorer({ tree, status, openHandle, picker }) {
  let root = null, revision = 0, lastReplacement = null;
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
          try { await openHandle(handle, path, dir); } catch (err) { error(err); }
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
      lastReplacement = null;
      await refresh();
      status("Opened project " + root.name, "ok");
      return true;
    } catch (err) { error(err); return false; }
  }
  async function create(name) {
    if (!root) throw new Error("Open a project first.");
    const result = await creationApi().createFile(root, name, validFilename);
    const opened = await openHandle(result.handle, root.name + "/" + result.path, result.parent);
    await refresh();
    return opened;
  }
  async function createFolder(path) {
    if (!root) throw new Error("Open a project first.");
    const result = await creationApi().createDirectory(root, path);
    await refresh();
    status("Created folder " + root.name + "/" + result.path, "ok");
    return true;
  }
  return { choose, refresh, create, createFolder, search: (query, options) => searchProject(root, query, options),
    previewReplace: (query, replacement, options) => planProjectReplace(root, query, replacement, options),
    applyReplace: async (plan, options) => {
      if (!root || !plan || plan.root !== root)
        throw new Error("Project changed since replacement preview.");
      lastReplacement = null;
      const result = await applyProjectReplacement(plan, options);
      if (root === plan.root && result.files > 0)
        lastReplacement = reverseProjectReplacement(plan);
      return result;
    },
    undoReplace: async options => {
      if (!root || !lastReplacement || lastReplacement.root !== root)
        throw new Error("No completed project replacement to undo.");
      const undo = lastReplacement;
      lastReplacement = null; // A failed or partial undo must not be blindly replayed.
      return applyProjectReplacement(undo, options);
    },
    hasUndoReplace: () => lastReplacement !== null && lastReplacement.root === root,
    hasProject: () => root !== null };
}
const api = { createProjectExplorer, validFilename,
  validSourcePath: path => creationApi().validSourcePath(path, validFilename),
  validFolderPath: path => creationApi().validFolderPath(path), searchProject, planProjectReplace, applyProjectReplacement, reverseProjectReplacement };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProject = api;
})(globalThis);
