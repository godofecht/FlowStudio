/* FlowStudio terminal console: sessions, tabs, integrated prompt.
 *
 * Execution stays on the Flow-owned localhost HTTP routes with the same
 * headers and busy-locks as before. The dock is one uninterrupted transcript
 * whose prompt sits inline after the latest output (no floating form fields).
 * Runtime tabs keep their own scrollback and history while sessions of one
 * runtime share the single persistent interpreter the native server provides;
 * the UI states that plainly instead of inventing parallel kernels.
 */
(function (root) {
"use strict";
const TERMINAL = (typeof module !== "undefined" && module.exports) ?
  require("./terminal_render.js") : (root.FlowStudioTerminal || null);
const SESSION_MODULE = root.FlowStudioTerminalSessions;
const INPUT_MODULE = root.FlowStudioTerminalInput;
const PLOT_MODULE = root.FlowStudioPlotFigures;

const DOM_NODES_MAX = 800;   // painted nodes; older output collapses to a divider
const NEAR_BOTTOM_PX = 48;

function h(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function mount(doc = document, request = fetch) {
  const el = id => doc.getElementById(id);
  const output = el("console");
  if (!output || !output.parentElement) throw new Error("Missing console panel");
  if (!SESSION_MODULE || !INPUT_MODULE || !TERMINAL)
    throw new Error("Terminal modules missing (terminal_sessions/terminal_input/render)");
  const language = el("language");
  const result = el("resultStatus"), editorRun = el("run"), editorCell = el("runCell");
  const panel = output.parentElement;
  const sessions = SESSION_MODULE.create({
    runtime: () => (language && language.value ? language.value : "flow"),
    clock: () => new Date()
  });

  /* ---------- shell construction (single ordered pass) ---------- */
  const tabbar = h(doc, "div", "terminal-tabs");
  tabbar.setAttribute("role", "tablist");
  tabbar.setAttribute("aria-label", "Console runtime sessions");
  const statusRow = h(doc, "div", "terminal-status");
  const stateNode = h(doc, "span", "terminal-state");
  const stateDot = h(doc, "span", "terminal-state-dot");
  const stateText = h(doc, "span", "terminal-state-label");
  const runtimeLabel = h(doc, "span", "terminal-runtime-label");
  const durationNode = h(doc, "span", "terminal-duration");
  const statusActions = h(doc, "span", "terminal-actions");
  const searchToggle = h(doc, "button", "terminal-iconbtn");
  searchToggle.type = "button";
  searchToggle.id = "terminalSearchToggle";
  searchToggle.textContent = "⌕";
  searchToggle.title = "Search this session (Ctrl+F)";
  searchToggle.setAttribute("aria-label", "Search session history");
  const menuButton = h(doc, "button", "terminal-iconbtn");
  menuButton.type = "button";
  menuButton.id = "terminalMenuToggle";
  menuButton.textContent = "⋯";
  menuButton.title = "Session menu";
  menuButton.setAttribute("aria-haspopup", "menu");
  menuButton.setAttribute("aria-expanded", "false");
  stateNode.append(stateDot, stateText);
  statusActions.append(searchToggle, menuButton);
  statusRow.append(stateNode, runtimeLabel, durationNode, statusActions);

  const searchbar = h(doc, "div", "terminal-searchbar");
  searchbar.hidden = true;
  const searchInput = h(doc, "input");
  searchInput.type = "search";
  searchInput.id = "terminalSearchInput";
  searchInput.placeholder = "Filter these entries…";
  searchInput.setAttribute("aria-label", "Filter terminal entries");
  const searchCount = h(doc, "span", "terminal-searchcount");
  const searchClose = h(doc, "button", "terminal-iconbtn");
  searchClose.type = "button";
  searchClose.textContent = "×";
  searchClose.title = "Close search";
  searchClose.setAttribute("aria-label", "Close search");
  searchbar.append(searchInput, searchCount, searchClose);

  const transcript = h(doc, "div", "terminal-transcript");
  transcript.tabIndex = 0;
  transcript.setAttribute("aria-label", "Terminal transcript");
  // #console keeps its id and log role; it now hosts rendered entries only.
  output.className = "terminal-entries";
  output.textContent = "";
  transcript.append(output);
  const prompt = INPUT_MODULE.createPrompt(doc, {
    initialRuntime: sessions.active().runtime,
    onExecute(field) { void controller.run(field); },
    onHistoryUp(field) { historyRecall(field, -1); },
    onHistoryDown(field) { historyRecall(field, 1); }
  });
  transcript.append(prompt.node);

  /* ---------- session → tab rendering ---------- */
  let activeId = sessions.active().id;
  const draftsBySession = new Map();

  function renderTabs() {
    tabbar.replaceChildren();
    for (const session of sessions.all()) {
      const tab = h(doc, "button", "terminal-tab");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.dataset.runtime = session.runtime;
      tab.textContent = session.runtime === "flow" ? "Flow" :
        session.runtime === "python" ? "Python" : "R";
      if (session.ordinal > 1)
        tab.append(h(doc, "span", "terminal-tab-suffix", " " + session.ordinal));
      if (session.running || session.unread)
        tab.append(h(doc, "span",
          session.running ? "terminal-dot terminal-dot-live" :
            "terminal-dot terminal-dot-unread"));
      if (session.id === activeId) tab.setAttribute("aria-selected", "true");
      else tab.removeAttribute("aria-selected");
      tab.title = session.runtime + " session " + session.ordinal +
        (session.runtime === "flow" ? "" : " (shares the persistent runtime)");
      tab.addEventListener("click", () => {
        draftsBySession.set(activeId, prompt.value);
        sessions.setActive(session.id);
      });
      tabbar.append(tab);
    }
    const plus = h(doc, "button", "terminal-tab terminal-tab-new");
    plus.type = "button";
    plus.id = "terminalNewSession";
    plus.textContent = "+";
    plus.title = "New session for " + sessions.active().runtime;
    plus.setAttribute("aria-label", "New session for the active runtime");
    plus.addEventListener("click", () => {
      draftsBySession.set(activeId, prompt.value);
      sessions.createFor(sessions.active().runtime);
      sessions.activateRuntime(sessions.active().runtime);
    });
    tabbar.append(plus);
  }

  function renderStatus() {
    const session = sessions.active();
    stateDot.className = "terminal-state-dot " +
      (session.state === "ready" ? "ok" :
        session.state === "error" ? "warn" :
        session.state === "disconnected" ? "bad" :
        session.state === "running" ? "live" : "");
    stateText.textContent = SESSION_MODULE.STATE_LABELS[session.state] || session.state;
    stateNode.title = stateText.textContent;
    runtimeLabel.textContent = session.runtime + " · session " + session.ordinal +
      (session.runtime === "flow" ? "" : " · shared interpreter");
    durationNode.textContent =
      session.running && session.lastCommandTs ?
        "running " + SESSION_MODULE.formatDuration(Date.now() - session.lastCommandTs) :
        session.state !== "running" && session.lastDurationMs !== null ?
          "last " + SESSION_MODULE.formatDuration(session.lastDurationMs) : "";
  }

  function entryNode(entry, session) {
    const line = h(doc, "div", "term-line");
    line.dataset.kind = entry.kind;
    if (entry.kind === "fig") {
      line.append(h(doc, "span", "term-body term-meta",
        "figure " + entry.figIndex + (entry.language ? " (" + entry.language + ")" : "")));
      line.dataset.figPending = "1";
      return line;
    }
    if (entry.ts) line.append(h(doc, "span", "term-ts", entry.ts));
    const body = h(doc, "span", "term-body" +
      (entry.kind === "cmd" ? " term-cmd" :
        entry.kind === "meta" ? " term-meta" :
        entry.kind === "notice" ? " term-notice" : ""));
    body.innerHTML = entry.kind === "cmd" ?
      "&gt; " + INPUT_MODULE.highlight(entry.text.replace(/^> /, ""), session.runtime) :
      TERMINAL.render(entry.text);
    line.append(body);
    return line;
  }

  const blobUrls = new Set();
  function renderEntries() {
    const session = sessions.active();
    const query = searchOpen ? searchInput.value.trim().toLowerCase() : "";
    const visible = query ?
      session.entries.filter(entry => entry.text.toLowerCase().includes(query)) :
      session.entries;
    const shown = visible.slice(-DOM_NODES_MAX);
    const nodes = [];
    if (visible.length > shown.length) {
      const more = h(doc, "div", "term-more",
        "… " + (visible.length - shown.length) + " earlier entries hidden (search narrows the view)");
      nodes.push(more);
    }
    for (const entry of shown) nodes.push(entryNode(entry, session));
    output.replaceChildren(...nodes);
    if (query) {
      searchCount.textContent = visible.length === 0 ? "no matches" :
        visible.length + " match" + (visible.length === 1 ? "" : "es");
    }
    materializeFigures();
    scrollAfterPaint();
    renderStatus();
  }

  /* Figures replace their placeholder lines with real <img>/<embed> nodes.
   * Blob URLs come from the figures helper and are never revoked while the
   * node is on screen; they are revoked when the session is cleared. */
  function materializeFigures() {
    if (!PLOT_MODULE || !PLOT_MODULE.figureElement) return;
    const urlTarget = typeof root.URL !== "undefined" ? root.URL :
      (typeof URL !== "undefined" ? URL : null);
    for (const holder of output.querySelectorAll("[data-fig-pending]")) {
      const match = holder.querySelector(".term-body");
      if (match && !/^figure \d+/.test(match.textContent)) continue;
      const index = Number(match && match.textContent.replace(/^figure (\d+).*$/, "$1"));
      const entry = sessions.active().entries.find(candidate =>
        candidate.kind === "fig" && candidate.figIndex === index);
      const figure = entry ?
        PLOT_MODULE.figureElement(doc, entry.plot, urlTarget) : null;
      if (!figure) { holder.dataset.figPending = "broken"; continue; }
      const source = figure.children && figure.children[0];
      if (source && String(source.src || "").startsWith("blob:"))
        blobUrls.add(source.src);
      holder.replaceChildren(figure);
      delete holder.dataset.figPending;
    }
  }

  let stickToBottom = true;
  function scrollAfterPaint() {
    if (stickToBottom) transcript.scrollTop = transcript.scrollHeight;
  }

  function paint() { renderTabs(); renderEntries(); }

  sessions.onChange(() => {
    const active = sessions.active();
    if (active.id !== activeId) {
      draftsBySession.set(activeId, prompt.value);
      activeId = active.id;
      prompt.setRuntime(active.runtime);
      prompt.value = draftsBySession.get(activeId) || "";
      if (searchOpen) closeSearch();
    }
    paint();
  });

  /* ---------- rich figures: collect from the real plot routes ---------- */
  async function inlineFigures(languageName) {
    if (!PLOT_MODULE || !PLOT_MODULE.collect) return;
    try {
      const plots = await PLOT_MODULE.collect(languageName);
      const host = doc.getElementById("plotFigures");
      const panelKey = "__flowstudioPlotPanel:" + languageName;
      let plotPanel = root[panelKey];
      if (!plotPanel && host && PLOT_MODULE.create) {
        plotPanel = PLOT_MODULE.create(doc, host);
        try { Object.defineProperty(root, panelKey, { value: plotPanel }); }
        catch (_) { root[panelKey] = plotPanel; }
      }
      if (plotPanel && plots.length) plotPanel.append(plots);
      let figIndex = 1;
      for (const plot of plots) {
        sessions.append(languageName, "", "fig",
          { figIndex, language: languageName, plot });
        figIndex++;
      }
      if (plots.length)
        sessions.append(languageName,
          "Captured " + plots.length + " figure(s); copies stay in the Plots panel.",
          "meta");
    } catch (_) { /* capture is optional; the run still succeeded */ }
  }

  /* ---------- status line (existing statusbar element) ---------- */
  function status(message, kind = "") {
    result.textContent = message;
    result.dataset.state = kind;
  }

  /* ---------- execution path (unchanged semantics, session-aware) ---------- */
  async function submit(name, code) {
    if ((editorRun && editorRun.disabled) || (editorCell && editorCell.disabled)) {
      status("Wait for editor execution to finish.", "error");
      return false;
    }
    const session = sessions.findSession(name) || sessions.createFor(name);
    sessions.recordCommand(session, code);
    sessions.beginRun(name);
    const startedAt = Date.now();
    if (editorRun) editorRun.disabled = true;
    if (editorCell) editorCell.disabled = true;
    prompt.set(true);
    status("Running " + name + " …");
    try {
      const response = await request("/api/run/" + name, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8",
          "X-FlowStudio-Intent": "run" },
        body: code
      });
      const text = await response.text();
      sessions.append(name, text + (text.endsWith("\n") ? "" : "\n"), "out");
      status(response.ok ? "Finished" :
        response.status === 422 ? "Execution failed" :
        response.status === 503 ? "Interpreter unavailable" :
        response.status === 504 ? "Execution timed out" :
        "HTTP error " + response.status, response.ok ? "ok" : "error");
      sessions.endRun(session, response.ok ? "ok" : "error", Date.now() - startedAt);
      if (response.ok && (name === "r" || name === "python")) {
        try { await inlineFigures(name); } catch (_) {}
      }
      return true;
    } catch (error) {
      sessions.append(name, String(error) + "\n", "out");
      sessions.endRun(session, "disconnected", Date.now() - startedAt);
      status("Execution request failed", "error");
      return false;
    } finally {
      if (editorRun) editorRun.disabled = false;
      if (editorCell) editorCell.disabled = false;
      prompt.set(false);
      stickToBottom = true;
      prompt.focus();
    }
  }

  /* ---------- history: console.js per-runtime storage drives recall ---------- */
  function historyRecall(input, direction) {
    const ok = controller.navigate(input, direction);
    if (ok) prompt.paint();
  }

  let storage = null;
  try { storage = root.localStorage || null; } catch (_) {}
  const controller = root.FlowStudioConsole.create(submit,
    () => sessions.active().runtime, message => status(message, "error"), { storage });

  /* ---------- IO singleton (same contract as before) ---------- */
  if (!root.FlowStudioConsoleIO) {
    root.FlowStudioConsoleIO = Object.freeze({
      write(text, runtime, kind) {
        sessions.append(typeof runtime === "string" ? runtime : null, text,
          kind === "cmd" || kind === "meta" || kind === "notice" ? kind : "out");
      },
      clear() { sessions.clearVisible(sessions.active()); }
    });
  }

  /* ---------- overflow menu ---------- */
  const menu = h(doc, "div", "terminal-menu");
  menu.id = "terminalMenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Terminal session actions");
  menu.hidden = true;

  const newSessionItem = h(doc, "button", "terminal-menuitem");
  newSessionItem.type = "button";
  newSessionItem.setAttribute("role", "menuitem");
  newSessionItem.id = "terminalMenuNewSession";
  newSessionItem.textContent = "New session for this runtime";

  const clearVisibleItem = h(doc, "button", "terminal-menuitem");
  clearVisibleItem.type = "button";
  clearVisibleItem.setAttribute("role", "menuitem");
  clearVisibleItem.id = "terminalMenuClearVisible";
  clearVisibleItem.textContent = "Clear visible output (Ctrl+L)";

  const exportItem = h(doc, "button", "terminal-menuitem");
  exportItem.type = "button";
  exportItem.setAttribute("role", "menuitem");
  exportItem.id = "terminalMenuExport";
  exportItem.textContent = "Download this session transcript (.txt)";
  exportItem.title = "Includes commands and output, which may contain secrets. Figures are referenced, not embedded.";

  const resetItem = h(doc, "button", "terminal-menuitem");
  resetItem.type = "button";
  resetItem.setAttribute("role", "menuitem");
  resetItem.id = "terminalMenuReset";
  resetItem.textContent = "Reset interpreter state…";
  resetItem.disabled = true;
  resetItem.title = "Python and R only; Flow compiles each program from scratch.";

  const rememberLabel = h(doc, "label", "terminal-menuitem terminal-menu-flag");
  rememberLabel.id = "consoleRememberHistory";
  const rememberBox = h(doc, "input");
  rememberBox.type = "checkbox";
  rememberBox.checked = controller.isPersisting();
  rememberLabel.append(rememberBox,
    doc.createTextNode(" Remember command history on this device"));

  const clearHistoryItem = h(doc, "button", "terminal-menuitem");
  clearHistoryItem.type = "button";
  clearHistoryItem.setAttribute("role", "menuitem");
  clearHistoryItem.id = "consoleClearHistory";
  clearHistoryItem.textContent = "Clear stored history for this runtime";

  menu.append(newSessionItem, clearVisibleItem, exportItem, resetItem,
    rememberLabel, clearHistoryItem);

  function hideMenu() {
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    if (resetArmed) disarmReset();
  }
  function armToggle() {
    resetArmed = !resetArmed;
    resetItem.textContent = resetArmed ?
      "This clears all session variables. Confirm reset." : "Reset interpreter state…";
  }
  let resetArmed = false;
  function disarmReset() {
    resetArmed = false;
    resetItem.textContent = "Reset interpreter state…";
  }

  async function doReset() {
    const name = sessions.active().runtime;
    if (name !== "python" && name !== "r") return;
    if (!resetArmed) { armToggle(); return; }
    disarmReset();
    hideMenu();
    try {
      const response = await request("/api/reset/" + name, {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8",
          "X-FlowStudio-Intent": "run" },
        body: ""
      });
      if (response.ok) {
        sessions.append(name, "\n> interpreter state reset\n", "meta");
        status("Reset " + name + " interpreter state.", "ok");
      } else {
        status("Reset failed: HTTP " + response.status, "error");
      }
    } catch (error) {
      status("Reset unavailable: " + String(error), "error");
    }
  }

  newSessionItem.addEventListener("click", () => {
    draftsBySession.set(activeId, prompt.value);
    sessions.createFor(sessions.active().runtime);
    sessions.activateRuntime(sessions.active().runtime);
    hideMenu();
    prompt.focus();
  });
  clearVisibleItem.addEventListener("click", () => {
    sessions.clearVisible(sessions.active());
    hideMenu();
  });
  exportItem.addEventListener("click", () => {
    hideMenu();
    try {
      const session = sessions.active();
      const text = SESSION_MODULE.exportTranscript(session);
      const BlobType = root.Blob;
      const urlApi = root.URL;
      if (typeof BlobType !== "function" || !urlApi ||
          typeof urlApi.createObjectURL !== "function" ||
          typeof urlApi.revokeObjectURL !== "function")
        throw new Error("Browser downloads are unavailable.");
      const url = urlApi.createObjectURL(new BlobType([text],
        { type: "text/plain;charset=utf-8" }));
      try {
        const link = doc.createElement("a");
        link.href = url;
        link.download = "flowstudio-" + session.runtime + "-session-" +
          session.ordinal + "-transcript.txt";
        link.click();
        status("Transcript download requested.", "ok");
      } finally {
        // Defer revocation until the browser has accepted the download.
        if (typeof root.setTimeout === "function")
          root.setTimeout(() => urlApi.revokeObjectURL(url), 1000);
        else urlApi.revokeObjectURL(url);
      }
    } catch (error) {
      status("Transcript export failed: " + String(error.message || error), "error");
    }
  });
  resetItem.addEventListener("click", () => void doReset());
  rememberBox.addEventListener("change", () => {
    if (!controller.setPersistence(rememberBox.checked))
      rememberBox.checked = controller.isPersisting();
  });
  clearHistoryItem.addEventListener("click", () => {
    if (controller.clearHistory(sessions.active().runtime))
      status("Console history cleared", "ok");
    hideMenu();
  });
  menuButton.addEventListener("click", () => {
    const runtime = sessions.active().runtime;
    resetItem.disabled = !(runtime === "python" || runtime === "r");
    menu.hidden = !menu.hidden;
    menuButton.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) { disarmReset(); newSessionItem.focus(); }
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape") { hideMenu(); menuButton.focus(); }
  });
  doc.addEventListener && doc.addEventListener("click", event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== menuButton)
      hideMenu();
  });
  panel.append(menu, tabbar, statusRow, searchbar, transcript);

  /* ---------- search ---------- */
  let searchOpen = false;
  function openSearch() {
    searchOpen = true;
    searchbar.hidden = false;
    searchInput.focus();
    renderEntries();
  }
  function closeSearch() {
    if (searchInput.value) searchInput.value = "";
    searchOpen = false;
    searchbar.hidden = true;
    searchCount.textContent = "";
    renderEntries();
  }
  searchToggle.addEventListener("click", () => searchOpen ? closeSearch() : openSearch());
  searchClose.addEventListener("click", closeSearch);
  searchInput.addEventListener("input", () => renderEntries());
  searchInput.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeSearch(); prompt.focus(); }
    if (event.key === "Enter") { event.preventDefault(); closeSearch(); prompt.focus(); }
  });

  /* terminal-scoped shortcuts (editor keeps its own Ctrl+F/H globally) */
  transcript.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearch();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey &&
        event.key.toLowerCase() === "l") {
      event.preventDefault();
      sessions.clearVisible(sessions.active());
    }
  });
  transcript.addEventListener("scroll", () => {
    stickToBottom = transcript.scrollHeight -
      transcript.scrollTop - transcript.clientHeight < NEAR_BOTTOM_PX;
  });

  /* ---------- editor runtime selector → sessions ---------- */
  const intro = "FlowStudio terminal ready. Enter runs the command; " +
    "Shift+Enter adds a newline. Python and R keep session state; Flow " +
    "compiles each command as a program.\n";
  sessions.append(sessions.active().runtime, intro, "notice");
  if (language) {
    language.addEventListener("change", () => {
      sessions.activateRuntime(language.value);
      prompt.setRuntime(language.value);
      paint();
    });
  }
  prompt.setRuntime(sessions.active().runtime);
  paint();
  return controller;
}

const api = Object.freeze({ mount, DOM_NODES_MAX });
root.FlowStudioWorkspaceConsole = Object.freeze({ mount });
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.getElementById("console") &&
    document.getElementById("language")) mount(document, fetch);
})(globalThis);
