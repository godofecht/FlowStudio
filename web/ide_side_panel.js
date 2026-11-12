/* The secondary side panel: a tab strip (Preview, Environment) and a close
 * button. Visibility belongs to the layout manager (web/ide_shell.js). */
(function (root) {
"use strict";

function mount(doc, options = {}) {
  const panel = doc.getElementById("rightPanel");
  if (!panel) return null;
  const layout = () => options.layout || root.FlowStudioLayout || null;
  const tabs = Array.from(panel.querySelectorAll(".rp-tabs [role='tab']"));
  const KEY = "flowstudio.sidepanel.view";
  let storage = options.storage;
  if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }

  function select(name, remember = true) {
    for (const tab of tabs) {
      const on = tab.id === "rpTab-" + name;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      const view = doc.getElementById(tab.getAttribute("aria-controls"));
      if (view) view.hidden = !on;
    }
    if (remember && storage) { try { storage.setItem(KEY, name); } catch (_) { /* optional */ } }
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab.id.slice("rpTab-".length)));
    tab.addEventListener("keydown", event => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  }
  const close = doc.getElementById("rightPanelClose");
  if (close) close.addEventListener("click", () => { const l = layout(); if (l) l.hide("right"); });
  let saved = null;
  try { saved = storage && storage.getItem(KEY); } catch (_) { saved = null; }
  if (saved && tabs.some(tab => tab.id === "rpTab-" + saved)) select(saved, false);

  return Object.freeze({
    select,
    show(name) { select(name); const l = layout(); if (l) l.show("right"); },
    selected: () => { const tab = tabs.find(item => item.getAttribute("aria-selected") === "true"); return tab ? tab.id.slice(6) : null; }
  });
}

const api = Object.freeze({ mount });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioSidePanelModule = api;
if (typeof document !== "undefined" && document.getElementById("rightPanel")) {
  try { root.FlowStudioSidePanel = mount(document, {}); }
  catch (error) { if (root.console) root.console.error("FlowStudio side panel failed to mount: " + (error && error.message)); }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
