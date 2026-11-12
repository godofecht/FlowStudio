/* FlowStudio menubar engine (JetBrains-style keyboard-native popups).
 * Static markup stays in index.html; this module mounts on it and adds:
 *   - sticky hover switching between root menus while one is open
 *   - keyboard traversal: arrows, Home/End, typeahead, Enter, Escape stack
 *   - nested submenu flyouts (Open recent ▸, Tool Windows ▸)
 *   - dynamic disabled states and menuitemcheckbox reflection at open time
 *   - action dispatch: data-command / data-act / data-tab / data-check-of
 *
 * No external dependency; the popup markup is the existing .menu/.menu-popup
 * structure so the textarea fallback and the Monaco workbench behave the same.
 * Execution commands stay owned by the workspace command registry. */
(function (root) {
"use strict";

const WHEN = {
  NOT_RUNNING: "not-running",       /* disabled while a run is in flight */
  LANG_FLOW: "lang-flow",
  LANG_R: "lang-r",
  LANG_PYTHON: "lang-python",
  LANG_SCRIPTED: "lang-r-or-python"
};
const TYPEAHEAD_TIMEOUT = 500;

function classTokens(node) {
  const value = node && node.getAttribute ? node.getAttribute("class") : "";
  return typeof value === "string" && value ? value.split(/\s+/) : [];
}
function labelOf(item) {
  if (!item) return "";
  const text = typeof item.textContent === "string" ? item.textContent : "";
  return text.replace(/\s+/g, " ").trim();
}
function roleOf(node) {
  return node && node.getAttribute ? node.getAttribute("role") : null;
}
function isItem(node) {
  const role = roleOf(node);
  return role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio";
}
function isDisabled(item) {
  return Boolean(item) && item.getAttribute?.("aria-disabled") === "true";
}
/* Nearest enclosing popup of an item (root uses .menu-popup, nested .menu-sub). */
function ownerPopupOf(item) {
  let node = item && item.parentElement;
  while (node && node.getAttribute) {
    const tokens = classTokens(node);
    if (tokens.includes("menu-popup") || tokens.includes("menu-sub")) return node;
    node = node.parentElement || null;
  }
  return null;
}
/* Resolve the clicked menu item: DOM closest() when available, dataset fallback. */
function itemFromTarget(target, popup, docRoot) {
  if (target && typeof target.closest === "function") {
    const found = target.closest("[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']");
    if (found) {
      let node = found;
      while (node && node.parentElement && docRoot?.contains?.(node) !== false && !classTokens(node).includes("menu")) {
        node = node.parentElement;
      }
      return found;
    }
  }
  let node = target;
  while (node && node.getAttribute && node !== popup) {
    if (isItem(node)) return node;
    node = node.parentElement || null;
  }
  if (target && target.dataset) {
    if (target.dataset.command || target.dataset.act || target.dataset.tab ||
        target.dataset.checkOf || isItem(target)) return target;
  }
  return null;
}

function mount(doc, options = {}) {
  const container = options.menubar ||
    (doc && doc.querySelector ? doc.querySelector(".menubar") : null);
  if (!container || typeof container.querySelectorAll !== "function") return null;
  const commands = () => options.commands ||
    (root.FlowStudioApp && root.FlowStudioApp.commands) || {};
  const element = id => doc.getElementById ? doc.getElementById(id) : null;

  const menus = Array.from(container.querySelectorAll(".menu"));
  if (!menus.length) return null;

  let openRoot = null;        // controller whose root popup is open
  let openSubs = [];          // [ { popup, parent } ] deepest last (max depth 1)
  let focusedItem = null;     // last focused item in the open chain
  let typeahead = { text: "", timer: null };

  /* ---- item lookup ------------------------------------------------------ */
  function itemsOf(popup, enabledOnly = false) {
    const found = popup.querySelectorAll("[role='menuitem'],[role='menuitemcheckbox'],[role='menuitemradio']");
    return Array.from(found).filter(item => {
      if (item.hidden === true) return false;
      if (ownerPopupOf(item) !== popup) return false;   // items of nested submenus belong to that sub
      if (enabledOnly && isDisabled(item)) return false;
      return true;
    });
  }
  function fillRecent(popup) {
    let slot = null;
    try {
      for (const node of Array.from(popup.querySelectorAll("[data-fill='recent']"))) { slot = node; break; }
    } catch (_) { slot = null; }
    if (!slot) return;
    /* Projects (web/ide_projects.js) are the recent list when present. */
    const service = root.FlowStudioProjects;
    if (service && typeof service.recents === "function") {
      if (slot.replaceChildren) slot.replaceChildren();
      const items = service.recents().filter(item => {
        const current = service.current();
        return !current || item.name !== current.name;
      }).slice(0, 8);
      if (!items.length && doc.createElement) {
        const empty = doc.createElement("div");
        empty.setAttribute("class", "menu-empty");
        empty.textContent = "No other recent projects.";
        if (slot.append) slot.append(empty);
      }
      for (const item of items) {
        const button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.textContent = item.name;
        button.addEventListener?.("click", () => { closeRoots(); void service.openRecent(item); });
        slot.append(button);
      }
      void service.refreshRecents();
      return;
    }
    if (slot.dataset && slot.dataset.filled === "done") return;
    const saved = root.FlowStudioSavedProjects;
    if (!saved || typeof saved.createStore !== "function") return;
    let storage = null;
    try { storage = root.localStorage || null; } catch (_) { storage = null; }
    let projects = [];
    try { projects = saved.createStore(storage).list(); } catch (_) { projects = []; }
    if (slot.replaceChildren) slot.replaceChildren(); else if (Array.isArray(slot.children)) slot.children = [];
    if (!projects.length) {
      if (doc.createElement) {
        const empty = doc.createElement("div");
        empty.setAttribute("class", "menu-empty");
        empty.textContent = "No recent projects yet. Open one from Examples.";
        if (slot.append) slot.append(empty);
      }
    } else {
      for (const project of projects.slice(0, 8)) {
        const button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.setAttribute("data-recent-id", project.id || "");
        button.textContent = project.title || project.id || "Untitled project";
        button.addEventListener?.("click", () => openRecentProject(project.id || ""));
        slot.append(button);
      }
    }
    if (slot.dataset) slot.dataset.filled = "done";
  }

  function openRecentProject(id) {
    closeRoots();
    const tab = element("tab-examples");
    if (tab && typeof tab.click === "function") tab.click();
    const host = element("examplesHost");
    if (!host || !host.querySelectorAll) return;
    const cards = Array.from(host.querySelectorAll("[data-project-id]"));
    const match = Array.from(cards).find(card => ((card.dataset?.projectId) || "") === id);
    if (!match) return;
    let reopen = null;
    try {
      for (const node of Array.from(match.querySelectorAll("button.primary"))) { reopen = node; break; }
    } catch (_) { reopen = null; }
    if (reopen && typeof reopen.click === "function") reopen.click();
  }

  /* ---- dynamic item state ----------------------------------------------- */
  function updateItems(popup) {
    const runButton = element("run");
    const language = element("language");
    const lang = language && typeof language.value === "string" ? language.value : "flow";
    for (const item of itemsOf(popup)) {
      const data = item.dataset || {};
      let disabled = false;
      switch (data.when) {
        case WHEN.NOT_RUNNING: disabled = Boolean(runButton && runButton.disabled); break;
        case WHEN.LANG_FLOW: disabled = lang !== "flow"; break;
        case WHEN.LANG_R: disabled = lang !== "r"; break;
        case WHEN.LANG_PYTHON: disabled = lang !== "python"; break;
        case WHEN.LANG_SCRIPTED: disabled = !(lang === "r" || lang === "python"); break;
        default: break;
      }
      if (data.act && !element(data.act)) disabled = true;
      if (data.tab && !element(data.tab)) disabled = true;
      if (data.command && typeof commands()[data.command] !== "function") disabled = true;
      if (disabled) {
        item.setAttribute("aria-disabled", "true");
      } else {                                   // enabled state renders explicitly
        item.setAttribute("aria-disabled", "false");
      }
      if (roleOf(item) === "menuitemcheckbox" && data.checkOf) {
        const box = element(data.checkOf);
        const checked = Boolean(box && box.checked);
        item.setAttribute("aria-checked", checked ? "true" : "false");
        const marker = item.querySelector(".menu-check");
        if (marker && marker.setAttribute) {
          if (checked) marker.setAttribute("data-checked", checked ? "true" : "");
          else if (marker.removeAttribute) marker.removeAttribute("data-checked");
          else marker.setAttribute("data-checked", "");
        }
      }
    }
  }

  /* ---- open/close ------------------------------------------------------- */
  function closeSubmenus(keepDepth = 0) {
    while (openSubs.length > keepDepth) {
      const closed = openSubs.pop();
      closed.popup.hidden = true;
      if (closed.parent && closed.parent.setAttribute) closed.parent.setAttribute("aria-expanded", "false");
    }
  }
  function closeRoots(focusTrigger = false) {
    for (const controller of controllers) {
      if (controller.popup.hidden === false) {
        controller.popup.hidden = true;
        controller.trigger.setAttribute("aria-expanded", "false");
        if (focusTrigger && controller.trigger.focus) controller.trigger.focus();
      }
    }
    closeSubmenus(0);
    openRoot = null;
    focusedItem = null;
    if (typeof clearTimeout === "function" && typeahead.timer) clearTimeout(typeahead.timer);
    typeahead = { text: "", timer: null };
  }
  function openRootMenu(controller, focusFirst = true) {
    closeRoots();
    openRoot = controller;
    controller.popup.hidden = false;
    controller.trigger.setAttribute("aria-expanded", "true");
    updateItems(controller.popup);
    fillRecent(controller.popup);
    if (focusFirst) focusItemIn(itemsOf(controller.popup, true)[0] || null);
  }

  function hasSub(item) {
    const holder = item && item.parentElement;
    if (!holder || !holder.querySelector) return null;
    /* The sub lives inside the item's own "menu-item" wrapper, first child = item. */
    if (!classTokens(holder).includes("menu-item")) return null;
    if (Array.isArray(holder.children) && holder.children[0] !== item) return null;
    return holder.querySelector(".menu-sub") || null;
  }
  function openSubmenu(item, focusFirst = true) {
    const sub = hasSub(item);
    if (!sub) return null;
    closeSubmenus(openSubs.length);
    sub.hidden = false;
    item.setAttribute("aria-expanded", "true");
    openSubs.push({ popup: sub, parent: item });
    updateItems(sub);
    fillRecent(sub);
    if (focusFirst) focusItemIn(itemsOf(sub, true)[0] || null);
    return sub;
  }
  function activePopup() {
    const deepest = openSubs[openSubs.length - 1];
    return (deepest && deepest.popup) || (openRoot ? openRoot.popup : null);
  }

  /* ---- activation ------------------------------------------------------- */
  function focusItemIn(item) {
    focusedItem = item || null;
    if (item && typeof item.focus === "function") item.focus();
  }
  function stepItems(popup, from, step) {
    const items = itemsOf(popup, true);
    if (!items.length) return null;
    const index = items.indexOf(from);
    return items[index < 0 ? 0 : (index + step + items.length) % items.length];
  }
  function activate(item) {
    if (!item || isDisabled(item)) return false;
    const data = item.dataset || {};
    if (data.sub !== undefined) return false;  // submenu parents toggle, not run
    closeRoots();
    try {
      if (data.command) {
        const command = commands()[data.command];
        if (typeof command !== "function") return false;
        command();
        return true;
      }
      if (data.act) {
        const target = element(data.act);
        if (target && typeof target.click === "function") { target.click(); return true; }
        return false;
      }
      if (data.checkOf) {
        const box = element(data.checkOf);
        if (box && typeof box.click === "function") { box.click(); return true; }
        return false;
      }
      if (data.tab) {
        const tab = element(data.tab);
        if (tab && typeof tab.click === "function") { tab.click(); return true; }
        return false;
      }
      if (typeof data.recentId === "string") { openRecentProject(data.recentId); return true; }
      /* Bare-id items (new buffer / open / save) keep inline listeners. */
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ---- typeahead (JetBrains-style, cyclic on repeated letters) ---------- */
  function typeaheadNext(popup, key) {
    const items = itemsOf(popup, true);
    if (!items.length) return null;
    const lower = key.toLowerCase();
    const repeat = typeahead.text.length === 1 && typeahead.text === lower;
    const buffer = repeat ? lower : typeahead.text + lower;
    typeahead.text = buffer;
    const from = items.indexOf(focusedItem);
    const cyclic = [];
    for (let i = 1; i <= items.length; i++) cyclic.push(items[(from + i) % items.length]);
    const byPrefix = cyclic.filter(item => labelOf(item).toLowerCase().startsWith(buffer));
    const chosen = repeat
      ? byPrefix[0] || null
      : byPrefix[0] || cyclic.find(item => labelOf(item).toLowerCase().includes(lower)) || null;
    if (typeof clearTimeout === "function") { if (typeahead.timer) clearTimeout(typeahead.timer); }
    if (typeof setTimeout === "function") {
      typeahead.timer = setTimeout(() => { typeahead = { text: "", timer: null }; }, TYPEAHEAD_TIMEOUT);
    }
    return chosen;
  }

  /* ---- keyboard --------------------------------------------------------- */
  function triggerKeydown(controller, event) {
    const key = event.key;
    if (key === "ArrowDown" || key === "Enter" || key === " ") {
      event.preventDefault?.();
      controller.open(true);
      return true;
    }
    if (key === "ArrowRight" || key === "ArrowLeft") {
      event.preventDefault?.();
      const step = key === "ArrowRight" ? 1 : -1;
      const next = controllers[(controllers.indexOf(controller) + step + controllers.length) % controllers.length];
      if (controller.popup.hidden === true) {           // menu closed: move focus only
        if (next && next.trigger) next.trigger.focus();
      } else if (next) {
        next.open(true);                                 // menu open: open next root
      }
      return true;
    }
    if (key === "Escape") {
      event.preventDefault?.();
      closeRoots(true);
      return true;
    }
    return false;
  }
  function popupKeydown(controller, event) {
    const popup = activePopup();
    if (!popup) return false;
    const focus = focusedItem;
    const deepest = openSubs[openSubs.length - 1];
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault?.();
        focusItemIn(stepItems(popup, focus, 1));
        return true;
      }
      case "ArrowUp": {
        event.preventDefault?.();
        focusItemIn(stepItems(popup, focus, -1));
        return true;
      }
      case "Home": {
        event.preventDefault?.();
        focusItemIn(itemsOf(popup, true)[0] || null);
        return true;
      }
      case "End": {
        event.preventDefault?.();
        const items = itemsOf(popup, true);
        focusItemIn(items[items.length - 1] || null);
        return true;
      }
      case "Enter":
      case " ": {
        event.preventDefault?.();
        if (focus && hasSub(focus)) { openSubmenu(focus, true); return true; }
        activate(focus);
        return true;
      }
      case "ArrowRight": {
        event.preventDefault?.();
        if (focus && hasSub(focus)) { openSubmenu(focus, true); return true; }
        const next = controllers[(controllers.indexOf(controller) + 1) % controllers.length];
        if (next) next.open(true);
        return true;
      }
      case "ArrowLeft": {
        event.preventDefault?.();
        if (deepest) {                                   // in a submenu: close it
          const parent = deepest.parent;
          closeSubmenus(openSubs.length - 1);
          focusItemIn(parent);
          return true;
        }
        const previous = controllers[(controllers.indexOf(controller) - 1 + controllers.length) % controllers.length];
        if (previous) previous.open(true);
        return true;
      }
      case "Escape": {
        event.preventDefault?.();
        if (openSubs.length) {                           // submenu first, then root
          const parent = deepest.parent;
          closeSubmenus(openSubs.length - 1);
          focusItemIn(parent);
          return true;
        }
        closeRoots(true);
        return true;
      }
      case "Tab": {
        closeRoots();
        return true;
      }
      default: {
        const key = typeof event.key === "string" ? event.key : "";
        if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault?.();
          const chosen = typeaheadNext(popup, key);
          if (chosen) focusItemIn(chosen);
          return true;
        }
        return false;
      }
    }
  }

  /* ---- controllers over the static markup ------------------------------- */
  const controllers = menus.map(menuNode => {
    let trigger = null;
    let popup = null;
    try {
      for (const node of Array.from(menuNode.querySelectorAll(".menu-trigger"))) { trigger = node; break; }
      for (const node of Array.from(menuNode.querySelectorAll(".menu-popup"))) { popup = node; break; }
    } catch (_) { trigger = null; popup = null; }
    if (!trigger || !popup) return null;
    const controller = {
      root: menuNode, trigger, popup,
      open: focusFirst => openRootMenu(controller, focusFirst !== false)
    };
    trigger.addEventListener?.("click", event => {
      event?.stopPropagation?.();
      if (openRoot === controller) closeRoots(true);
      else controller.open(false);
    });
    trigger.addEventListener?.("keydown", event => triggerKeydown(controller, event));
    trigger.addEventListener?.("mouseenter", () => {
      if (openRoot && openRoot !== controller) controller.open(false); // sticky hover
    });
    popup.addEventListener?.("keydown", event => popupKeydown(controller, event));
    popup.addEventListener?.("click", event => {
      const item = itemFromTarget(event.target, popup, doc);
      if (!item) return;
      if (ownerPopupOf(item) !== popup) return;          // nested sub handles its own
      if (isDisabled(item)) { event.preventDefault?.(); return; }
      if (item.dataset?.sub !== undefined) {             // submenu parent toggles
        const stillOpen = openSubs.some(entry => entry.parent === item);
        if (stillOpen) closeSubmenus(openSubs.length - 1);
        else openSubmenu(item, false);
        return;
      }
      activate(item);
    });
    popup.addEventListener?.("mouseover", event => {
      const item = itemFromTarget(event.target, popup, doc);
      if (!item || isDisabled(item)) return;
      if (ownerPopupOf(item) !== popup) return;
      focusItemIn(item);
      if (openSubs.length && openSubs[openSubs.length - 1].parent !== item) {
        closeSubmenus(openSubs.length - 1);
      }
      if (item.dataset?.sub !== undefined) openSubmenu(item, true);
    });
    return controller;
  }).filter(Boolean);
  if (!controllers.length) return null;

  if (options.closeOnPointerDown !== false && typeof doc.addEventListener === "function") {
    doc.addEventListener("pointerdown", event => {
      if (!openRoot) return;
      const target = event.target;
      if (target && typeof target.closest === "function" && target.closest(".menu")) return;
      closeRoots();
    });
  }

  return Object.freeze({
    controllers,
    isOpen: controller => Boolean(controller && controller.popup.hidden === false),
    activeRoot: () => openRoot,
    submenuDepth: () => openSubs.length,
    focusedItem: () => focusedItem,
    activePopup: () => activePopup(),
    typeaheadText: () => typeahead.text,
    closeAll: () => closeRoots(false),
    openRecent: openRecentProject,
    itemsOf,
    stepItems,
    hasSub,
    openSubmenu,
    triggerKey: (controller, event) => triggerKeydown(controller, event),
    popupKey: (controller, event) => popupKeydown(controller, event),
    typeahead: (controller, key) => activePopup() ? typeaheadNext(activePopup(), key) : null,
    dispose() {
      closeRoots(false);
    }
  });
}

const api = Object.freeze({ mount, STATES: WHEN, TYPEAHEAD_TIMEOUT });
root.FlowStudioMenubar = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined") {
  const start = () => {
    try { mount(document, {}); } catch (_) { /* Menubar enhancement is optional. */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
