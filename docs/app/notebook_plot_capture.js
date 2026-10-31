/* Bounded, inert PNG snapshots of actual browser R bitmaps and native R SVG plots.
 * Notebook persistence stores PNG, never executable SVG or interpreter objects.
 */
(function (global) {
"use strict";
// Match .fsnb's per-plot limit so a captured image is always exportable.
const MAX_PNG = 524288;
const MAX_SVG_BYTES = 60000;
const MAX_DIMENSION = 2048;
const MAX_PIXELS = 2048 * 2048;
function dimensions(width, height) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width > 0 && height > 0 && width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION && width * height <= MAX_PIXELS;
}
function pngFromCanvas(canvas) {
  try {
    const data = canvas.toDataURL("image/png");
    if (typeof data !== "string" || !data.startsWith("data:image/png;base64,")) return null;
    const png = data.slice("data:image/png;base64,".length);
    return png.length <= MAX_PNG && /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png) ?
      {png} : null;
  } catch (_) { return null; }
}
function draw(image, width, height, document) {
  if (!dimensions(width, height) || !document?.createElement) return null;
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0);
    return pngFromCanvas(canvas);
  } catch (_) { return null; }
  finally { canvas.width = 0; canvas.height = 0; }
}
function bitmapsToPng(images, document = global.document) {
  if (!Array.isArray(images)) return [];
  const plots = [];
  for (const image of images.slice(0, 8)) {
    const plot = image && draw(image, image.width, image.height, document);
    if (plot) plots.push(plot);
  }
  return plots;
}
async function svgToPng(svg, environment = global) {
  if (typeof svg !== "string" || new TextEncoder().encode(svg).length > MAX_SVG_BYTES ||
      !/<svg(?:\s|>)/.test(svg) || !/<\/svg\s*>/.test(svg) ||
      typeof environment.Image !== "function" ||
      typeof environment.URL?.createObjectURL !== "function" ||
      typeof environment.URL?.revokeObjectURL !== "function") return null;
  const url = environment.URL.createObjectURL(
    new Blob([svg], {type:"image/svg+xml;charset=utf-8"}));
  return new Promise(resolve => {
    const image = new environment.Image();
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      environment.URL.revokeObjectURL(url);
      resolve(result);
    };
    const timeout = setTimeout(() => finish(null), 5000);
    image.onload = () => finish(draw(image, image.naturalWidth, image.naturalHeight,
      environment.document));
    image.onerror = () => finish(null);
    try { image.src = url; }
    catch (_) { finish(null); }
  });
}
const api = Object.freeze({bitmapsToPng, svgToPng});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookPlotCapture = api;
})(globalThis);
