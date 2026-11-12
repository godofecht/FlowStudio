/* FlowStudio Search Everywhere (JetBrains double-Shift overlay, VS Code
 * command center). One overlay searches files in the open folder, commands,
 * open buffers and curated examples. Tabs scope the search (Tab cycles them),
 * a leading ">" scopes to commands, and matched characters are highlighted.
 * Opening a buffer reuses FlowStudioApp.activateDocument; files open through
 * FlowStudioApp.openEditorHandle; commands go through the command registry. */
(function (root) {
"use strict";

let mountOptions = null;    /* The bundled workbench module may assign
 * FlowStudioApp after this engine's DOMContentLoaded mount, so the app,
 * its commands and documents resolve lazily per render, never at mount. */
const SHIFT_WINDOW_MS = 350;
const MAX_RESULTS_PER_GROUP = 7;
const MAX_RESULTS_SCOPED = 60;
const FILE_LIMITS = Object.freeze({ files: 5000, depth: 12, entries: 2000 });
const SKIP_DIRS = new Set([".git", "node_modules", ".DS_Store", "__pycache__", ".venv"]);
const TABS = Object.freeze([
  ["all", "All"], ["files", "Files"], ["commands", "Commands"],
  ["buffers", "Open"], ["examples", "Examples"]
]);
const CATALOG = Object.freeze([
  ["New buffer", "newDocument", "Ctrl+Alt+N"],
  ["Open file", "openFile", "Ctrl+O"],
  ["Open folder", "openFolder", ""],
  ["New file in folder", "newFile", ""],
  ["New folder", "newFolder", ""],
  ["Reveal active file in explorer", "revealActiveFile", "Alt+F1"],
  ["Save file", "saveFile", "Ctrl+S"],
  ["Find in buffer", "focusFind", "Ctrl+F"],
  ["Replace in buffer", "focusReplace", "Ctrl+H"],
  ["Find in folder", "findInProject", "Ctrl+Shift+F"],
  ["Go to symbol", "goToSymbol", "Ctrl+Shift+O"],
  ["Go to definition", "goToDefinition", "F12"],
  ["Find references", "findReferences", "Shift+F12"],
  ["Rename identifier", "renameSymbol", "F2"],
  ["Run selection or file", "run", "Ctrl+Enter"],
  ["Run current cell", "runCell", "Ctrl+Shift+Enter"],
  ["Run project", "runProject", ""],
  ["Check Flow syntax", "checkFlow", ""],
  ["Reset R session", "resetR", ""],
  ["Reset Python session", "resetPython", ""],
  ["Show project files", "showFiles", "Ctrl+Shift+E"],
  ["Show outline", "showOutline", ""],
  ["Show plots", "showPlots", ""],
  ["Show data viewer", "showData", ""],
  ["Toggle console dock", "toggleDock", ""],
  ["Refresh environment", "refreshEnvironment", ""],
  ["Keyboard shortcuts", "shortcuts", ""],
  ["About FlowStudio", "about", ""]
]);

function mountApp() {
  const options = mountOptions || {};
  return options.app || (root.FlowStudioApp || null);
}
function commandsOf(optionsCommands) {
  const app = mountApp();
  const commands = optionsCommands || (app && app.commands) ||
    (root.FlowStudioApp && root.FlowStudioApp.commands) || {};
  return typeof commands === "object" && commands !== null ? commands : {};
}
function availableCommand(name, table) {
  return typeof commandsOf(table)[name] === "function";
}

const BOUNDARY = /[\s\-·_/.:]/;
/* Ranked match with the matched character positions. Word starts rank above
 * substrings, substrings above boundary-first subsequences, and those above
 * plain subsequences. */
function match(label, needle) {
  if (!needle) return { weight: 1, positions: [] };
  const haystack = String(label).toLowerCase();
  const query = String(needle).toLowerCase();
  const at = haystack.indexOf(query);
  const span = start => Array.from({ length: query.length }, (_, i) => start + i);
  if (at === 0) return { weight: 100, positions: span(0) };
  if (at > 0) {
    let boundary = -1;
    for (let i = at; i >= 0; i = haystack.indexOf(query, i + 1)) {
      if (i > 0 && BOUNDARY.test(haystack[i - 1])) { boundary = i; break; }
      if (i < 0) break;
    }
    if (boundary > 0) return { weight: 90, positions: span(boundary) };
    return { weight: 80, positions: span(at) };
  }
  /* Subsequence: prefer characters at word boundaries (camel humps too). */
  const positions = [];
  let cursor = 0;
  let boundaryHits = 0;
  for (const char of query) {
    let found = -1;
    for (let i = cursor; i < haystack.length; i++) {
      if (haystack[i] !== char) continue;
      const atBoundary = i === 0 || BOUNDARY.test(haystack[i - 1]) ||
        (label[i] !== haystack[i] && label[i - 1] === haystack[i - 1]);
      if (atBoundary) { found = i; boundaryHits++; break; }
      if (found < 0) found = i;
    }
    if (found < 0) return { weight: 0, positions: [] };
    positions.push(found);
    cursor = found + 1;
  }
  return { weight: boundaryHits === query.length ? 20 : 10, positions };
}
function score(label, needle) { return match(label, needle).weight; }

function commandEntries(needle, table) {
  const commands = table || commandsOf();
  return CATALOG
    .map(([label, name, shortcut]) => ({ label, name, shortcut }))
    .filter(entry => availableCommand(entry.name, commands))
    .map(entry => {
      const found = match(entry.label, needle);
      return { ...entry, kind: "command", weight: found.weight, positions: found.positions };
    })
    .filter(entry => entry.weight > 0);
}
function bufferEntries(needle, documents) {
  if (!documents || typeof documents.list !== "function") return [];
  return documents.list()
    .filter(doc => doc && typeof doc.name === "string")
    .map(doc => {
      const found = match(doc.name, needle);
      return { ...doc, kind: "buffer", label: doc.name, dirty: !!doc.dirty,
        description: (doc.path && doc.path !== doc.name ? doc.path : doc.language || ""),
        weight: found.weight, positions: found.positions };
    })
    .filter(entry => entry.weight > 0);
}
function examplesOf(examplesApi) {
  if (!examplesApi || typeof examplesApi.examples !== "function") return [];
  const list = examplesApi.examples();
  return Array.isArray(list) ? list : [];
}
function exampleEntries(needle, examplesApi) {
  return examplesOf(examplesApi).slice(0, 40)
    .map(example => {
      const label = example && (example.title || example.id || "Example");
      const found = match(label, needle);
      return {
        kind: "example", label,
        description: example && Array.isArray(example.files) && example.files.length
          ? example.files.length + (example.files.length === 1 ? " file" : " files") : "",
        reference: example && example.id,
        weight: found.weight, positions: found.positions
      };
    })
    .filter(entry => entry.weight > 0);
}
/* Files rank on their name first; a path-only hit ("src/ma") ranks lower. */
function fileEntries(needle, index) {
  if (!Array.isArray(index)) return [];
  const out = [];
  for (const file of index) {
    if (!needle) { out.push({ ...file, kind: "file", label: file.name, weight: 1, positions: [] }); continue; }
    const byName = match(file.name, needle);
    if (byName.weight) {
      out.push({ ...file, kind: "file", label: file.name, weight: byName.weight + 5, positions: byName.positions });
      continue;
    }
    if (needle.includes("/") || needle.length > 2) {
      const byPath = match(file.rel, needle);
      if (byPath.weight >= 80) out.push({ ...file, kind: "file", label: file.name,
        weight: byPath.weight - 30, positions: [], pathPositions: byPath.positions });
    }
  }
  return out;
}
function sources(needle, context) {
  return {
    files: fileEntries(needle, context && context.files),
    commands: commandEntries(needle, context && context.commands),
    buffers: bufferEntries(needle, context && context.documents),
    examples: exampleEntries(needle, context && context.examples)
  };
}

/* Bounded breadth-first walk of a File System Access directory handle. */
async function buildFileIndex(directory, limits = FILE_LIMITS) {
  const files = [];
  let truncated = false;
  if (!directory || directory.kind !== "directory" || typeof directory.entries !== "function")
    return { files, truncated };
  const queue = [{ handle: directory, rel: "", depth: 0 }];
  while (queue.length) {
    const { handle, rel, depth } = queue.shift();
    let seen = 0;
    try {
      for await (const [name, child] of handle.entries()) {
        if (++seen > limits.entries) { truncated = true; break; }
        if (SKIP_DIRS.has(name)) continue;
        const path = rel ? rel + "/" + name : name;
        if (child.kind === "directory") {
          if (depth + 1 >= limits.depth) { truncated = true; continue; }
          queue.push({ handle: child, rel: path, depth: depth + 1 });
        } else if (child.kind === "file") {
          files.push({ name, rel: path, dir: rel, handle: child });
          if (files.length >= limits.files) return { files, truncated: true };
        }
      }
    } catch (_) { truncated = true; }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
  return { files, truncated };
}

function badgeFor(name) {
  const explorer = root.FlowStudioExplorer;
  if (explorer && typeof explorer.fileBadge === "function") return explorer.fileBadge(name);
  return { label: "", tone: "other" };
}

function mount(doc, options = {}) {
  const dialog = doc.getElementById("searchEverywhere");
  const query = doc.getElementById("seQuery");
  const groups = doc.getElementById("seGroups");
  if (!dialog || !query || !groups) return null;
  const tabsHost = doc.getElementById("seTabs");
  const footer = doc.getElementById("seFooter");
  mountOptions = options;
  let rows = [];
  let rowNodes = [];
  let selection = 0;
  let scope = "all";
  let lastShiftAt = -1;
  let lastShiftHandled = true;
  let fileIndex = Array.isArray(options.files) ? options.files : null;
  let indexRoot = null;
  let indexing = null;
  let indexTruncated = false;

  function explorer() {
    return options.explorer || root.FlowStudioWorkspaceExplorer || null;
  }
  function folderRoot() {
    const active = explorer();
    try { return active && typeof active.root === "function" ? active.root() : null; }
    catch (_) { return null; }
  }
  /* Rebuild on every open so files created outside FlowStudio show up; the
   * stale list renders at once and the fresh one replaces it when ready. */
  function refreshIndex() {
    if (Array.isArray(options.files)) return null;
    const handle = folderRoot();
    if (!handle) { fileIndex = null; indexRoot = null; return null; }
    if (indexRoot !== handle) fileIndex = null;
    indexRoot = handle;
    const started = indexing = buildFileIndex(handle).then(result => {
      if (indexing !== started || indexRoot !== handle) return;
      fileIndex = result.files;
      indexTruncated = result.truncated;
      indexing = null;
      if (isOpen()) render(query.value || "");
    }, () => { if (indexing === started) indexing = null; });
    return started;
  }

  function runCommand(name) {
    const commands = commandsOf(options.commands);
    if (typeof commands[name] !== "function") return false;
    try { commands[name](); return true; } catch (_) { return false; }
  }
  function openBuffer(docId) {
    const app = mountApp();
    if (app && typeof app.activateDocument === "function" && typeof docId === "string") {
      try { return app.activateDocument(docId) !== null; } catch (_) { return false; }
    }
    return false;
  }
  function openFile(entry) {
    if (typeof options.openFile === "function") return options.openFile(entry);
    const app = mountApp();
    if (!app || typeof app.openEditorHandle !== "function" || !entry.handle) return false;
    const active = explorer();
    const rootName = active && typeof active.rootName === "function" ? active.rootName() : "";
    Promise.resolve(app.openEditorHandle(entry.handle, rootName ? rootName + "/" + entry.rel : entry.rel))
      .catch(() => {});
    return true;
  }
  function openExample(id) {
    const tab = doc.getElementById("tab-examples");
    if (tab && typeof tab.click === "function") tab.click();
    const host = doc.getElementById("examplesHost");
    if (!host || !host.querySelectorAll) return false;
    const card = Array.from(host.querySelectorAll("[data-example-id]"))
      .find(node => ((node.dataset?.exampleId) || "") === id);
    if (!card) return false;
    const open = Array.from(card.querySelectorAll("button.primary"))[0] ||
      Array.from(card.querySelectorAll("button"))[0] || null;
    if (open && typeof open.click === "function") { open.click(); return true; }
    return false;
  }
  function activateRow(entry) {
    close();
    if (!entry) return false;
    if (entry.kind === "command") return runCommand(entry.name);
    if (entry.kind === "buffer") return openBuffer(entry.id ?? entry.documentId);
    if (entry.kind === "file") return openFile(entry);
    if (entry.kind === "example") return openExample(entry.reference);
    return false;
  }
  function activate() { return activateRow(rows[selection]); }
  function isOpen() { return typeof dialog.open === "boolean" ? dialog.open : !dialog.hidden; }
  function close() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    /* Chrome leaves focus pinned inside a programmatically closed dialog;
     * blur so Shift-Shift and shortcut routing behave like a fresh outside
     * target again. */
    try {
      const active = doc.activeElement;
      if (active && typeof active.blur === "function" &&
          typeof dialog.contains === "function" && dialog.contains(active)) active.blur();
    } catch (_) { /* focus restore is best effort */ }
  }
  function open(preset = "", nextScope = "all") {
    scope = TABS.some(([key]) => key === nextScope) ? nextScope : "all";
    if (typeof query.value === "string") query.value = preset;
    refreshIndex();
    render(preset);
    if (typeof dialog.showModal === "function") { if (!isOpen()) dialog.showModal(); }
    else dialog.hidden = false;
    if (typeof query.focus === "function") query.focus();
    if (typeof query.select === "function") query.select();
  }
  function setScope(next) {
    scope = next;
    render(query.value || "");
  }

  function renderTabs(counts) {
    if (!tabsHost || typeof tabsHost.replaceChildren !== "function") return;
    tabsHost.replaceChildren();
    for (const [key, title] of TABS) {
      const tab = doc.createElement("button");
      tab.className = "se-tab" + (key === scope ? " active" : "");
      tab.setAttribute("type", "button");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", key === scope ? "true" : "false");
      tab.setAttribute("tabindex", "-1");
      tab.setAttribute("data-scope", key);
      tab.textContent = title;
      if (key !== "all" && counts && counts[key]) {
        tab.textContent = "";
        const name = doc.createElement("span");
        name.textContent = title;
        const count = doc.createElement("span");
        count.className = "se-tab-count";
        count.textContent = String(counts[key]);
        tab.append(name, count);
      }
      tab.addEventListener?.("mousedown", event => event.preventDefault?.());
      tab.addEventListener?.("click", () => { setScope(key); query.focus?.(); });
      tabsHost.append(tab);
    }
  }
  function highlighted(text, positions) {
    const label = doc.createElement("span");
    label.className = "se-label";
    if (!positions || !positions.length) { label.textContent = text; return label; }
    const marks = new Set(positions);
    let run = "";
    let marked = false;
    const flush = () => {
      if (!run) return;
      const part = doc.createElement(marked ? "mark" : "span");
      part.textContent = run;
      label.append(part);
      run = "";
    };
    for (let i = 0; i < text.length; i++) {
      const hit = marks.has(i);
      if (hit !== marked) { flush(); marked = hit; }
      run += text[i];
    }
    flush();
    return label;
  }
  const ICONS = {
    command: '<path d="M3 5l3 3-3 3"/><path d="M8 11h5"/>',
    buffer: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6h11"/>',
    example: '<path d="M3 2.5h7.5L13 5v8.5H3z"/><path d="M5.5 7.5h5M5.5 10h3"/>'
  };
  function iconFor(entry) {
    const holder = doc.createElement("span");
    holder.className = "se-icon kind-" + entry.kind;
    if (entry.kind === "file" || entry.kind === "buffer") {
      const badge = badgeFor(entry.name || entry.label);
      if (badge.label) {
        const glyph = doc.createElement("span");
        glyph.className = "ex-badge tone-" + badge.tone;
        glyph.textContent = badge.label;
        holder.append(glyph);
        return holder;
      }
    }
    const path = ICONS[entry.kind] || ICONS.buffer;
    if ("innerHTML" in holder || typeof holder.insertAdjacentHTML === "function") {
      holder.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
        'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
    }
    return holder;
  }
  function buildRow(entry, index) {
    const row = doc.createElement("div");
    row.className = "se-row";
    row.setAttribute("role", "option");
    row.setAttribute("id", "se-row-" + index);
    row.setAttribute("data-kind", entry.kind);
    const text = doc.createElement("span");
    text.className = "se-text";
    text.append(highlighted(entry.label, entry.positions));
    const detail = entry.kind === "file" ? entry.dir : entry.description;
    if (detail) {
      const sub = doc.createElement("span");
      sub.className = "se-detail";
      sub.textContent = detail;
      text.append(sub);
    }
    if (entry.kind === "buffer" && entry.dirty) {
      const dot = doc.createElement("span");
      dot.className = "se-dirty";
      dot.setAttribute("title", "Unsaved changes");
      text.append(dot);
    }
    row.append(iconFor(entry), text);
    if (entry.shortcut) {
      const keys = doc.createElement("span");
      keys.className = "se-keys";
      for (const part of entry.shortcut.split("+")) {
        const key = doc.createElement("kbd");
        key.textContent = part;
        keys.append(key);
      }
      row.append(keys);
    }
    row.addEventListener?.("mousedown", event => event.preventDefault?.());
    row.addEventListener?.("mousemove", () => { if (selection !== index) { selection = index; highlight(); } });
    row.addEventListener?.("click", () => activateRow(entry));
    return row;
  }
  function highlight() {
    rowNodes.forEach((row, index) => {
      if (index === selection) row.setAttribute("aria-selected", "true");
      else if (row.getAttribute("aria-selected")) row.setAttribute("aria-selected", "false");
    });
    const current = rowNodes[selection];
    if (current) {
      query.setAttribute?.("aria-activedescendant", current.getAttribute("id"));
      if (typeof current.scrollIntoView === "function") current.scrollIntoView({ block: "nearest" });
    }
  }
  function context() {
    const app = mountApp();                          // Late workbench module: resolve now
    const examples = (mountOptions || {}).examples || root.FlowStudioExamples || null;
    return { documents: app && app.documents, examples, files: fileIndex };
  }
  function render(raw) {
    let needle = String(raw ?? "");
    let effective = scope;
    if (needle.startsWith(">")) { effective = "commands"; needle = needle.slice(1).trimStart(); }
    needle = needle.trim();
    const found = sources(needle, context());
    const order = (a, b) => b.weight - a.weight || a.label.localeCompare(b.label, undefined, { numeric: true });
    const counts = {
      files: found.files.length, commands: found.commands.length,
      buffers: found.buffers.length, examples: found.examples.length
    };
    let sections;
    if (effective === "all") {
      /* With no query, All shows what is open and what can be done; listing
       * every file would bury both. */
      sections = needle
        ? [["Files", found.files], ["Open", found.buffers], ["Commands", found.commands], ["Examples", found.examples]]
        : [["Open", found.buffers], ["Commands", found.commands], ["Examples", found.examples]];
    } else {
      const titles = { files: "Files", commands: "Commands", buffers: "Open", examples: "Examples" };
      sections = [[titles[effective], found[effective]]];
    }
    const limit = effective === "all" ? MAX_RESULTS_PER_GROUP : MAX_RESULTS_SCOPED;
    renderTabs(needle ? counts : null);
    rows = [];
    rowNodes = [];
    if (groups.replaceChildren) groups.replaceChildren();
    for (const [title, matches] of sections) {
      const ranked = matches.sort(order).slice(0, limit);
      if (!ranked.length) continue;
      const heading = doc.createElement("div");
      heading.className = "se-group-title";
      heading.setAttribute("role", "presentation");
      const name = doc.createElement("span");
      name.textContent = title;
      heading.append(name);
      if (matches.length > ranked.length) {
        const more = doc.createElement("span");
        more.className = "se-more";
        more.textContent = (matches.length - ranked.length) + " more";
        heading.append(more);
      }
      groups.append?.(heading);
      for (const entry of ranked) {
        const node = buildRow(entry, rows.length);
        rows.push(entry);
        rowNodes.push(node);
        groups.append?.(node);
      }
    }
    if (!rows.length && groups.append) {
      const empty = doc.createElement("div");
      empty.className = "se-empty";
      empty.textContent = emptyText(effective, needle);
      groups.append(empty);
    }
    if (footer) footer.textContent = footerText(effective);
    selection = 0;
    highlight();
  }
  function emptyText(effective, needle) {
    if (effective === "files" && !folderRoot() && !Array.isArray(options.files))
      return "Open a folder to search its files.";
    if (effective === "files" && indexing && !fileIndex) return "Indexing folder...";
    return needle ? "Nothing matches \"" + needle + "\"." : "Type to search.";
  }
  function footerText(effective) {
    const hint = "Enter opens. Tab switches scope. Type > for commands.";
    if (indexTruncated && (effective === "files" || effective === "all"))
      return hint + " The file list stops at " + FILE_LIMITS.files + " files.";
    return hint;
  }
  function moveSelection(step) {
    if (!rows.length) return;
    selection = (selection + step + rows.length) % rows.length;
    highlight();
  }
  function cycleScope(step) {
    const keys = TABS.map(([key]) => key);
    setScope(keys[(keys.indexOf(scope) + step + keys.length) % keys.length]);
  }
  function onKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault?.();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault?.();
      if (!rows.length) return;
      selection = Math.max(0, Math.min(rows.length - 1, selection + (event.key === "PageDown" ? 8 : -8)));
      highlight();
    } else if (event.key === "Tab") {
      event.preventDefault?.();
      cycleScope(event.shiftKey ? -1 : 1);
    } else if (event.key === "Enter") {
      event.preventDefault?.();
      activate();
    } else if (event.key === "Escape") {
      event.preventDefault?.();
      close();
    }
  }
  query.addEventListener?.("input", () => render(query.value || ""));
  query.addEventListener?.("keydown", onKeyDown);
  dialog.addEventListener?.("click", event => {
    if (event.target !== dialog) return;             // rows inside handle themselves
    /* Open state: backdrop clicks dismiss. Closed state: a programmatic click
     * on the dialog element (the Tools menu data-act target) opens it. */
    if (isOpen()) close();
    else open("");
  });
  doc.addEventListener?.("flowstudio:root", () => { fileIndex = null; indexRoot = null; });

  /* Double-Shift: two Shift keydowns within the window, no other modifiers,
   * not opening from inside the search dialog. Ctrl+P opens Files and
   * Ctrl+K opens Commands, as in VS Code. */
  function onShiftKey(event) {
    if (event.key !== "Shift" || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey) { lastShiftAt = -1; return; }
    const now = Date.now();
    if (!lastShiftHandled && now - lastShiftAt <= SHIFT_WINDOW_MS) {
      lastShiftHandled = true;
      lastShiftAt = -1;
      const insideSearch = event.target &&
        (event.target.id === "seQuery" ||
         (typeof event.target.closest === "function" && event.target.closest("#searchEverywhere")));
      if (!insideSearch) { event.preventDefault?.(); open(); }
      return;
    }
    lastShiftHandled = false;
    lastShiftAt = now;
  }
  function onShortcut(event) {
    if (event.key === "Shift") return onShiftKey(event);
    lastShiftAt = -1;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = String(event.key || "").toLowerCase();
    if (key !== "k" && key !== "p") return;
    /* In the integrated terminal Ctrl+K and Ctrl+P are readline keys. */
    if (event.ctrlKey && event.target && typeof event.target.closest === "function" &&
        event.target.closest(".xterm")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    open("", key === "p" ? "files" : "commands");
  }
  if (typeof doc.addEventListener === "function") doc.addEventListener("keydown", onShortcut, true);

  const launcher = doc.getElementById("commandLauncher");
  launcher?.addEventListener?.("click", () => open(""));
  const launcherLabel = doc.getElementById("commandLauncherLabel");
  function labelLauncher() {
    if (!launcherLabel) return;
    const active = explorer();
    const name = active && typeof active.rootName === "function" ? active.rootName() : null;
    launcherLabel.textContent = name ? "Search " + name : "Search FlowStudio";
  }
  doc.addEventListener?.("flowstudio:root", labelLauncher);
  labelLauncher();

  const instance = Object.freeze({
    open, close, render: () => render(query.value || ""), activate,
    moveSelection, setScope, scope: () => scope,
    rows: () => rows.slice(),
    selection: () => selection,
    isOpen,
    ranking: score,
    shift: onShiftKey,
    shortcut: onShortcut,
    refreshIndex,
    catalog: () => CATALOG.slice(),
    dispose() { close(); }
  });
  return instance;
}

const api = {
  mount, score, match, buildFileIndex, fileEntries, SHIFT_WINDOW_MS, MAX_RESULTS_PER_GROUP, TABS,
  catalogSource: () => CATALOG.slice(), instance: null
};
root.FlowStudioSearchEverywhere = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined") {
  const start = () => {
    try { api.instance = mount(document, {}); } catch (_) { /* Search enhancement is optional. */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
