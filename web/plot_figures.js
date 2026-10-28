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
    if (!data) return [];
    if (Array.isArray(data.plots))
      return data.plots.map(validEntry).filter(Boolean);
    // The R kernel still answers with one snapshot: {svg, pdf, warning}.
    if (typeof data.svg === "string" || typeof data.pdf === "string")
      return [validEntry({number: 1, svg: data.svg, pdf: data.pdf})].filter(Boolean);
    return [];
  } catch (_) {
    return [];
  }
}

function pdfBytes(urlTarget, hex) {
  let binary = "";
  for (let offset = 0; offset < hex.length; offset += 2)
    binary += String.fromCharCode(parseInt(hex.slice(offset, offset + 2), 16));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (urlTarget && typeof urlTarget.createObjectURL === "function" &&
      typeof Blob === "function")
    return urlTarget.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  return "data:application/pdf;base64," + btoa(binary);
}

function figureElement(doc, item, urlTarget) {
  const figure = doc.createElement("figure");
  figure.className = "captured-figure";
  let image;
  if (item.svg) {
    image = doc.createElement("img");
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(item.svg);
    image.alt = "R plot " + item.number + " (SVG)";
  } else if (item.pdf) {
    image = doc.createElement("embed");
    image.type = "application/pdf";
    // Chrome refuses data: PDFs inside embed; use blob URLs when available.
    image.src = pdfBytes(urlTarget, item.pdf);
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
  let renderedBlobs = [];
  function release() {
    const urlTarget = typeof URL !== "undefined" ? URL : null;
    if (urlTarget && typeof urlTarget.revokeObjectURL === "function")
      for (const url of renderedBlobs) urlTarget.revokeObjectURL(url);
    renderedBlobs = [];
  }
  function render() {
    if (!doc || !host) return;
    release();
    const urlTarget = typeof URL !== "undefined" ? URL : null;
    host.replaceChildren();
    for (const item of items.slice(-LIMIT)) {
      const figure = figureElement(doc, item, urlTarget);
      host.append(figure);
      if (item.pdf && urlTarget && typeof urlTarget.createObjectURL === "function" &&
          figure.children[0] &&
          String(figure.children[0].src || "").startsWith("blob:"))
        renderedBlobs.push(figure.children[0].src);
    }
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
      release();
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

const api = Object.freeze({ ROUTES, LIMIT, validEntry, collect, create, show, figureElement });
global.FlowStudioPlotFigures = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
