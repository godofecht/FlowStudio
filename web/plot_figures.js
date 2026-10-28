/* Workspace figure panel: captured R SVG/PDF and Python PNG plots. */
(function (global) {
"use strict";
const ROUTES = Object.freeze({ r: "/api/plot/r", python: "/api/plot/python" });
const LIMIT = 12;
const MAX_SVG_CHARS = 60000;
const MAX_PDF_CHARS = 120000;
const MAX_PNG_CHARS = 1398104;

function validEntry(plot) {
  if (!plot || typeof plot !== "object" || !Number.isSafeInteger(plot.number) ||
      plot.number < 0 || plot.number > 999999)
    return null;
  if (typeof plot.svg === "string" && plot.svg.length >= 9 &&
      plot.svg.length <= MAX_SVG_CHARS && plot.svg.includes("<svg") &&
      plot.svg.includes("</svg>"))
    return { number: plot.number, svg: plot.svg };
  if (typeof plot.pdf === "string" && plot.pdf.length >= 8 &&
      plot.pdf.length <= MAX_PDF_CHARS && plot.pdf.length % 2 === 0 &&
      plot.pdf.startsWith("25504446") && /^[0-9a-f]+$/.test(plot.pdf))
    return { number: plot.number, pdf: plot.pdf };
  if (typeof plot.png === "string" && plot.png.length >= 8 &&
      plot.png.length <= MAX_PNG_CHARS && plot.png.startsWith("iVBORw0KGgo") &&
      /^[A-Za-z0-9+/=]+$/.test(plot.png))
    return { number: plot.number, png: plot.png };
  return null;
}

async function collect(language, fetcher) {
  if (!(language === "r" || language === "python")) return [];
  const fetchFn = typeof fetcher === "function" ? fetcher :
    (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return [];
  try {
    const response = await fetchFn(ROUTES[language], {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
      body: ""
    });
    if (!response.ok) return [];
    const text = await response.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.plots)) return [];
    return data.plots.map(validEntry).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function figureElement(doc, item) {
  const figure = doc.createElement("figure");
  figure.className = "captured-figure";
  let image;
  if (item.svg) {
    image = doc.createElement("img");
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(item.svg);
    image.alt = "R plot " + item.number + " (SVG)";
  } else if (item.pdf) {
    let binary = "";
    for (let offset = 0; offset < item.pdf.length; offset += 2)
      binary += String.fromCharCode(parseInt(item.pdf.slice(offset, offset + 2), 16));
    image = doc.createElement("embed");
    image.type = "application/pdf";
    image.src = "data:application/pdf;base64," + btoa(binary);
    image.title = "R plot " + item.number + " (PDF)";
    image.setAttribute("style", "width:100%;height:30rem");
  } else {
    image = doc.createElement("img");
    image.src = "data:image/png;base64," + item.png;
    image.alt = "Python figure " + item.number;
  }
  image.loading = "lazy";
  figure.append(image);
  const caption = doc.createElement("figcaption");
  caption.append(item.svg ? "R plot " : item.pdf ? "R plot " : "Python figure ", String(item.number));
  const save = doc.createElement("a");
  save.href = image.src;
  save.download = "flowstudio-figure-" + item.number +
    (item.svg ? ".svg" : item.pdf ? ".pdf" : ".png");
  save.textContent = "Save";
  caption.append(" ", save);
  figure.append(caption);
  return figure;
}

function create(doc, host) {
  const items = [];
  function render() {
    if (!doc || !host) return;
    host.replaceChildren();
    for (const item of items.slice(-LIMIT)) host.append(figureElement(doc, item));
  }
  return Object.freeze({
    append(plots) {
      if (!Array.isArray(plots)) return 0;
      let added = 0;
      for (const plot of plots) {
        const valid = validEntry(plot);
        if (!valid) continue;
        items.push(valid);
        added++;
      }
      while (items.length > LIMIT) items.shift();
      if (added) render();
      return added;
    },
    clear() {
      items.length = 0;
      if (host) host.replaceChildren();
    },
    size: () => items.length
  });
}

async function show(root, doc, language, status) {
  const plots = await collect(language);
  if (!plots.length) return false;
  const host = doc.getElementById("plotFigures");
  const panelKey = "__flowstudioPlotPanel:" + language;
  let panel = root[panelKey];
  if (!panel) {
    panel = create(doc, host);
    try { Object.defineProperty(root, panelKey, { value: panel }); }
    catch (_) { root[panelKey] = panel; }
  }
  const added = panel.append(plots);
  if (!added) return false;
  const tab = doc.getElementById("tab-plots");
  if (tab) tab.click();
  if (typeof status === "function")
    status(added === 1 ? "1 figure captured. See the Plots tab." :
      added + " figures captured. See the Plots tab.", "ok");
  return true;
}

const api = Object.freeze({ ROUTES, LIMIT, validEntry, collect, create, show });
global.FlowStudioPlotFigures = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
