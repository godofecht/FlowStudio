/* FlowStudio IDE shell: menu bar, resizable panes and document-tab keyboard
 * navigation. Execution and document state stay in the Flow-owned workspace. */
(function (root) {
"use strict";

const LAYOUT_KEY = "flowstudio.layout.v1";
const LIMITS = Object.freeze({
  sidebar: [180, 560],
  right: [200, 560],
  dock: [90, 620]
});
const DEFAULTS = Object.freeze({ sidebar: 290, right: 320, dock: 190 });

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
  const menus = Array.from(shell.querySelectorAll(".menu"));
  let openMenu = null;

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
  function popupOf(menu) { return menu.querySelector(".menu-popup"); }
  function triggerOf(menu) { return menu.querySelector(".menu-trigger"); }
  function itemsOf(menu) {
    return Array.from(popupOf(menu).querySelectorAll("[role='menuitem']"));
  }
  function closeMenus(focusTrigger = false) {
    if (!openMenu) return;
    const menu = openMenu;
    openMenu = null;
    const popup = popupOf(menu);
    const trigger = triggerOf(menu);
    if (popup) popup.hidden = true;
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
      if (focusTrigger) trigger.focus();
    }
  }
  function openMenus(menu, focusFirst) {
    closeMenus();
    const popup = popupOf(menu);
    if (!popup) return;
    openMenu = menu;
    popup.hidden = false;
    const trigger = triggerOf(menu);
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    if (focusFirst) {
      const items = itemsOf(menu);
      if (items.length) items[0].focus();
    }
  }
  function runCommand(name) {
    const commands = options.commands ||
      (root.FlowStudioApp && root.FlowStudioApp.commands) || {};
    const command = commands[name];
    if (typeof command !== "function") return false;
    closeMenus();
    command();
    return true;
  }

  for (const menu of menus) {
    const trigger = triggerOf(menu);
    const popup = popupOf(menu);
    if (!trigger || !popup) continue;
    trigger.addEventListener("click", event => {
      event.stopPropagation();
      if (openMenu === menu) closeMenus(true);
      else openMenus(menu, false);
    });
    trigger.addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenus(menu, true);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const index = menus.indexOf(menu);
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = menus[(index + step + menus.length) % menus.length];
        closeMenus();
        if (next) triggerOf(next).focus();
      } else if (event.key === "Escape") {
        closeMenus(true);
      }
    });
    popup.addEventListener("click", event => {
      const item = event.target && event.target.closest
        ? event.target.closest("[data-command]") : null;
      const name = item ? item.dataset.command
        : (event.target && event.target.dataset && event.target.dataset.command);
      if (name) runCommand(name);
      else closeMenus();
    });
    popup.addEventListener("keydown", event => {
      const items = itemsOf(menu);
      if (!items.length) return;
      const index = items.indexOf(doc.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(index + 1 + items.length) % items.length].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenus(true);
      } else if (event.key === "Tab") {
        closeMenus();
      }
    });
  }

  if (options.closeOnPointerDown !== false) {
    doc.addEventListener("pointerdown", event => {
      const target = event.target;
      if (openMenu && target && typeof target.closest === "function" &&
          !target.closest(".menu")) closeMenus();
    });
  }

  for (const splitter of shell.querySelectorAll("[data-splitter]")) {
    const panel = splitter.dataset.panel;
    if (!LIMITS[panel]) continue;
    const axis = splitter.dataset.axis === "y" ? "y" : "x";
    const position = event => axis === "x" ? event.clientX : event.clientY;
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
      layout[panel] = clamp(panel, origin.size + delta);
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
      layout[panel] = clamp(panel, layout[panel] + (event.key === increase ? 16 : -16));
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

  applyLayout();

  return Object.freeze({
    layout: () => ({ ...layout }),
    closeMenus,
    runCommand,
    setPanel(panel, value) {
      if (!LIMITS[panel]) return false;
      layout[panel] = clamp(panel, value);
      applyLayout();
      saveLayout();
      return true;
    },
    dispose() {
      closeMenus();
      doc.removeEventListener("pointermove", () => {});
    }
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
