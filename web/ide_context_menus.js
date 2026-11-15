/* The right-click menus of FlowStudio's panels, on the shared component in
 * web/ide_context_menu.js. The explorer builds its own (web/ide_explorer.js)
 * and the editor extends Monaco's (frontend/editor_context.js). This file
 * covers editor tabs, the console, the terminal, the Environment pane and
 * the Plots pane, plus pinned tabs and Cmd/Ctrl+Shift+P for the command
 * palette. Every item calls the same code its button or shortcut does.
 */
(function (root) {
"use strict";

const PY_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const R_IDENT = /^(?:[A-Za-z]|\.(?![0-9]))[A-Za-z0-9._]{0,79}$/;

/* ---------- pure helpers (unit tested) ---------- */

/* Tab order as shown: pinned tabs first, each group in open order. */
function visualOrder(list, pinned) {
  return list.filter(doc => pinned.has(doc.id)).concat(list.filter(doc => !pinned.has(doc.id)));
}
/* Which documents each close command closes. Pinned tabs stay unless the
 * command names them directly, as in VS Code. */
function closeTargets(command, list, id, pinned) {
  const order = visualOrder(list, pinned);
  const index = order.findIndex(doc => doc.id === id);
  const loose = doc => !pinned.has(doc.id);
  switch (command) {
    case "close": return order.filter(doc => doc.id === id);
    case "others": return order.filter(doc => doc.id !== id && loose(doc));
    case "right": return index < 0 ? [] : order.slice(index + 1).filter(loose);
    case "saved": return order.filter(doc => !doc.dirty && loose(doc));
    case "all": return order.filter(loose);
    default: return [];
  }
}
/* Python and R code for the Environment pane's actions. Names are checked
 * against the language's identifier rules before they reach the session. */
function variableCode(runtime, action, name) {
  if (runtime === "python") {
    if (!PY_IDENT.test(name)) throw new Error("\"" + name + "\" is not a Python name.");
    if (action === "value") return "print(repr(" + name + "))";
    if (action === "remove") return "del " + name;
  } else if (runtime === "r") {
    if (!R_IDENT.test(name)) throw new Error("\"" + name + "\" is not an R name.");
    if (action === "value") return "print(" + name + ")";
    if (action === "remove") return "rm(" + name + ")";
  }
  throw new Error("Unsupported variable action.");
}
function relativePath(path, rootName) {
  if (!path) return "";
  return rootName && path.startsWith(rootName + "/") ? path.slice(rootName.length + 1) : path;
}

/* ---------- DOM wiring ---------- */

function mount(doc) {
  const menu = root.FlowStudioContextMenu;
  const app = root.FlowStudioApp;
  if (!menu || !app) return null;
  const mac = menu.isMacPlatform(root.navigator);
  const copy = menu.copyText;
  const status = menu.status;
  const el = id => doc.getElementById(id);

  /* ----- editor tabs ----- */
  const pinned = new Set();
  function explorer() { return root.FlowStudioWorkspaceExplorer || null; }
  function closeMany(docs) {
    let closed = 0;
    for (const item of docs) if (app.documents.find(item.id) && app.closeDocument(item.id)) closed++;
    return closed;
  }
  function togglePin(id) {
    if (pinned.has(id)) pinned.delete(id); else pinned.add(id);
    app.renderTabs();
    const tab = doc.querySelector('#docTabs .doc-tab[data-doc-id="' + id + '"]');
    if (tab) tab.focus();
  }
  /* Called by renderTabs in index.html for every tab it draws. */
  function decorate(tab, item) {
    if (!pinned.has(item.id)) return;
    tab.classList.add("pinned");
    tab.dataset.pinned = "true";
    const close = tab.querySelector(".doc-tab-close");
    const pin = doc.createElement("button");
    pin.type = "button";
    pin.className = "doc-tab-pin";
    pin.title = "Unpin";
    pin.setAttribute("aria-label", "Unpin " + (item.path || item.name));
    pin.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5l4 4-2 1-2.5 2.5.5 3-1 1-3-3-3.5 3.5M6 9.5l-3-3 1-1 3 .5L9.5 3.5z"/></svg>';
    pin.addEventListener("click", event => { event.stopPropagation(); togglePin(item.id); });
    if (close) close.replaceWith(pin); else tab.append(pin);
  }
  doc.addEventListener("flowstudio:documents", () => {
    for (const id of [...pinned]) if (!app.documents.find(id)) pinned.delete(id);
  });
  function tabItems(context) {
    const id = context.element.dataset.docId;
    const item = app.documents.find(id);
    if (!item) return null;
    const list = app.documents.list();
    const active = app.documents.active();
    const count = command => closeTargets(command, list, id, pinned).length;
    const rootName = explorer() && explorer().hasRoot() ? explorer().rootName() : null;
    const inFolder = Boolean(item.path && rootName && item.path.startsWith(rootName + "/"));
    const split = root.FlowStudioSplitEditor;
    return [
      { label: "Close", shortcut: active && active.id === id ? "Mod+W" : "", run: () => app.closeDocument(id) },
      { label: "Close Others", disabled: count("others") ? false : "No other unpinned tabs are open.",
        run: () => closeMany(closeTargets("others", app.documents.list(), id, pinned)) },
      { label: "Close to the Right", disabled: count("right") ? false : "No unpinned tabs are to the right.",
        run: () => closeMany(closeTargets("right", app.documents.list(), id, pinned)) },
      { label: "Close Saved", disabled: count("saved") ? false : "Every unpinned tab has unsaved changes.",
        run: () => closeMany(closeTargets("saved", app.documents.list(), id, pinned)) },
      { label: "Close All", disabled: count("all") ? false : "Every tab is pinned.",
        run: () => closeMany(closeTargets("all", app.documents.list(), id, pinned)) },
      null,
      { label: "Copy Path", disabled: item.path ? false : "An untitled buffer has no path yet. Save it first.",
        run: () => copy(item.path, "path") },
      { label: "Copy Relative Path", disabled: inFolder ? false : "This file is not in the open folder.",
        run: () => copy(relativePath(item.path, rootName), "relative path") },
      { label: "Reveal in Explorer", shortcut: active && active.id === id ? "Alt+F1" : "", disabled: inFolder ? false : "This file is not in the open folder.",
        run: async () => {
          const tab = el("tab-files");
          if (tab) tab.click();
          if (!(await explorer().reveal(item.path, true))) status("Could not find " + item.path + " in the explorer.", "error");
        }, keepFocus: true },
      null,
      { label: "Split Right", disabled: split && split.available() ? false : "The split editor needs the Monaco editor.",
        run: () => split.open(id), keepFocus: true },
      { label: pinned.has(id) ? "Unpin" : "Pin", run: () => togglePin(id), keepFocus: true }
    ];
  }
  menu.register({ name: "Tab", label: "Editor tab actions", selector: "#docTabs .doc-tab[data-doc-id]", items: tabItems });

  /* ----- console ----- */
  function consoleView() { return root.FlowStudioConsoleView || null; }
  function selectedIn(container) {
    const selection = root.getSelection ? root.getSelection() : null;
    if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
    const range = selection.getRangeAt(0);
    return container.contains(range.commonAncestorContainer) ? String(selection) : "";
  }
  async function fixWithAssistant(text, run) {
    const assistant = root.FlowStudioAssistant;
    if (!assistant) { status("The assistant is not available.", "error"); return false; }
    const request = "Fix this error from the " + (run ? run.runtime : "") + " console:\n" + text +
      (run && run.code ? "\n\nThe command was:\n" + run.code : "");
    assistant.open(false);
    const sent = await assistant.send("ask", request);
    if (!sent) {
      // No assistant installed or busy: leave the request ready to send.
      const input = doc.querySelector("#assistantRoot textarea");
      if (input) { input.value = request; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); }
    }
    return sent;
  }
  function consoleItems(context) {
    const view = consoleView();
    if (!view) return null;
    const transcript = view.transcript();
    const entry = context.keyboard ? null : view.entryFor(context.target);
    const run = entry ? view.runOf(entry) : view.lastRun();
    const line = context.target && context.target.closest ? context.target.closest(".term-msg, .term-line") : null;
    const message = context.target && context.target.closest ? context.target.closest(".term-msg") : null;
    const kind = message ? message.dataset.msgKind : "";
    const selection = selectedIn(transcript);
    const lineText = line ? line.textContent.trim() : "";
    const items = [
      { label: "Copy", shortcut: "Mod+C", disabled: selection || lineText ? false : "Select some output first.",
        run: () => copy(selection || lineText, selection ? "selection" : "line") },
      { label: "Copy Output of This Run", disabled: !run ? "Nothing has run in this session yet." :
          run.output ? false : "This run printed nothing.",
        run: () => copy(run.output, "the output of this run") },
      { label: "Copy Command", disabled: !run ? "Nothing has run in this session yet." :
          run.code ? false : "Editor runs have no command line. Copy the code from the editor.",
        run: () => copy(run.code, "command") },
      { label: "Run Again", disabled: !run ? "Nothing has run in this session yet." :
          run.code ? false : "Run the file again from the editor.",
        run: () => view.rerun(run) }
    ];
    if (kind === "error" || kind === "warning") {
      const lineNumber = Number(message.dataset.line);
      const text = message.querySelector(".term-text") ? message.querySelector(".term-text").textContent : message.textContent;
      items.push(null);
      if (lineNumber) items.push({ label: "Go to Line " + lineNumber,
        disabled: message.dataset.source === "editor" ? false : "This line number counts lines of the console entry.",
        run: () => view.goToLine(lineNumber, Number(message.dataset.column) || 1), keepFocus: true });
      items.push({ label: "Fix with Assistant", run: () => fixWithAssistant(text, run), keepFocus: true });
    }
    items.push(null,
      { label: "Search", shortcut: "Mod+F", run: () => view.search(), keepFocus: true },
      { label: "Clear", shortcut: "Mod+L", run: () => view.clear() });
    return items;
  }
  menu.register({ name: "Console", label: "Console actions", selector: "#terminalRoot", items: consoleItems,
    anchor: context => context.target });

  /* ----- terminal ----- */
  function terminalItems() {
    const panel = root.FlowStudioTerminal;
    const instance = panel && panel.active;
    if (!panel || !instance || !instance.term) return null;
    const term = instance.term;
    const selection = term.hasSelection() ? term.getSelection() : "";
    return [
      { label: "Copy", shortcut: mac ? "Mod+C" : "", disabled: selection ? false : "Select text in the terminal first.",
        run: () => copy(selection, "terminal selection") },
      { label: "Paste", shortcut: mac ? "Mod+V" : "", disabled: instance.exited ? "This terminal has exited." : false,
        run: async () => {
          const clipboard = root.navigator && root.navigator.clipboard;
          if (!clipboard || typeof clipboard.readText !== "function") throw new Error("Clipboard reading is not available.");
          const text = await clipboard.readText();
          if (text) term.paste(text);
          term.focus();
        } },
      { label: "Select All", shortcut: mac ? "Mod+A" : "", run: () => { term.selectAll(); term.focus(); } },
      { label: "Clear", run: () => { term.clear(); term.focus(); } },
      null,
      { label: "New Terminal", shortcut: "Ctrl+Shift+`", run: () => panel.create(), keepFocus: true },
      { label: "Kill Terminal", danger: true, run: () => panel.kill(instance), keepFocus: true }
    ];
  }
  menu.register({ name: "Terminal", label: "Terminal actions", selector: "#shellTerminal", items: terminalItems,
    anchor: () => { const panel = root.FlowStudioTerminal; return panel && panel.active ? panel.active.host : null; } });

  /* ----- environment ----- */
  async function runQuiet(runtime, code) {
    const response = await fetch("/api/run/" + runtime, {
      method: "POST", body: code,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text.trim().split("\n").pop() || "HTTP " + response.status);
    return text;
  }
  function refreshEnvironment() { const button = el("refreshPythonEnvironment"); if (button) button.click(); }
  function variableOf(row) {
    const table = row.closest("table");
    if (!table || row.querySelector("th")) return null;
    const caption = table.querySelector("caption");
    const label = caption ? caption.textContent : "";
    const runtime = table.classList.contains("flow-env") ? "flow" : /\bR\b/.test(label) ? "r" : /Python/.test(label) ? "python" : null;
    if (!runtime) return null;
    const cells = row.querySelectorAll(":scope > td");
    if (!cells.length) return null;
    const summary = cells[0].querySelector("summary");
    const name = row.dataset.name || (summary ? summary.textContent : cells[0].textContent).replace(/ \(mut\)$/, "").trim();
    const type = cells[1] ? cells[1].textContent.trim() : "";
    const value = runtime === "flow" && cells[2] ? cells[2].textContent : null;
    return { runtime, name, type, value, viewable: Boolean(row.querySelector(".flow-env-view")) };
  }
  function environmentItems(context) {
    const variable = variableOf(context.element);
    if (!variable) return null;
    const { runtime, name, type } = variable;
    const frame = (runtime === "r" && type === "data.frame") || (runtime === "python" && type === "DataFrame");
    const dataView = root.FlowStudioDataView && root.FlowStudioDataView.instance;
    const items = [
      { label: "View Data", disabled: runtime === "flow" ? (variable.viewable ? false : "Only arrays and structs open in the data viewer.") :
          frame && dataView ? false : "Only data frames open in the data viewer.",
        run: () => runtime === "flow" ? root.FlowStudioFlowData.open(name) :
          dataView.openFrame({ runtime, name, rows: null, cols: null }), keepFocus: true },
      { label: "Copy Value", run: async () => {
          if (runtime === "flow") return copy(variable.value, "value of " + name);
          const text = await runQuiet(runtime, variableCode(runtime, "value", name));
          return copy(text.replace(/\n$/, ""), "value of " + name);
        } },
      { label: "Copy Name", run: () => copy(name, "name") }
    ];
    if (runtime === "python" || runtime === "r") {
      items.push(null, { label: "Remove Variable", danger: true, run: async () => {
        if (!root.confirm("Remove " + name + " from the " + (runtime === "r" ? "R" : "Python") + " session?")) return false;
        await runQuiet(runtime, variableCode(runtime, "remove", name));
        status("Removed " + name, "ok");
        refreshEnvironment();
        return true;
      } });
    }
    items.push(null, { label: "Refresh", run: () => refreshEnvironment() });
    return items;
  }
  menu.register({ name: "Environment", label: "Variable actions", selector: "#pythonEnvironment tr", items: environmentItems });

  /* ----- plots ----- */
  function plotItems() {
    const panes = root.FlowStudioPlotPane;
    const pane = panes && panes.instance;
    if (!pane) return null;
    const item = pane.current();
    const none = item ? false : "No plot is shown.";
    const pdf = item && item.kind === "pdf";
    return [
      { label: "Copy Image", disabled: none || (pdf ? "PDF figures cannot be copied as an image." : false),
        run: async () => {
          if (typeof root.ClipboardItem !== "function" || !root.navigator.clipboard || !root.navigator.clipboard.write)
            throw new Error("Copying images is not available in this browser.");
          await root.navigator.clipboard.write([new root.ClipboardItem({ "image/png": pane.imageBlob("png") })]);
          status("Copied " + item.label + " as an image", "ok");
        } },
      { label: "Save as PNG...", disabled: none || (pdf ? "PDF figures save from the figure itself." : false), run: () => pane.save("png") },
      { label: "Save as SVG...", disabled: none || (item.kind === "svg" ? false : "Only vector plots save as SVG."), run: () => pane.save("svg") },
      { label: "Open in New Window", disabled: none, run: async () => {
          let url;
          if (pdf) { const embed = el("plotStage").querySelector("embed"); url = embed && embed.src; }
          else url = URL.createObjectURL(await pane.imageBlob(item.kind === "svg" ? "svg" : "png"));
          if (!url) throw new Error("The figure is not ready.");
          root.open(url, "_blank", "noopener");
          if (!pdf) setTimeout(() => URL.revokeObjectURL(url), 60000);
        } },
      null,
      { label: "Previous Plot", shortcut: "Left", disabled: pane.position() > 0 ? false : "This is the first plot.", run: () => pane.back() },
      { label: "Next Plot", shortcut: "Right", disabled: pane.position() < pane.size() - 1 ? false : "This is the latest plot.", run: () => pane.forward() },
      null,
      { label: "Delete Plot", danger: true, disabled: none, run: () => pane.remove() },
      { label: "Clear All Plots", danger: true, disabled: none, run: () => pane.clear() }
    ];
  }
  menu.register({ name: "Plots", label: "Plot actions", selector: "#plotStage", items: plotItems });

  /* Cmd/Ctrl+Shift+P opens the command palette from anywhere, as in VS Code. */
  doc.addEventListener("keydown", event => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
    if ((event.key || "").toLowerCase() !== "p") return;
    event.preventDefault();
    event.stopPropagation();
    menu.commandPalette();
  }, true);

  return Object.freeze({ decorate, pinned: () => [...pinned], togglePin, isPinned: id => pinned.has(id) });
}

const api = Object.freeze({ mount, visualOrder, closeTargets, variableCode, relativePath });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioContextMenus = api;
if (typeof document !== "undefined" && root.FlowStudioApp && root.FlowStudioContextMenu) {
  try { root.FlowStudioEditorTabs = mount(document); }
  catch (error) { if (root.console) root.console.error("FlowStudio context menus failed to mount: " + (error && error.message)); }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
