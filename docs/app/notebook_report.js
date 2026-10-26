/* Offline HTML export for Python/R notebook source, outputs and PNG plots. */
(function (global) {
"use strict";
const encoder = new TextEncoder();
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function text(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(x => typeof x === "string")) return value.join("");
  throw Error("Invalid notebook text.");
}
function markdown(value) {
  const blocks = [];
  let paragraph = [], list = [];
  function flush() {
    if (paragraph.length) blocks.push("<p>" + paragraph.map(escapeHTML).join("<br>") + "</p>");
    if (list.length) blocks.push("<ul>" + list.map(x => "<li>" + escapeHTML(x) + "</li>").join("") + "</ul>");
    paragraph = []; list = [];
  }
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    const item = /^\s{0,3}[-*+]\s+(.+)$/.exec(line);
    if (heading) {
      flush(); const n = heading[1].length;
      blocks.push("<h" + n + ">" + escapeHTML(heading[2]) + "</h" + n + ">");
    } else if (item) {
      if (paragraph.length) flush();
      list.push(item[1]);
    } else if (!line.trim()) flush();
    else { if (list.length) flush(); paragraph.push(line); }
  }
  flush();
  return blocks.join("\n");
}
function render(json, title = "FlowStudio notebook report") {
  if (typeof json !== "string" || encoder.encode(json).length > 4194304)
    throw Error("Notebook exceeds 4 MiB.");
  let nb;
  try { nb = JSON.parse(json); } catch (_) { throw Error("Invalid notebook JSON."); }
  if (!nb || nb.nbformat !== 4 || !Array.isArray(nb.cells) || nb.cells.length > 256)
    throw Error("Expected nbformat 4 with at most 256 cells.");
  if (typeof title !== "string" || title.length > 256) throw Error("Invalid report title.");
  const sections = [];
  for (const [i, cell] of nb.cells.entries()) {
    if (!cell || !["code","markdown"].includes(cell.cell_type))
      throw Error("Unsupported notebook cell.");
    const source = text(cell.source);
    if (encoder.encode(source).length > 65536) throw Error("Cell exceeds 64 KiB.");
    if (cell.cell_type === "markdown") {
      sections.push('<section class="markdown">' + markdown(source) + "</section>");
      continue;
    }
    const cellLanguage = cell.metadata?.flowstudio?.language;
    const languageLabel = ["flow", "python", "r"].includes(cellLanguage) ?
      " (" + (cellLanguage === "r" ? "R" : cellLanguage === "flow" ? "Flow" : "Python") + ")" : "";
    let section = '<section class="cell"><h2>Cell ' + (i + 1) + languageLabel +
      '</h2><pre class="source"><code>' + escapeHTML(source) + "</code></pre>";
    const outputs = cell.outputs || [];
    if (!Array.isArray(outputs) || outputs.length > 32) throw Error("Invalid notebook outputs.");
    for (const output of outputs) {
      if (!output || typeof output !== "object") throw Error("Invalid notebook output.");
      if (output.output_type === "stream") {
        const value = text(output.text);
        if (encoder.encode(value).length > 131072) throw Error("Output exceeds 128 KiB.");
        section += '<pre class="' + (output.name === "stderr" ? "stderr" : "stdout") +
          '">' + escapeHTML(value) + "</pre>";
      } else if (output.output_type === "display_data" || output.output_type === "execute_result") {
        const png = output.data?.["image/png"];
        if (typeof png === "string" && png.length <= 1398104 &&
            /^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(png))
          section += '<img alt="Plot from cell ' + (i + 1) +
            '" src="data:image/png;base64,' + png + '">';
        else if (output.data?.["text/plain"] !== undefined) {
          const value = text(output.data["text/plain"]);
          if (encoder.encode(value).length > 131072) throw Error("Output exceeds 128 KiB.");
          section += "<pre>" + escapeHTML(value) + "</pre>";
        }
      } else if (output.output_type === "error") {
        const value = Array.isArray(output.traceback) ? output.traceback.join("\n") : String(output.evalue || "");
        if (encoder.encode(value).length > 131072) throw Error("Traceback exceeds 128 KiB.");
        section += '<pre class="stderr">' + escapeHTML(value) + "</pre>";
      }
    }
    sections.push(section + "</section>");
  }
  const safeTitle = escapeHTML(title);
  const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
    "<title>" + safeTitle + "</title><style>" +
    "body{font:16px/1.6 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#202633}" +
    "pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem;background:#f1f3f6;border-radius:5px}" +
    "pre.stderr{background:#fff0ee;color:#912a24}img{max-width:100%;height:auto}" +
    "section{margin:1.5rem 0;border-bottom:1px solid #d7dce4;padding-bottom:1rem}" +
    "h1,h2,h3{line-height:1.25}code{font-family:ui-monospace,monospace}" +
    "</style></head><body><main><h1>" + safeTitle + "</h1>" +
    sections.join("\n") + "</main></body></html>\n";
  if (encoder.encode(html).length > 7340032) throw Error("HTML report exceeds 7 MiB.");
  return html;
}

/* Portable .fsnb reports preserve each cell's actual runtime. This is an
 * offline display export, not a claim of multi-kernel Jupyter execution. */
function renderBundle(json, format, parseCells, title = "FlowStudio notebook report") {
  if (!format || typeof format.decodeBundle !== "function" || typeof parseCells !== "function")
    throw TypeError("FlowStudio notebook decoder and source-cell parser are required.");
  const imported = format.decodeBundle(json, parseCells);
  const entries = new Map(imported.entries.map(entry => [entry.index, entry]));
  const cells = parseCells(imported.source).map(cell => {
    if (cell.kind === "markdown")
      return {cell_type:"markdown", metadata:{}, source:cell.code};
    const result = entries.get(cell.index);
    const outputs = [];
    if (result) {
      if (result.output) outputs.push({output_type:"stream",
        name:result.ok ? "stdout" : "stderr", text:result.output});
      if (result.truncated) outputs.push({output_type:"stream", name:"stderr",
        text:"[FlowStudio output was truncated]"});
      for (const plot of result.plots)
        outputs.push({output_type:"display_data", metadata:{}, data:{"image/png":plot.png}});
    }
    return {cell_type:"code", metadata:{flowstudio:{language:cell.language || imported.language}},
      source:cell.code, outputs};
  });
  return render(JSON.stringify({nbformat:4, cells}), title);
}
const api = Object.freeze({render, renderBundle, markdown});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebookReport = api;
})(globalThis);
