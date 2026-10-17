/* Accessible Files, Plots and Data workspace tabs for FlowStudio. */
(function (root) {
  "use strict";
  const NAMES = ["files", "plots", "data"];
  const SOURCES = Object.freeze({plots: "/plots", data: "/data"});

  function mount(doc = document, storage = null) {
    if (storage === null) {
      try { storage = root.sessionStorage; }
      catch (_) { storage = undefined; }
    }
    const tabs = NAMES.map(name => doc.getElementById("tab-" + name));
    const panels = NAMES.map(name => doc.getElementById("view-" + name));
    if (tabs.some(tab => !tab) || panels.some(panel => !panel))
      throw new Error("FlowStudio workspace tabs are incomplete");

    let selected = "files";
    try {
      const saved = storage && storage.getItem("flowstudio.workspace.tab");
      if (NAMES.includes(saved)) selected = saved;
    } catch (_) { /* Storage can be disabled in private browsing. */ }

    function select(name, focus = false) {
      const index = NAMES.indexOf(name);
      if (index < 0) return false;
      selected = name;
      NAMES.forEach((key, i) => {
        tabs[i].setAttribute("aria-selected", String(i === index));
        tabs[i].tabIndex = i === index ? 0 : -1;
        panels[i].hidden = i !== index;
      });
      if (SOURCES[name]) {
        const frame = panels[index].querySelector("iframe");
        if (!frame) throw new Error("Missing " + name + " frame");
        if (!frame.getAttribute("src")) frame.setAttribute("src", SOURCES[name]);
      }
      if (focus) tabs[index].focus();
      try { storage && storage.setItem("flowstudio.workspace.tab", name); }
      catch (_) { /* Tabs remain usable without storage. */ }
      return true;
    }

    NAMES.forEach((name, index) => {
      tabs[index].addEventListener("click", () => select(name));
      tabs[index].addEventListener("keydown", event => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % NAMES.length;
        else if (event.key === "ArrowLeft") next = (index + NAMES.length - 1) % NAMES.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = NAMES.length - 1;
        else return;
        event.preventDefault();
        select(NAMES[next], true);
      });
    });
    select(selected);
    return Object.freeze({select, current: () => selected});
  }

  const api = Object.freeze({mount});
  root.FlowStudioWorkspaceTabs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
