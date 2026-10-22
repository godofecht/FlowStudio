(function (root) {
"use strict";
const LIMIT = 12;
function create(target) {
  const items = [];
  let current = null;
  function render() {
    const holder = document.createElement("div");
    holder.setAttribute("aria-label", "Python plot history");
    for (const item of items) {
      const image = document.createElement("img");
      image.alt = "Python figure " + item.number;
      image.src = "data:image/png;base64," + item.png;
      image.loading = "lazy";
      holder.append(image);
    }
    target.replaceChildren(holder);
    current = holder;
  }
  function append(plots) {
    if (!Array.isArray(plots)) return 0;
    let count = 0;
    for (const plot of plots) {
      if (!plot || !Number.isSafeInteger(plot.number) || plot.number < 0 ||
          typeof plot.png !== "string" || plot.png.length > 1398104 ||
          !plot.png.startsWith("iVBORw0KGgo") || !/^[A-Za-z0-9+/=]+$/.test(plot.png)) continue;
      items.push({number:plot.number, png:plot.png});
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
