/* FlowStudio Search Everywhere (JetBrains double-Shift overlay).
 * Searches commands (menu + palette catalog), open buffers and curated
 * examples with boundary-aware fuzzy scoring, fully keyboard driven.
 * Opening a buffer result reuses the workspace activateDocument contract via
 * FlowStudioApp; commands go through the workspace command registry. */
(function (root) {
"use strict";

let mountOptions = null;    /* The bundled workbench module may assign
 * FlowStudioApp after this engine's DOMContentLoaded mount, so the app,
 * its commands and documents resolve lazily per render, never at mount. */
const SHIFT_WINDOW_MS = 350;
const MAX_RESULTS_PER_GROUP = 7;
const CATALOG = Object.freeze([
  ["New buffer", "newDocument", "Ctrl+Alt+N"],
  ["Open file", "openFile", "Ctrl+O"],
  ["Open folder", "openFolder", ""],
  ["Save file", "saveFile", "Ctrl+S"],
  ["Find in buffer", "focusFind", "Ctrl+F"],
  ["Replace in buffer", "focusReplace", "Ctrl+H"],
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
  ["Show project files", "showFiles", ""],
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

/* Boundary-aware ranking: word starts rank above substring, substring above
 * subsequence; earlier matches tie-break earlier positions. */
function score(label, needle) {
  if (!needle) return 1;
  const haystack = label.toLowerCase();
  const query = needle.toLowerCase();
  const at = haystack.indexOf(query);
  if (at === 0) return 100;
  if (at > 0 && /[\s\-—·_/.:]/.test(haystack[at - 1])) return 90;
  if (at > 0) return 80;
  let cursor = -1; /* subsequence */
  let hits = 0;
  for (const char of query) {
    cursor = haystack.indexOf(char, cursor + 1);
    if (cursor < 0) return 0;
    hits++;
  }
  return hits === query.length ? 10 : 0;
}
function collectCommands(needle, table) {
  const commands = table || commandsOf();
  return CATALOG
    .map(([label, name, shortcut]) => ({ label, name, shortcut }))
    .filter(entry => availableCommand(entry.name, commands))
    .map(entry => ({ ...entry, kind: "command", weight: score(entry.label, needle) }))
    .filter(entry => entry.weight > 0);
}
function collectBuffers(needle, documents) {
  if (!documents || typeof documents.list !== "function") return [];
  return documents.list()
    .filter(doc => doc && typeof doc.name === "string")
    .map(doc => ({ ...doc, kind: "buffer", label: doc.name +
        (doc.dirty ? " ●" : "") + (doc.language ? " · " + doc.language : ""),
      weight: score(doc.name, needle) }))
    .filter(entry => entry.weight > 0);
}
function examplesOf(examplesApi) {
  if (!examplesApi || typeof examplesApi.examples !== "function") return [];
  const list = examplesApi.examples();
  return Array.isArray(list) ? list : [];
}
function collectExamples(needle, examplesApi) {
  return examplesOf(examplesApi).slice(0, 40)
    .map(example => ({
      kind: "example",
      label: example && (example.title || example.id || "Example"),
      description: example && Array.isArray(example.files) && example.files.length
        ? example.files.length + (example.files.length === 1 ? " file" : " files") : "",
      reference: example && example.id,
      weight: score(example && (example.title || example.id || ""), needle)
    }))
    .filter(entry => entry.weight > 0);
}
function sources(needle, context) {
  return {
    commands: collectCommands(needle, context && context.commands),
    buffers: collectBuffers(needle, context && context.documents),
    examples: collectExamples(needle, context && context.examples)
  };
}

function mount(doc, options = {}) {
  const dialog = doc.getElementById("searchEverywhere");
  const query = doc.getElementById("seQuery");
  const groups = doc.getElementById("seGroups");
  if (!dialog || !query || !groups) return null;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = root.localStorage || null; } catch (_) { storage = null; }
  }
  mountOptions = options;
  let rows = [];
  let selection = 0;
  let lastShiftAt = -1;
  let lastShiftHandled = true;

  function runCommand(name) {
    const commands = commandsOf(options.commands);
    if (typeof commands[name] !== "function") return false;
    try { commands[name](); return true; } catch (_) { return false; }
  }
  function openBuffer(docId) {
    const app = mountApp();
    if (app && typeof app.activateDocument === "function" && typeof docId === "string") {
      return runCommandEnabled(() => app.activateDocument(docId) !== null);
    }
    return false;
  }
  function runCommandEnabled(run) {
    try { run(); return true; } catch (_) { return false; }
  }
  function openExample(id) {
    close();
    const tab = doc.getElementById("tab-examples");
    if (tab && typeof tab.click === "function") tab.click();
    const host = doc.getElementById("examplesHost");
    if (!host || !host.querySelectorAll) return false;
    const match = Array.from(host.querySelectorAll("[data-example-id]"))
      .find(card => ((card.dataset?.exampleId) || "") === id);
    if (!match) return false;
    const open = Array.from(match.querySelectorAll("button.primary"))[0] ||
      Array.from(match.querySelectorAll("button"))[0] || null;
    if (open && typeof open.click === "function") { open.click(); return true; }
    return false;
  }
  function activateRow(entry) {
    close();
    if (!entry) return false;
    if (entry.kind === "command") return runCommand(entry.name);
    if (entry.kind === "buffer") return openBuffer(entry.id ?? entry.documentId);
    if (entry.kind === "example") return openExample(entry.reference);
    return false;
  }
  function activate() {
    return activateRow(rows[selection]);
  }
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
  function open(preset = "") {
    if (typeof query.value === "string") query.value = preset;
    render(preset);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.hidden = false;
    if (typeof query.focus === "function") query.focus();
    else if (typeof query.select === "function") query.select();
  }
  function highlight() {
    const rendered = Array.from(groups.querySelectorAll(".se-row"));
    rendered.forEach((row, index) => {
      if (index === selection) row.setAttribute("aria-selected", "true");
      else if (row.getAttribute("aria-selected")) row.setAttribute("aria-selected", "false");
    });
  }
  function buildRow(entry) {
    const row = doc.createElement("div");
    row.className = "se-row";
    row.setAttribute("role", "option");
    const kind = doc.createElement("span");
    kind.className = "se-kind";
    kind.textContent = entry.kind;
    const label = doc.createElement("span");
    label.className = "se-label";
    label.textContent = entry.label;
    const meta = doc.createElement("span");
    meta.className = "se-meta";
    meta.textContent = entry.shortcut || entry.description || "";
    row.append(kind, label, meta);
    row.addEventListener?.("click", () => activateRow(entry));
    return row;
  }
  function render(needle) {
    const { commands, buffers, examples: matchedExamples } =
      sources(needle ?? "", (() => {
        const app = mountApp();                      // Late workbench module: resolve now
        const examples = (mountOptions || {}).examples || root.FlowStudioExamples || null;
        return { documents: app && app.documents, examples };
      })());
    const sections = [
      ["Commands", commands],
      ["Open buffers", buffers],
      ["Examples", matchedExamples]
    ];
    rows = [];
    if (groups.replaceChildren) groups.replaceChildren();
    for (const [title, matches] of sections) {
      const ranked = matches
        .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
        .slice(0, MAX_RESULTS_PER_GROUP);
      if (!ranked.length) continue;
      const heading = doc.createElement("div");
      heading.className = "se-group-title";
      heading.textContent = title;
      if (groups.append) groups.append(heading);
      for (const entry of ranked) {
        rows.push(entry);
        if (groups.append) groups.append(buildRow(entry));
      }
    }
    if (!rows.length && groups.replaceChildren) {
      const empty = doc.createElement("div");
      empty.className = "se-empty";
      empty.textContent = "No matches. Search commands, buffers or examples.";
      groups.append(empty);
    }
    if (rows.length) selection = 0;
    else selection = 0;
    highlight();
  }
  function moveSelection(step) {
    if (!rows.length) return;
    selection = (selection + step + rows.length) % rows.length;
    highlight();
  }
  function onKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault?.();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
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
    if (typeof dialog.open === "boolean" ? dialog.open : !dialog.hidden) close();
    else open("");
  });

  /* Double-Shift: two Shift keydowns within the window, no other modifiers,
   * not opening from inside the search dialog or the existing palette. */
  function onShiftKey(event) {
    if (event.key !== "Shift" || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey) { lastShiftAt = -1; return; }
    const now = Date.now();
    if (!lastShiftHandled && now - lastShiftAt <= SHIFT_WINDOW_MS) {
      lastShiftHandled = true;
      lastShiftAt = -1;
      const insideSearch = event.target &&
        (event.target.id === "seQuery" ||
         (typeof event.target.closest === "function" &&
          (event.target.closest("#searchEverywhere") || event.target.closest("#commandPalette"))));
      if (!insideSearch) { event.preventDefault?.(); open(); }
      return;
    }
    lastShiftHandled = false;
    lastShiftAt = now;
  }
  if (typeof doc.addEventListener === "function") {
    doc.addEventListener("keydown", onShiftKey, true);
  }

  return Object.freeze({
    open, close, render: () => render(query.value || ""), activate,
    moveSelection,
    rows: () => rows.slice(),
    selection: () => selection,
    isOpen: () => typeof dialog.open === "boolean" ? dialog.open : !dialog.hidden,
    ranking: score,
    shift: onShiftKey,
    catalog: () => CATALOG.slice(),
    dispose() { close(); }
  });
}

const api = Object.freeze({
  mount, score, SHIFT_WINDOW_MS, MAX_RESULTS_PER_GROUP,
  catalogSource: () => CATALOG.slice()
});
root.FlowStudioSearchEverywhere = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined") {
  const start = () => {
    try { mount(document, {}); } catch (_) { /* Search enhancement is optional. */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
