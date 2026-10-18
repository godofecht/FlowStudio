/* Standalone local PNG history UI; independent of FlowStudio's native server. */
(function (root) {
  "use strict";
  function mount(doc = document, urls = URL) {
    const input = doc.getElementById("plotFiles");
    const list = doc.getElementById("plotHistory");
    const image = doc.getElementById("plotImage");
    const empty = doc.getElementById("plotEmpty");
    const zoom = doc.getElementById("plotZoom");
    const save = doc.getElementById("plotSave");
    const clear = doc.getElementById("plotClear");
    const status = doc.getElementById("plotStatus");
    const history = root.FlowStudioPlots.createHistory(urls);
    function render() {
      list.replaceChildren();
      for (const item of history.entries()) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = item.name;
        button.title = item.name;
        button.setAttribute("aria-pressed", String(history.current()?.id === item.id));
        button.addEventListener("click", () => { history.select(item.id); render(); });
        list.append(button);
      }
      const selected = history.current();
      image.hidden = !selected;
      empty.hidden = !!selected;
      save.hidden = !selected;
      save.removeAttribute("href");
      if (selected) {
        image.src = selected.url;
        image.alt = "Plot: " + selected.name;
        save.href = selected.url;
        save.download = selected.name;
      } else {
        image.removeAttribute("src");
      }
      image.style.width = zoom.value + "%";
      status.textContent = history.entries().length + " plot(s)";
    }
    input.addEventListener("change", () => {
      let errors = 0;
      for (const file of Array.from(input.files || [])) {
        try { history.add(file); } catch (_) { errors++; }
      }
      input.value = "";
      render();
      if (errors) status.textContent += "; " + errors + " file(s) rejected (PNG, max 16 MiB)";
    });
    zoom.addEventListener("input", render);
    clear.addEventListener("click", () => { history.clear(); render(); });
    root.addEventListener?.("pagehide", () => history.clear(), {once: true});
    render();
    return history;
  }
  root.FlowStudioPlotPage = Object.freeze({mount});
  if (typeof module !== "undefined" && module.exports) module.exports = root.FlowStudioPlotPage;
})(typeof globalThis !== "undefined" ? globalThis : this);
