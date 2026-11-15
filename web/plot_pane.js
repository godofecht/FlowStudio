/* The Plots pane: one figure at a time with a history, as in RStudio.
 *
 * Flow, R and Python figures share this history. Back and forward step
 * through it, zoom scales the shown figure, and export saves it as PNG or,
 * for vector figures, as SVG. Figures stay in this browser tab; nothing is
 * sent to the server. The history keeps the newest LIMIT figures and at
 * most MAX_TOTAL_CHARS of image text.
 */
(function (root) {
"use strict";

const LIMIT = 50;
const MAX_SVG_CHARS = 200000;
const MAX_PNG_CHARS = 1398104;
const MAX_PDF_CHARS = 120000;
const MAX_TOTAL_CHARS = 32 * 1024 * 1024;
const ZOOMS = Object.freeze([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
const KINDS = Object.freeze(["svg", "png", "pdf"]);

/* A history entry, or null when the figure is malformed or too large. */
function validate(entry) {
  if (!entry || typeof entry !== "object" || !KINDS.includes(entry.kind) || typeof entry.data !== "string")
    return null;
  const data = entry.data;
  const label = String(entry.label || "Plot").slice(0, 80);
  if (entry.kind === "svg") {
    const text = data.trim();
    if (text.length < 11 || text.length > MAX_SVG_CHARS || !/^<svg[\s>]/.test(text) || !text.endsWith("</svg>"))
      return null;
    return { kind: "svg", data: text, label };
  }
  if (entry.kind === "png") {
    if (data.length < 8 || data.length > MAX_PNG_CHARS || !data.startsWith("iVBORw0KGgo") || !/^[A-Za-z0-9+/=]+$/.test(data))
      return null;
    return { kind: "png", data, label };
  }
  if (data.length < 8 || data.length > MAX_PDF_CHARS || data.length % 2 || !data.startsWith("25504446") || !/^[0-9a-f]+$/.test(data))
    return null;
  return { kind: "pdf", data, label };
}

function svgUrl(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function pdfBlob(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new Blob([bytes], { type: "application/pdf" });
}

/* The next zoom level above or below `current`. */
function stepZoom(current, direction) {
  if (direction > 0) return ZOOMS.find(level => level > current + 1e-6) || ZOOMS[ZOOMS.length - 1];
  for (let i = ZOOMS.length - 1; i >= 0; i--) if (ZOOMS[i] < current - 1e-6) return ZOOMS[i];
  return ZOOMS[0];
}

/* "flowstudio-flow-plot-3" from "Flow plot 3". */
function fileStem(label) {
  const slug = String(label || "plot").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return "flowstudio-" + (slug || "plot");
}

/* The history and position, without a document. */
function createHistory(limit = LIMIT) {
  const entries = [];
  let index = -1, nextId = 1, total = 0;
  const counts = Object.create(null);
  return {
    add(entry) {
      const valid = validate(entry);
      if (!valid) return null;
      const item = Object.freeze(Object.assign({ id: nextId++ }, valid));
      entries.push(item);
      total += item.data.length;
      while (entries.length > limit || (total > MAX_TOTAL_CHARS && entries.length > 1)) {
        total -= entries.shift().data.length;
      }
      index = entries.length - 1;
      return item;
    },
    /* The next number for a source, so labels read "Flow plot 1, 2, ...". */
    count(source) {
      counts[source] = (counts[source] || 0) + 1;
      return counts[source];
    },
    current: () => index >= 0 ? entries[index] : null,
    position: () => index,
    size: () => entries.length,
    back() { if (index > 0) { index--; return true; } return false; },
    forward() { if (index < entries.length - 1) { index++; return true; } return false; },
    select(position) {
      if (!Number.isInteger(position) || position < 0 || position >= entries.length) return false;
      index = position;
      return true;
    },
    remove() {
      if (index < 0) return false;
      total -= entries.splice(index, 1)[0].data.length;
      index = Math.min(index, entries.length - 1);
      return true;
    },
    clear() { entries.length = 0; index = -1; total = 0; },
    entries: () => entries.slice()
  };
}

function create(doc, host, options = {}) {
  const history = createHistory(options.limit || LIMIT);
  const urls = options.urls || (typeof URL !== "undefined" ? URL : null);
  let zoom = null;          // null fits the pane width
  let blobUrl = "";
  const h = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  function button(id, text, label, run) {
    const node = h("button", "plot-btn", text);
    node.type = "button";
    node.id = id;
    node.title = label;
    node.setAttribute("aria-label", label);
    node.addEventListener("click", () => void run());
    return node;
  }

  const pane = h("div", "plot-pane");
  const bar = h("div", "plot-bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Plot history");
  const back = button("plotBack", "‹", "Previous plot", () => go(-1));
  const position = h("span", "plot-position");
  position.id = "plotPosition";
  position.setAttribute("aria-live", "polite");
  const forward = button("plotForward", "›", "Next plot", () => go(1));
  const zoomOut = button("plotZoomOut", "−", "Zoom out", () => zoomBy(-1));
  const zoomFit = button("plotZoomFit", "Fit", "Fit the plot to the pane", () => setZoom(null));
  const zoomIn = button("plotZoomIn", "+", "Zoom in", () => zoomBy(1));
  const exportPng = button("plotExportPng", "PNG", "Save this plot as PNG", () => save("png"));
  const exportSvg = button("plotExportSvg", "SVG", "Save this plot as SVG", () => save("svg"));
  const removeOne = button("plotRemove", "Remove", "Remove this plot from the history", () => { history.remove(); render(); });
  const clearAll = button("plotClear", "Clear", "Clear the plot history", () => { history.clear(); render(); });
  const gap = () => h("span", "plot-gap");
  bar.append(back, position, forward, gap(), zoomOut, zoomFit, zoomIn, gap(), exportPng, exportSvg, gap(), removeOne, clearAll);
  const stage = h("div", "plot-stage");
  stage.id = "plotStage";
  stage.tabIndex = 0;
  stage.setAttribute("aria-label", "Current plot. Left and right arrows step through the history.");
  stage.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1); }
    else if (event.key === "-") { event.preventDefault(); zoomBy(-1); }
    else if (event.key === "0") { event.preventDefault(); setZoom(null); }
  });
  pane.append(bar, stage);
  if (host) host.replaceChildren(pane);

  function releaseBlob() {
    if (blobUrl && urls && typeof urls.revokeObjectURL === "function") urls.revokeObjectURL(blobUrl);
    blobUrl = "";
  }
  function image() {
    return stage.querySelector("img, embed");
  }
  function applyZoom() {
    const node = image();
    zoomFit.textContent = zoom === null ? "Fit" : Math.round(zoom * 100) + "%";
    if (!node) return;
    if (zoom === null) {
      node.style.width = "";
      node.style.maxWidth = "100%";
      return;
    }
    const natural = node.naturalWidth || 640;
    node.style.maxWidth = "none";
    node.style.width = Math.round(natural * zoom) + "px";
  }
  function render() {
    releaseBlob();
    const item = history.current();
    const count = history.size();
    position.textContent = count ? (history.position() + 1) + " of " + count : "No plots";
    back.disabled = history.position() <= 0;
    forward.disabled = history.position() >= count - 1;
    for (const node of [zoomOut, zoomFit, zoomIn, exportPng, removeOne, clearAll]) node.disabled = !item;
    exportSvg.disabled = !item || item.kind !== "svg";
    exportPng.disabled = !item || item.kind === "pdf";
    if (!item) {
      stage.replaceChildren(h("p", "muted plot-empty", "No plots yet. Run plot(xs, ys) in Flow, plot() in R or matplotlib in Python."));
      return;
    }
    const figure = h("figure", "captured-figure");
    figure.dataset.kind = item.kind;
    figure.dataset.plotId = String(item.id);
    let node;
    if (item.kind === "pdf") {
      node = h("embed");
      node.type = "application/pdf";
      if (urls && typeof urls.createObjectURL === "function") {
        blobUrl = urls.createObjectURL(pdfBlob(item.data));
        node.src = blobUrl;
      }
      node.title = item.label;
      node.setAttribute("style", "width:100%;height:30rem");
    } else {
      node = h("img");
      node.src = item.kind === "svg" ? svgUrl(item.data) : "data:image/png;base64," + item.data;
      node.alt = item.label;
      node.addEventListener("load", applyZoom);
    }
    figure.append(node, h("figcaption", null, item.label));
    stage.replaceChildren(figure);
    applyZoom();
  }
  function go(step) {
    const moved = step < 0 ? history.back() : history.forward();
    if (moved) render();
    return moved;
  }
  function setZoom(level) {
    zoom = level;
    applyZoom();
  }
  function zoomBy(direction) {
    const node = image();
    let current = zoom;
    if (current === null) {
      const natural = node && node.naturalWidth;
      current = natural && node.clientWidth ? node.clientWidth / natural : 1;
    }
    setZoom(stepZoom(current, direction));
  }
  function download(href, name) {
    const link = h("a");
    link.href = href;
    link.download = name;
    link.hidden = true;
    doc.body.append(link);
    link.click();
    link.remove();
  }
  async function pngBlob(item) {
    const picture = new Image();
    picture.src = svgUrl(item.data);
    await picture.decode();
    const scale = 2;
    const width = picture.naturalWidth || 640, height = picture.naturalHeight || 400;
    const canvas = doc.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png"));
  }
  async function save(format) {
    const item = history.current();
    if (!item) return false;
    const name = fileStem(item.label) + "." + format;
    try {
      if (format === "svg") {
        if (item.kind !== "svg") return false;
        const url = urls.createObjectURL(new Blob([item.data], { type: "image/svg+xml" }));
        download(url, name);
        setTimeout(() => urls.revokeObjectURL(url), 4000);
      } else if (item.kind === "png") {
        download("data:image/png;base64," + item.data, name);
      } else if (item.kind === "svg") {
        const url = urls.createObjectURL(await pngBlob(item));
        download(url, name);
        setTimeout(() => urls.revokeObjectURL(url), 4000);
      } else {
        return false;
      }
      status("Saved " + name + ".", "ok");
      return true;
    } catch (error) {
      status("Could not save the plot: " + (error && error.message || error), "error");
      return false;
    }
  }
  function status(message, state) {
    const app = root.FlowStudioApp;
    if (app && typeof app.status === "function") app.status(message, state);
  }
  function add(entries, source) {
    const list = Array.isArray(entries) ? entries : [entries];
    const added = [];
    for (const entry of list.slice(0, LIMIT)) {
      const item = history.add(entry);
      if (item) added.push(item);
    }
    if (added.length) {
      zoom = null;
      render();
    }
    return added;
  }
  render();
  return Object.freeze({
    add,
    /* Label numbers per source: "Flow plot 3". */
    label(source, noun) { return source + " " + (noun || "plot") + " " + history.count(source); },
    back: () => go(-1),
    forward: () => go(1),
    select(position) { const ok = history.select(position); if (ok) render(); return ok; },
    zoomIn: () => zoomBy(1),
    zoomOut: () => zoomBy(-1),
    fit: () => setZoom(null),
    zoom: () => zoom,
    save,
    clear() { history.clear(); render(); },
    current: history.current,
    position: history.position,
    size: history.size,
    element: pane
  });
}

/* The pane in #plotFigures, made on first use. */
function attach(doc) {
  doc = doc || root.document;
  if (!doc || typeof doc.getElementById !== "function") return null;
  const host = doc.getElementById("plotFigures");
  if (!host) return null;
  if (!api.instance || !host.contains(api.instance.element)) api.instance = create(doc, host);
  return api.instance;
}

/* Adds figures and brings the Plots tab forward. */
function show(entries, doc) {
  const pane = attach(doc);
  if (!pane) return [];
  const added = pane.add(entries);
  const tab = (doc || root.document).getElementById("tab-plots");
  if (added.length && tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  return added;
}

const api = { LIMIT, MAX_SVG_CHARS, MAX_TOTAL_CHARS, ZOOMS, validate, stepZoom, fileStem, createHistory, create, attach, show, instance: null };
root.FlowStudioPlotPane = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.getElementById && document.getElementById("plotFigures")) {
  const start = () => { try { attach(document); } catch (_) { /* the pane is optional */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
