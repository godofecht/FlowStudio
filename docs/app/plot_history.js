(function (root) {
"use strict";
const LIMIT = 12;
function create(target) {
  const items = [];
  let current = null;
  function render() {
    const holder = document.createElement("div");
    holder.setAttribute("aria-label", "Python and R plot history");
    for (const item of items) {
      const image = document.createElement("img");
      image.alt = (item.svg ? "R plot " : "Python figure ") + item.number;
      image.src = item.svg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(item.svg) :
        "data:image/png;base64," + item.png;
      image.loading = "lazy";
      image.setAttribute("style", "max-width:100%;height:auto");
      holder.append(image);
      const save = document.createElement("a");
      save.href = image.src;
      save.download = "flowstudio-figure-" + item.number + (item.svg ? ".svg" : ".png");
      save.textContent = "Save figure " + item.number;
      holder.append(save);
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.textContent = "Zoom figure " + item.number;
      zoom.setAttribute("aria-pressed", "false");
      let expanded = false;
      zoom.onclick = () => {
        expanded = !expanded;
        image.setAttribute("style", expanded ? "max-width:none;height:auto" : "max-width:100%;height:auto");
        zoom.setAttribute("aria-pressed", String(expanded));
      };
      holder.append(zoom);
    }
    target.replaceChildren(holder);
    current = holder;
  }
  function append(plots) {
    if (!Array.isArray(plots)) return 0;
    let count = 0;
    for (const plot of plots) {
      if (!plot || !Number.isSafeInteger(plot.number) || plot.number < 0) continue;
      if (typeof plot.svg === "string" && new TextEncoder().encode(plot.svg).length <= 60000 &&
          /<svg(?:\\s|>)/.test(plot.svg) && plot.svg.includes("</svg>")) {
        items.push({number:plot.number, svg:plot.svg});
      } else if (typeof plot.png === "string" && plot.png.length <= 1398104 &&
                 plot.png.startsWith("iVBORw0KGgo") && /^[A-Za-z0-9+/=]+$/.test(plot.png)) {
        items.push({number:plot.number, png:plot.png});
      } else continue;
      count++;
    }
    while (items.length > LIMIT) items.shift();
    if (count) render();
    return count;
  }
  function clear() {
    items.length = 0;
    if (current && target.firstChild === current) target.replaceChildren();
    current = null;
  }
  return Object.freeze({append, clear, size:() => items.length});
}
const api = Object.freeze({create, LIMIT});
root.FlowStudioPlotHistory = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
