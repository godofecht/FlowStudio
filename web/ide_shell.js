/* FlowStudio IDE shell: resizable panes and document-tab keyboard navigation.
 * The menubar itself is engine-driven (web/ide_menubar.js); execution and
 * document state stay in the Flow-owned workspace. */
(function (root) {
"use strict";

const LAYOUT_KEY = "flowstudio.layout.v2";
const LIMITS = Object.freeze({
  sidebar: [180, 560],
  right: [200, 560],
  dock: [90, 620]
});
const TRAILING = new Set(["right", "dock"]);
const DEFAULTS = Object.freeze({ sidebar: 300, right: 260, dock: 220 });

function clamp(panel, value) {
  const range = LIMITS[panel];
  if (!range || !Number.isFinite(value)) return DEFAULTS[panel] || 0;
  return Math.min(range[1], Math.max(range[0], Math.round(value)));
}

function readLayout(storage) {
  const layout = { ...DEFAULTS };
  if (!storage) return layout;
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (!raw || raw.length > 512) return layout;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return layout;
    for (const panel of Object.keys(DEFAULTS)) {
      if (Number.isFinite(saved[panel])) layout[panel] = clamp(panel, saved[panel]);
    }
  } catch (_) { /* Layout preferences never block startup. */ }
  return layout;
}

function mount(doc = document, options = {}) {
  const shell = doc.getElementById("ideShell");
  if (!shell) return null;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = root.localStorage; } catch (_) { storage = null; }
  }
  const layout = readLayout(storage);

  function applyLayout() {
    if (!shell.style || typeof shell.style.setProperty !== "function") return;
    shell.style.setProperty("--sidebar-width", layout.sidebar + "px");
    shell.style.setProperty("--right-width", layout.right + "px");
    shell.style.setProperty("--dock-height", layout.dock + "px");
  }
  function saveLayout() {
    if (!storage) return;
    try { storage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }
    catch (_) { /* Preferences are optional. */ }
  }
  applyLayout();

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
      origin = { pointer: position(event), size: layout[panel] };
      if (typeof splitter.setPointerCapture === "function" &&
          event.pointerId !== undefined) {
        splitter.setPointerCapture(event.pointerId);
      }
      if (event.preventDefault) event.preventDefault();
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", stop);
    });
    function move(event) {
      if (!origin) return;
      const delta = position(event) - origin.pointer;
      layout[panel] = clamp(panel, origin.size + sign * delta);
      applyLayout();
    }
    function stop() {
      if (!origin) return;
      origin = null;
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", stop);
      saveLayout();
    }
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
    layout: () => ({ ...layout }),
    setPanel(panel, value) {
      if (!LIMITS[panel]) return false;
      layout[panel] = clamp(panel, value);
      applyLayout();
      saveLayout();
      return true;
    },
    dispose() { /* Splitters keep page-lifetime listeners. */ }
  });
}

const api = Object.freeze({ mount, LIMITS, DEFAULTS, LAYOUT_KEY, clamp, readLayout });
root.FlowStudioIdeShell = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined") {
  const start = () => {
    try { mount(document, {}); } catch (_) { /* Shell enhancement is optional. */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
