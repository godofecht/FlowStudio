/* FlowStudio context menus.
 *
 * One menu component for every surface, modelled on the VS Code and
 * JetBrains menus. It opens at the pointer or at the focused item, flips and
 * clamps to stay inside the window, has submenus, full keyboard support
 * (arrows, Home, End, type-ahead, Enter, Escape) and returns focus to where
 * it was. Shortcuts show in macOS glyphs on a Mac and as Ctrl+ elsewhere.
 * A disabled item says why on hover and on focus.
 *
 * Surfaces register a provider with register(). install() takes over the
 * right click and Shift+F10 over the app. Text fields keep the browser menu,
 * so native copy and paste still work there, and the Monaco editor keeps its
 * own menu (frontend/editor_context.js extends it).
 *
 * Item shape: { label, run, shortcut: "Mod+Shift+P", disabled: "why",
 * checked, submenu: [items], danger } or null for a separator.
 */
(function (root) {
"use strict";

const MARGIN = 4;
const TYPEAHEAD_MS = 700;
const SUBMENU_DELAY_MS = 120;

/* ---------- pure helpers (unit tested) ---------- */

function isMacPlatform(nav) {
  const platform = nav && ((nav.userAgentData && nav.userAgentData.platform) || nav.platform || nav.userAgent);
  return /mac|iphone|ipad/i.test(String(platform || ""));
}

const MAC_MODIFIERS = { ctrl: "⌃", alt: "⌥", shift: "⇧", mod: "⌘" };
const MAC_KEYS = {
  enter: "↩", return: "↩", backspace: "⌫", delete: "⌦", escape: "⎋", esc: "⎋",
  tab: "⇥", up: "↑", down: "↓", left: "←", right: "→",
  arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", space: "Space"
};
const OTHER_KEYS = { esc: "Escape", del: "Delete", up: "Up", down: "Down", left: "Left", right: "Right",
  arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right", return: "Enter" };

function modifierOf(part) {
  const name = part.toLowerCase();
  if (name === "mod" || name === "cmd" || name === "meta" || name === "cmdorctrl") return "mod";
  if (name === "ctrl" || name === "control") return "ctrl";
  if (name === "alt" || name === "option" || name === "opt") return "alt";
  if (name === "shift") return "shift";
  return null;
}
/* "Mod+Shift+P" reads "⇧⌘P" on a Mac and "Ctrl+Shift+P" elsewhere.
 * Chords are separated by a space: "Mod+K Mod+C". */
function formatShortcut(spec, mac) {
  if (!spec) return "";
  return String(spec).trim().split(/\s+/).map(chord => {
    const parts = chord.split("+");
    let key = parts.pop();
    if (key === "" && parts.length) { parts.pop(); key = "+"; }
    const mods = new Set(parts.map(modifierOf).filter(Boolean));
    const lower = key.toLowerCase();
    if (mac) {
      const glyphs = ["ctrl", "alt", "shift", "mod"].filter(name => mods.has(name)).map(name => MAC_MODIFIERS[name]);
      const label = MAC_KEYS[lower] || (key.length === 1 ? key.toUpperCase() : key);
      return glyphs.join("") + label;
    }
    // Windows and Linux: Ctrl, Shift, Alt order, as VS Code shows it.
    const names = [];
    if (mods.has("mod") || mods.has("ctrl")) names.push("Ctrl");
    if (mods.has("shift")) names.push("Shift");
    if (mods.has("alt")) names.push("Alt");
    const label = OTHER_KEYS[lower] || (key.length === 1 ? key.toUpperCase() : key);
    return names.concat(label).join("+");
  }).join(" ");
}

/* Where a menu of `size` goes. kind "point": at the pointer, flipped left or
 * up when it would cross the window edge. kind "below": under an anchor
 * rect, flipped above it. kind "submenu": beside a parent row, flipped to
 * the other side. Always clamped inside the window with a small margin, and
 * given a max height (scrolling) when taller than the window. */
function place(size, at, viewport, kind = "point", margin = MARGIN) {
  const vw = Math.max(0, viewport.width), vh = Math.max(0, viewport.height);
  const maxHeight = Math.max(0, vh - margin * 2);
  const height = Math.min(size.height, maxHeight);
  const width = Math.min(size.width, Math.max(0, vw - margin * 2));
  let left, top, flippedX = false, flippedY = false;
  if (kind === "submenu") {
    left = at.right - 2;
    if (left + width > vw - margin) { left = at.left - width + 2; flippedX = true; }
    top = at.top - 4;
    if (top + height > vh - margin) { top = vh - margin - height; flippedY = true; }
  } else if (kind === "below") {
    left = at.left;
    if (left + width > vw - margin) { left = at.right - width; flippedX = true; }
    top = at.bottom + 2;
    if (top + height > vh - margin && at.top - 2 - height >= margin) { top = at.top - 2 - height; flippedY = true; }
  } else {
    left = at.x;
    top = at.y;
    if (left + width > vw - margin) { left = at.x - width; flippedX = true; }
    if (top + height > vh - margin) { top = at.y - height; flippedY = true; }
  }
  left = Math.max(margin, Math.min(left, vw - margin - width));
  top = Math.max(margin, Math.min(top, vh - margin - height));
  return { left: Math.round(left), top: Math.round(top), maxHeight: size.height > maxHeight ? maxHeight : null,
    flippedX, flippedY };
}

/* Items without hidden ones, and without leading, trailing or doubled
 * separators. */
function normalizeItems(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || item === "-" || (item && item.separator)) {
      if (out.length && out[out.length - 1] !== null) out.push(null);
      continue;
    }
    if (!item || item.hidden || typeof item.label !== "string") continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}
function isDisabled(item) {
  return Boolean(item && (item.disabled === true || (typeof item.disabled === "string" && item.disabled)));
}
function disabledReason(item) {
  return item && typeof item.disabled === "string" ? item.disabled : "";
}
/* The next row from `from` in `step` direction, wrapping, skipping
 * separators. Disabled rows stay reachable so their reason can be read. */
function stepIndex(items, from, step) {
  const count = items.length;
  if (!count) return -1;
  let index = from;
  for (let tries = 0; tries < count; tries++) {
    index = index < 0 ? (step > 0 ? 0 : count - 1) : (index + step + count) % count;
    if (items[index] !== null) return index;
  }
  return -1;
}
function edgeIndex(items, last) {
  return last ? stepIndex(items, -1, -1) : stepIndex(items, -1, 1);
}
/* Type-ahead: the next row whose label starts with `prefix`. A single key
 * moves past the current row (pressing "c" again cycles); a longer prefix
 * may stay on it. */
function typeAheadIndex(items, from, prefix) {
  const wanted = String(prefix || "").toLocaleLowerCase();
  if (!wanted) return -1;
  const count = items.length;
  const start = wanted.length > 1 ? Math.max(from, 0) : from + 1;
  for (let step = 0; step < count; step++) {
    const index = ((start + step) % count + count) % count;
    const item = items[index];
    if (item && item.label.toLocaleLowerCase().startsWith(wanted)) return index;
  }
  return -1;
}

/* ---------- clipboard and status, shared by the surfaces ---------- */

function status(message, state) {
  const app = root.FlowStudioApp;
  if (app && typeof app.status === "function") app.status(message, state || "");
}
async function copyText(text, label) {
  const value = String(text == null ? "" : text);
  const clipboard = root.navigator && root.navigator.clipboard;
  try {
    if (!clipboard || typeof clipboard.writeText !== "function") throw new Error("Clipboard unavailable.");
    await clipboard.writeText(value);
  } catch (error) {
    // Older embeds: fall back to a hidden textarea and execCommand.
    const doc = root.document;
    let ok = false;
    if (doc && doc.body && typeof doc.execCommand === "function") {
      const area = doc.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      doc.body.append(area);
      area.select();
      try { ok = doc.execCommand("copy"); } catch (_) { ok = false; }
      area.remove();
    }
    if (!ok) { status("Copy failed: " + (error && error.message || error), "error"); return false; }
  }
  if (label) status("Copied " + label, "ok");
  return true;
}

/* ---------- the menu ---------- */

let current = null;     // the open menu: { levels, doc, restore, cleanup }
let sequence = 0;

function isOpen() { return Boolean(current); }

function close(options = {}) {
  const menu = current;
  if (!menu) return;
  current = null;
  for (const level of menu.levels) level.element.remove();
  if (menu.tip) menu.tip.remove();
  clearTimeout(menu.hoverTimer);
  clearTimeout(menu.typedTimer);
  menu.cleanup();
  if (options.restoreFocus !== false) restoreFocus(menu.restore);
  if (typeof menu.onClose === "function") { try { menu.onClose(); } catch (_) { /* best effort */ } }
}
function restoreFocus(target) {
  if (!target || typeof target.focus !== "function") return;
  if (target.isConnected === false) return;
  try { target.focus({ preventScroll: true }); } catch (_) { /* detached */ }
}

function viewportOf(doc) {
  const win = doc.defaultView || root;
  const element = doc.documentElement || {};
  return { width: win.innerWidth || element.clientWidth || 1024, height: win.innerHeight || element.clientHeight || 768 };
}

function buildLevel(menu, items, parent) {
  const doc = menu.doc;
  const element = doc.createElement("div");
  element.className = "fs-cm" + (menu.reducedMotion ? " fs-cm-still" : "");
  element.setAttribute("role", "menu");
  element.setAttribute("aria-orientation", "vertical");
  element.tabIndex = -1;
  element.id = "fs-cm-" + (++sequence);
  if (parent) element.setAttribute("aria-label", parent.item.label);
  else if (menu.label) element.setAttribute("aria-label", menu.label);
  const level = { element, items, nodes: [], active: -1, parent, child: null };
  items.forEach((item, index) => {
    if (item === null) {
      const rule = doc.createElement("div");
      rule.className = "fs-cm-sep";
      rule.setAttribute("role", "separator");
      level.nodes.push(rule);
      element.append(rule);
      return;
    }
    const row = doc.createElement("div");
    const checkable = typeof item.checked === "boolean";
    row.className = "fs-cm-item" + (item.danger ? " fs-cm-danger" : "");
    row.setAttribute("role", checkable ? "menuitemcheckbox" : "menuitem");
    if (checkable) row.setAttribute("aria-checked", String(item.checked));
    row.tabIndex = -1;
    row.dataset.index = String(index);
    if (item.id) row.dataset.id = item.id;
    const check = doc.createElement("span");
    check.className = "fs-cm-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = item.checked ? "✓" : "";
    const label = doc.createElement("span");
    label.className = "fs-cm-label";
    label.textContent = item.label;
    const key = doc.createElement("span");
    key.className = "fs-cm-key";
    key.setAttribute("aria-hidden", "true");
    if (item.submenu) {
      row.setAttribute("aria-haspopup", "menu");
      row.setAttribute("aria-expanded", "false");
      key.textContent = "›";
      key.classList.add("fs-cm-arrow");
    } else {
      key.textContent = formatShortcut(item.shortcut, menu.mac);
      if (item.shortcut) row.setAttribute("aria-keyshortcuts", String(item.shortcut).replace(/Mod/g, menu.mac ? "Meta" : "Control"));
    }
    row.append(check, label, key);
    if (isDisabled(item)) {
      row.setAttribute("aria-disabled", "true");
      const reason = disabledReason(item);
      if (reason) row.dataset.reason = reason;
    }
    level.nodes.push(row);
    element.append(row);
  });
  element.addEventListener("keydown", event => onKey(menu, level, event));
  element.addEventListener("pointermove", event => {
    const row = event.target && event.target.closest ? event.target.closest(".fs-cm-item") : null;
    if (!row || !element.contains(row)) return;
    const index = Number(row.dataset.index);
    if (index !== level.active) setActive(menu, level, index, false);
    scheduleSubmenu(menu, level, index);
  });
  element.addEventListener("pointerleave", () => clearTimeout(menu.hoverTimer));
  element.addEventListener("click", event => {
    const row = event.target && event.target.closest ? event.target.closest(".fs-cm-item") : null;
    if (!row || !element.contains(row)) return;
    event.preventDefault();
    event.stopPropagation();
    activate(menu, level, Number(row.dataset.index));
  });
  // A right click inside an open menu does nothing more.
  element.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); });
  return level;
}

function positionLevel(menu, level, at, kind) {
  const element = level.element;
  element.style.left = "0px";
  element.style.top = "0px";
  element.style.visibility = "hidden";
  menu.doc.body.append(element);
  // One layout read for the whole menu.
  const box = element.getBoundingClientRect();
  const spot = place({ width: box.width, height: box.height }, at, viewportOf(menu.doc), kind);
  element.style.left = spot.left + "px";
  element.style.top = spot.top + "px";
  if (spot.maxHeight !== null) { element.style.maxHeight = spot.maxHeight + "px"; element.classList.add("fs-cm-scroll"); }
  element.style.visibility = "";
  element.dataset.flipX = String(spot.flippedX);
  element.dataset.flipY = String(spot.flippedY);
  element.classList.add("fs-cm-in");
  return spot;
}

function setActive(menu, level, index, focus = true) {
  const previous = level.nodes[level.active];
  if (previous && previous.classList) previous.classList.remove("fs-cm-active");
  level.active = index;
  const row = level.nodes[index];
  hideTip(menu);
  if (!row || level.items[index] === null) return;
  row.classList.add("fs-cm-active");
  if (focus) { try { row.focus({ preventScroll: false }); } catch (_) { row.focus(); } }
  if (row.dataset.reason) showTip(menu, row);
}
function showTip(menu, row) {
  const doc = menu.doc;
  if (!menu.tip) {
    menu.tip = doc.createElement("div");
    menu.tip.className = "fs-cm-tip";
    menu.tip.setAttribute("role", "tooltip");
    menu.tip.id = "fs-cm-tip-" + (++sequence);
  }
  const tip = menu.tip;
  tip.textContent = row.dataset.reason;
  row.setAttribute("aria-describedby", tip.id);
  tip.style.left = "0px";
  tip.style.top = "0px";
  tip.hidden = false;
  doc.body.append(tip);
  const rect = row.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  const spot = place({ width: box.width, height: box.height },
    { left: rect.left, right: rect.right + 6, top: rect.top + 4, bottom: rect.bottom }, viewportOf(doc), "submenu");
  tip.style.left = spot.left + "px";
  tip.style.top = spot.top + "px";
}
function hideTip(menu) {
  if (menu.tip) menu.tip.hidden = true;
}

function scheduleSubmenu(menu, level, index) {
  clearTimeout(menu.hoverTimer);
  const item = level.items[index];
  if (level.child && level.child.parent.index !== index) closeLevel(menu, level.child);
  if (!item || !item.submenu || isDisabled(item)) return;
  if (level.child) return;
  menu.hoverTimer = setTimeout(() => openSubmenu(menu, level, index, false), SUBMENU_DELAY_MS);
}
function openSubmenu(menu, level, index, focusFirst) {
  const item = level.items[index];
  if (!item || !item.submenu || isDisabled(item) || !current || current !== menu) return null;
  if (level.child && level.child.parent.index === index) {
    if (focusFirst) setActive(menu, level.child, edgeIndex(level.child.items, false));
    return level.child;
  }
  if (level.child) closeLevel(menu, level.child);
  const items = normalizeItems(typeof item.submenu === "function" ? item.submenu() : item.submenu);
  if (!items.length) return null;
  const row = level.nodes[index];
  const child = buildLevel(menu, items, { level, index, item });
  level.child = child;
  menu.levels.push(child);
  row.setAttribute("aria-expanded", "true");
  row.setAttribute("aria-controls", child.element.id);
  const rect = row.getBoundingClientRect();
  positionLevel(menu, child, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, "submenu");
  if (focusFirst) setActive(menu, child, edgeIndex(items, false));
  return child;
}
function closeLevel(menu, level) {
  if (level.child) closeLevel(menu, level.child);
  level.element.remove();
  menu.levels = menu.levels.filter(item => item !== level);
  if (level.parent) {
    const parentLevel = level.parent.level;
    parentLevel.child = null;
    const row = parentLevel.nodes[level.parent.index];
    if (row) { row.setAttribute("aria-expanded", "false"); row.removeAttribute("aria-controls"); }
  }
  hideTip(menu);
}

function activate(menu, level, index) {
  const item = level.items[index];
  if (!item) return;
  if (isDisabled(item)) { setActive(menu, level, index); return; }
  if (item.submenu) { openSubmenu(menu, level, index, true); return; }
  // Focus goes back first, so an action that moves focus elsewhere wins.
  close({ restoreFocus: item.keepFocus !== true });
  run(item);
}
function run(item) {
  if (typeof item.run !== "function") return;
  try {
    const result = item.run();
    if (result && typeof result.then === "function")
      result.then(null, error => status((item.label || "Action") + " failed: " + (error && error.message || error), "error"));
  } catch (error) {
    status((item.label || "Action") + " failed: " + (error && error.message || error), "error");
  }
}

function onKey(menu, level, event) {
  const key = event.key;
  const items = level.items;
  const stop = () => { event.preventDefault(); event.stopPropagation(); };
  if (key === "ArrowDown") { stop(); setActive(menu, level, stepIndex(items, level.active, 1)); return; }
  if (key === "ArrowUp") { stop(); setActive(menu, level, stepIndex(items, level.active, -1)); return; }
  if (key === "Home" || key === "PageUp") { stop(); setActive(menu, level, edgeIndex(items, false)); return; }
  if (key === "End" || key === "PageDown") { stop(); setActive(menu, level, edgeIndex(items, true)); return; }
  if (key === "Enter" || key === " ") {
    stop();
    if (level.active >= 0) activate(menu, level, level.active);
    return;
  }
  if (key === "ArrowRight") {
    stop();
    const item = items[level.active];
    if (item && item.submenu) openSubmenu(menu, level, level.active, true);
    return;
  }
  if (key === "ArrowLeft" || (key === "Escape" && level.parent)) {
    stop();
    if (level.parent) {
      const parent = level.parent;
      closeLevel(menu, level);
      setActive(menu, parent.level, parent.index);
    }
    return;
  }
  if (key === "Escape" || key === "Tab") { stop(); close(); return; }
  if (key && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && key !== " ") {
    stop();
    const now = Date.now();
    menu.typed = now - menu.typedAt > TYPEAHEAD_MS ? key : menu.typed + key;
    menu.typedAt = now;
    const found = typeAheadIndex(items, level.active, menu.typed);
    if (found >= 0) setActive(menu, level, found);
    clearTimeout(menu.typedTimer);
    menu.typedTimer = setTimeout(() => { menu.typed = ""; }, TYPEAHEAD_MS);
  }
}

/* Opens a menu. spec: { items, x, y } for a pointer, or { anchor } (an
 * element or rect) for the keyboard; { keyboard: true } focuses the first
 * row; { returnFocus } is where focus goes on close (default: where it is);
 * { target } is the element the menu is for, so scrolling it closes the menu. */
function open(spec) {
  const doc = spec.doc || root.document;
  if (!doc || !doc.body) return null;
  close({ restoreFocus: false });
  const items = normalizeItems(spec.items);
  if (!items.length) return null;
  const win = doc.defaultView || root;
  let reducedMotion = false;
  try { reducedMotion = Boolean(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch (_) { reducedMotion = false; }
  const menu = {
    doc, levels: [], label: spec.label || "Context menu", mac: spec.mac !== undefined ? spec.mac : isMacPlatform(win.navigator),
    restore: spec.returnFocus !== undefined ? spec.returnFocus : doc.activeElement,
    onClose: spec.onClose, typed: "", typedAt: 0, hoverTimer: 0, typedTimer: 0, tip: null, reducedMotion,
    cleanup: () => {}
  };
  current = menu;
  const level = buildLevel(menu, items, null);
  menu.levels.push(level);
  let at, kind;
  if (spec.anchor) {
    const rect = typeof spec.anchor.getBoundingClientRect === "function" ? spec.anchor.getBoundingClientRect() : spec.anchor;
    at = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    kind = "below";
  } else {
    at = { x: Number(spec.x) || 0, y: Number(spec.y) || 0 };
    kind = "point";
  }
  const spot = positionLevel(menu, level, at, kind);
  menu.spot = spot;
  if (spec.keyboard) setActive(menu, level, edgeIndex(items, false));
  else { try { level.element.focus({ preventScroll: true }); } catch (_) { level.element.focus(); } }

  /* Close on outside press, scroll, blur and resize. */
  const inside = target => menu.levels.some(item => item.element.contains(target)) || (menu.tip && menu.tip.contains(target));
  const onPointer = event => { if (!inside(event.target)) close({ restoreFocus: false }); };
  /* Scrolling closes the menu when it moves what the menu belongs to: the
   * page, or a scroller holding the right-clicked element. Output streaming
   * into some other pane (a busy terminal) leaves it open. */
  const owner = spec.target || null;
  const onScroll = event => {
    const scrolled = event.target;
    if (inside(scrolled)) return;
    if (event.type === "wheel" || !owner || scrolled === doc || scrolled === doc.documentElement ||
        scrolled === doc.body || (scrolled && typeof scrolled.contains === "function" && scrolled.contains(owner)))
      close({ restoreFocus: false });
  };
  const onBlur = () => close({ restoreFocus: false });
  const onResize = () => close({ restoreFocus: false });
  const onFocus = event => { if (!inside(event.target)) close({ restoreFocus: false }); };
  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("wheel", onScroll, { capture: true, passive: true });
  doc.addEventListener("focusin", onFocus, true);
  win.addEventListener("blur", onBlur);
  win.addEventListener("resize", onResize);
  menu.cleanup = () => {
    doc.removeEventListener("pointerdown", onPointer, true);
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("wheel", onScroll, { capture: true, passive: true });
    doc.removeEventListener("focusin", onFocus, true);
    win.removeEventListener("blur", onBlur);
    win.removeEventListener("resize", onResize);
  };
  return Object.freeze({
    element: level.element,
    position: spot,
    close: () => { if (current === menu) close(); }
  });
}

/* ---------- surfaces ---------- */

const providers = [];

/* register({ name, selector, items(ctx), anchor(ctx) }): `selector` (or a
 * match(target) function) finds the surface element under the pointer or
 * focus. items returns the list, or null to fall through. */
function register(provider) {
  if (!provider || typeof provider.items !== "function") throw new TypeError("A provider needs items().");
  const index = providers.findIndex(item => item.name && item.name === provider.name);
  if (index >= 0) providers.splice(index, 1, provider);
  else providers.push(provider);
  return () => { const at = providers.indexOf(provider); if (at >= 0) providers.splice(at, 1); };
}
function surfaceFor(target) {
  if (!target || typeof target.closest !== "function") return null;
  let best = null;
  for (const provider of providers) {
    const element = typeof provider.match === "function" ? provider.match(target) :
      provider.selector ? target.closest(provider.selector) : null;
    if (!element) continue;
    // The innermost surface wins: a console inside the dock beats the dock.
    if (!best || (best.element !== element && best.element.contains(element))) best = { provider, element };
  }
  return best;
}

const TEXT_INPUTS = /^(text|search|url|email|tel|password|number)$/i;
/* Fields where people expect the browser's own copy and paste menu. */
function isNativeTextField(target) {
  if (!target || typeof target.closest !== "function") return false;
  if (target.closest(".monaco-editor, .xterm")) return false;
  const field = target.closest("input, textarea, [contenteditable=''], [contenteditable='true']");
  if (!field) return false;
  if (field.tagName === "INPUT") return TEXT_INPUTS.test(field.type || "text");
  return true;
}

function selectionText(doc) {
  const win = doc.defaultView || root;
  const selection = win.getSelection ? win.getSelection() : null;
  return selection ? String(selection) : "";
}

/* Right click on app chrome with no surface: copy any selected text, and
 * reach every command. The browser menu stays off app surfaces. */
function fallbackItems(doc) {
  const text = selectionText(doc);
  return [
    { label: "Copy", shortcut: "Mod+C", disabled: text ? false : "Select some text first.",
      run: () => copyText(text, "selection") },
    null,
    { label: "Command Palette", shortcut: "Mod+K", run: () => commandPalette() }
  ];
}
function commandPalette() {
  const search = root.FlowStudioSearchEverywhere;
  if (search && search.instance && typeof search.instance.open === "function") { search.instance.open("", "commands"); return true; }
  status("The command palette is not available.", "error");
  return false;
}

function contextFor(surface, target, event, keyboard) {
  return { target, element: surface ? surface.element : null, event, keyboard,
    x: event && Number.isFinite(event.clientX) ? event.clientX : 0,
    y: event && Number.isFinite(event.clientY) ? event.clientY : 0 };
}

function openFor(doc, target, event, keyboard) {
  const surface = surfaceFor(target);
  const context = contextFor(surface, target, event, keyboard);
  let items = null;
  let label = "Context menu";
  if (surface) {
    try { items = surface.provider.items(context); }
    catch (error) { status("Menu failed: " + (error && error.message || error), "error"); items = null; }
    label = surface.provider.label || (surface.provider.name ? surface.provider.name + " actions" : label);
  }
  if (!items) items = fallbackItems(doc);
  const spec = { doc, items, label, keyboard, target };
  if (keyboard) {
    let anchor = surface && typeof surface.provider.anchor === "function" ? surface.provider.anchor(context) : null;
    if (!anchor) anchor = target && typeof target.getBoundingClientRect === "function" ? target : null;
    if (anchor) spec.anchor = anchor; else { spec.x = 16; spec.y = 16; }
  } else { spec.x = context.x; spec.y = context.y; }
  return open(spec);
}

let installed = null;
function install(doc) {
  doc = doc || root.document;
  if (!doc || installed === doc) return false;
  installed = doc;
  doc.addEventListener("contextmenu", event => {
    if (event.defaultPrevented) return;          // Monaco and other owners
    const target = event.target;
    if (current && current.levels.some(level => level.element.contains(target))) { event.preventDefault(); return; }
    if (isNativeTextField(target)) { close({ restoreFocus: false }); return; }
    if (target && typeof target.closest === "function") {
      if (target.closest(".monaco-editor")) return;
      // Links keep the browser menu (open in new tab, copy link).
      if (target.closest("a[href]")) return;
    }
    event.preventDefault();
    openFor(doc, target, event, false);
  });
  doc.addEventListener("keydown", event => {
    if (event.defaultPrevented) return;
    const opener = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey);
    if (!opener) return;
    const target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    if (!target) return;
    if (current && current.levels.some(level => level.element.contains(target))) return;
    if (target.closest && target.closest(".monaco-editor")) return;   // Monaco binds Shift+F10
    if (isNativeTextField(target)) return;
    event.preventDefault();
    event.stopPropagation();
    openFor(doc, target, null, true);
  });
  return true;
}

const api = Object.freeze({
  open, close, isOpen, register, install, surfaceFor, copyText, status, commandPalette,
  // pure helpers
  place, formatShortcut, normalizeItems, stepIndex, edgeIndex, typeAheadIndex, isDisabled, disabledReason,
  isMacPlatform, isNativeTextField,
  current: () => current
});
root.FlowStudioContextMenu = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.body !== undefined) install(document);
})(typeof globalThis !== "undefined" ? globalThis : this);
