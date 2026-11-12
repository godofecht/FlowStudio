/* FlowStudio IDE shell: the layout manager and document-tab keyboard navigation.
 *
 * Layout is a small model solved against the viewport on every change:
 *   - four regions: the primary sidebar (activity bar + views), the editor,
 *     the secondary side panel (Preview, Environment) and the bottom dock;
 *   - each region has a user size and a user visibility, both persisted;
 *   - the editor keeps a minimum width and height. When the window is too
 *     narrow, the right panel shrinks then hides, then the sidebar does. Those
 *     automatic collapses are never written back as the user's preference,
 *     so widening the window brings the panes back.
 * The menubar itself is engine-driven (web/ide_menubar.js); execution and
 * document state stay in the Flow-owned workspace. */
(function (root) {
"use strict";

const LAYOUT_KEY = "flowstudio.layout.v3";
const LIMITS = Object.freeze({
  sidebar: [180, 560],
  right: [240, 1100],
  dock: [90, 900]
});
const TRAILING = new Set(["right", "dock"]);
const DEFAULTS = Object.freeze({ sidebar: 280, right: 440, dock: 190 });
const DEFAULT_SHOW = Object.freeze({ sidebar: true, right: false, dock: true });
const ACTIVITY = 42;      // activity bar width, always visible
const SASH = 5;           // splitter thickness
const CHROME_Y = 58 + 30 + 6;   // top bar + status bar + dock splitter
const EDITOR_MIN_W = 360;
const EDITOR_MIN_H = 150;
const DOCK_SNAP = 60;     // dragging the dock below this closes it

function clamp(panel, value) {
  const range = LIMITS[panel];
  if (!range || !Number.isFinite(value)) return DEFAULTS[panel] || 0;
  return Math.min(range[1], Math.max(range[0], Math.round(value)));
}

function readLayout(storage) {
  const layout = { ...DEFAULTS, show: { ...DEFAULT_SHOW }, dockMax: false };
  if (!storage) return layout;
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (!raw || raw.length > 512) return layout;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return layout;
    for (const panel of Object.keys(DEFAULTS)) {
      if (Number.isFinite(saved[panel])) layout[panel] = clamp(panel, saved[panel]);
    }
    if (saved.show && typeof saved.show === "object") {
      for (const panel of Object.keys(DEFAULT_SHOW))
        if (typeof saved.show[panel] === "boolean") layout.show[panel] = saved.show[panel];
    }
  } catch (_) { /* Layout preferences never block startup. */ }
  return layout;
}

/* Pure: fits the user layout into a viewport. Returns the sizes to render and
 * which panes are shown, plus which of them were collapsed automatically. */
function solve(layout, viewport) {
  const width = Math.max(0, viewport.width || 0);
  const height = Math.max(0, viewport.height || 0);
  const show = { ...layout.show };
  const auto = { sidebar: false, right: false };
  let sidebar = layout.sidebar, right = layout.right;
  const editorMin = Math.min(EDITOR_MIN_W, Math.max(0, width - ACTIVITY - 2 * SASH));
  const room = () => width - ACTIVITY - 2 * SASH - (show.sidebar ? sidebar : 0) - (show.right ? right : 0);
  if (show.right && room() < editorMin) right = Math.max(LIMITS.right[0], right - (editorMin - room()));
  if (show.sidebar && room() < editorMin) sidebar = Math.max(LIMITS.sidebar[0], sidebar - (editorMin - room()));
  if (show.right && room() < editorMin) { show.right = false; auto.right = true; }
  if (show.sidebar && room() < editorMin) { show.sidebar = false; auto.sidebar = true; }
  const dockRoom = Math.max(0, height - CHROME_Y - EDITOR_MIN_H);
  let dock = Math.min(layout.dock, Math.max(LIMITS.dock[0], dockRoom));
  const dockMax = Boolean(layout.dockMax && show.dock);
  return {
    sidebar: show.sidebar ? sidebar : 0,
    right: show.right ? right : 0,
    dock: show.dock ? dock : 0,
    show, auto, dockMax,
    editor: Math.max(0, width - ACTIVITY - 2 * SASH - (show.sidebar ? sidebar : 0) - (show.right ? right : 0))
  };
}

function mount(doc = document, options = {}) {
  const shell = doc.getElementById("ideShell");
  if (!shell) return null;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = root.localStorage; } catch (_) { storage = null; }
  }
  /* The workspace is the shell's content box: the window minus the shell's
   * own side padding and the workspace border. */
  const view = options.viewport || (() => {
    let width = root.innerWidth || 1440;
    try {
      const style = root.getComputedStyle(shell);
      width = shell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
    } catch (_) { /* fall back to the window */ }
    return { width, height: root.innerHeight || 900 };
  });
  const layout = readLayout(storage);
  const listeners = new Set();
  let solved = null;

  function region(name) {
    if (name === "sidebar") return doc.querySelector ? shell.querySelector(".sidebar-views") : null;
    if (name === "right") return doc.getElementById("rightPanel");
    if (name === "dock") return doc.getElementById("consoleDock");
    return null;
  }
  function setClass(name, on) {
    if (shell.classList && typeof shell.classList.toggle === "function") shell.classList.toggle(name, on);
    else if (shell.dataset) shell.dataset[name.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = on ? "true" : "false";
  }
  function applyLayout() {
    solved = solve(layout, view());
    if (shell.style && typeof shell.style.setProperty === "function") {
      shell.style.setProperty("--sidebar-width", (solved.show.sidebar ? solved.sidebar + ACTIVITY : ACTIVITY) + "px");
      shell.style.setProperty("--sidebar-sash", (solved.show.sidebar ? SASH : 0) + "px");
      shell.style.setProperty("--right-width", solved.right + "px");
      shell.style.setProperty("--right-sash", (solved.show.right ? SASH : 0) + "px");
      shell.style.setProperty("--dock-height", (solved.show.dock ? solved.dock : 0) + "px");
    }
    setClass("sidebar-hidden", !solved.show.sidebar);
    setClass("right-hidden", !solved.show.right);
    setClass("dock-hidden", !solved.show.dock);
    setClass("dock-max", solved.dockMax);
    for (const name of ["sidebar", "right", "dock"]) {
      const node = region(name);
      if (!node) continue;
      const hidden = !solved.show[name];
      if (typeof node.toggleAttribute === "function") node.toggleAttribute("inert", hidden);
      if (node.setAttribute) node.setAttribute("aria-hidden", hidden ? "true" : "false");
    }
    const splitter = doc.getElementById("dockSplitter");
    if (splitter) splitter.hidden = !solved.show.dock;
    if (doc.querySelectorAll) {
      for (const button of doc.querySelectorAll("[data-layout-toggle]")) {
        const panel = button.dataset.layoutToggle;
        if (panel in solved.show) button.setAttribute("aria-pressed", solved.show[panel] ? "true" : "false");
      }
    }
    for (const listener of listeners) {
      try { listener(snapshot()); } catch (_) { /* a listener never breaks layout */ }
    }
  }
  function snapshot() {
    return { sidebar: layout.sidebar, right: layout.right, dock: layout.dock,
      show: { ...layout.show }, dockMax: layout.dockMax,
      visible: solved ? { ...solved.show } : { ...layout.show } };
  }
  function saveLayout() {
    if (!storage) return;
    try {
      storage.setItem(LAYOUT_KEY, JSON.stringify({ sidebar: layout.sidebar, right: layout.right,
        dock: layout.dock, show: layout.show }));
    } catch (_) { /* Preferences are optional. */ }
  }
  function setVisible(panel, visible) {
    if (!(panel in DEFAULT_SHOW)) return false;
    layout.show[panel] = Boolean(visible);
    if (panel === "dock" && !visible) layout.dockMax = false;
    /* Showing a pane the window had collapsed makes room for it by closing
     * the other side pane. */
    if (visible && panel !== "dock") {
      const trial = solve(layout, view());
      const other = panel === "right" ? "sidebar" : "right";
      if (!trial.show[panel] && layout.show[other]) layout.show[other] = false;
    }
    applyLayout();
    saveLayout();
    return true;
  }
  function toggle(panel) {
    const shown = solved ? solved.show[panel] : layout.show[panel];
    return setVisible(panel, !shown);
  }
  applyLayout();
  if (doc.querySelectorAll) {
    for (const button of doc.querySelectorAll("[data-layout-toggle]"))
      button.addEventListener("click", () => toggle(button.dataset.layoutToggle));
  }

  for (const splitter of shell.querySelectorAll("[data-splitter]")) {
    const panel = splitter.dataset.panel;
    if (!LIMITS[panel]) continue;
    const axis = splitter.dataset.axis === "y" ? "y" : "x";
    const position = event => axis === "x" ? event.clientX : event.clientY;
    /* The right pane and the console dock sit after their splitter, so they
     * grow as the pointer moves left or up. */
    const sign = TRAILING.has(panel) ? -1 : 1;
    let origin = null;
    splitter.addEventListener("pointerdown", event => {
      const current = solved && solved[panel] ? solved[panel] : layout[panel];
      origin = { pointer: position(event), size: current };
      layout.dockMax = false;
      if (typeof splitter.setPointerCapture === "function" &&
          event.pointerId !== undefined) {
        splitter.setPointerCapture(event.pointerId);
      }
      if (event.preventDefault) event.preventDefault();
      setClass("resizing", true);
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", stop);
    });
    function move(event) {
      if (!origin) return;
      const raw = origin.size + sign * (position(event) - origin.pointer);
      if (panel === "dock" && raw < DOCK_SNAP) { layout.show.dock = false; applyLayout(); return; }
      if (panel === "dock") layout.show.dock = true;
      layout[panel] = clamp(panel, raw);
      applyLayout();
    }
    function stop() {
      if (!origin) return;
      origin = null;
      setClass("resizing", false);
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", stop);
      saveLayout();
    }
    splitter.addEventListener("dblclick", () => {
      layout[panel] = DEFAULTS[panel];
      applyLayout();
      saveLayout();
    });
    splitter.addEventListener("keydown", event => {
      const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
      const increase = axis === "x" ? "ArrowRight" : "ArrowDown";
      if (event.key !== decrease && event.key !== increase) return;
      event.preventDefault();
      layout[panel] = clamp(panel, layout[panel] + sign * (event.key === increase ? 16 : -16));
      applyLayout();
      saveLayout();
    });
  }

  /* VS Code: clicking the active activity-bar view hides the sidebar, and
   * choosing any view while it is hidden shows it again. Programmatic clicks
   * (commands revealing a view) only ever show it. */
  const activity = shell.querySelector ? shell.querySelector(".activity-bar") : null;
  if (activity) {
    activity.addEventListener("click", event => {
      const tab = event.target && event.target.closest ? event.target.closest("[role='tab']") : null;
      if (!tab) return;
      const wasSelected = tab.dataset && tab.dataset.wasSelected === "true";
      const visible = solved ? solved.show.sidebar : layout.show.sidebar;
      if (!visible) setVisible("sidebar", true);
      else if (wasSelected && event.isTrusted && event.detail > 0) setVisible("sidebar", false);
    }, true);
    activity.addEventListener("pointerdown", event => {
      const tab = event.target && event.target.closest ? event.target.closest("[role='tab']") : null;
      if (tab && tab.dataset) tab.dataset.wasSelected = tab.getAttribute("aria-selected") === "true" ? "true" : "false";
    }, true);
  }

  if (doc.addEventListener) {
    doc.addEventListener("keydown", event => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.shiftKey) return;
      const key = (event.key || "").toLowerCase();
      if (key === "b" && !event.altKey) { event.preventDefault(); toggle("sidebar"); }
      else if (key === "b" && event.altKey) { event.preventDefault(); toggle("right"); }
      else if (key === "j" && !event.altKey) { event.preventDefault(); toggle("dock"); }
    }, true);
  }
  if (root.addEventListener && !options.viewport) {
    let frame = 0;
    root.addEventListener("resize", () => {
      if (frame) return;
      frame = (root.requestAnimationFrame || (fn => setTimeout(fn, 16)))(() => { frame = 0; applyLayout(); });
    });
  }

  const strip = doc.getElementById("docTabs");
  if (strip) {
    strip.addEventListener("keydown", event => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      const tabs = Array.from(strip.querySelectorAll("[role='tab']"));
      if (!tabs.length) return;
      event.preventDefault();
      const index = tabs.indexOf(doc.activeElement);
      let next = 0;
      if (event.key === "ArrowRight") next = (index + 1 + tabs.length) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "End") next = tabs.length - 1;
      tabs[next].focus();
    });
  }

  return Object.freeze({
    layout: snapshot,
    solved: () => (solved ? { ...solved, show: { ...solved.show }, auto: { ...solved.auto } } : null),
    setPanel(panel, value) {
      if (!LIMITS[panel]) return false;
      layout[panel] = clamp(panel, value);
      applyLayout();
      saveLayout();
      return true;
    },
    /* Grows a pane to at least size without saving it as a preference
     * unless the pane was already that large. */
    ensureSize(panel, size) {
      if (!LIMITS[panel] || layout[panel] >= size) return false;
      layout[panel] = clamp(panel, size);
      applyLayout();
      saveLayout();
      return true;
    },
    show: panel => setVisible(panel, true),
    hide: panel => setVisible(panel, false),
    toggle,
    isVisible: panel => Boolean(solved && solved.show[panel]),
    toggleDockMax() {
      layout.dockMax = !layout.dockMax;
      if (layout.dockMax) layout.show.dock = true;
      applyLayout();
      return layout.dockMax;
    },
    relayout: applyLayout,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { listeners.clear(); }
  });
}

const api = Object.freeze({ mount, solve, LIMITS, DEFAULTS, DEFAULT_SHOW, LAYOUT_KEY, clamp, readLayout,
  EDITOR_MIN_W, EDITOR_MIN_H, ACTIVITY, SASH });
root.FlowStudioIdeShell = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined") {
  const start = () => {
    try { root.FlowStudioLayout = mount(document, {}); } catch (_) { /* Shell enhancement is optional. */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
