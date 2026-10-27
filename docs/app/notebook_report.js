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
  // Deliberately inert Markdown subset for offline notebook reports.
  // Raw HTML and link/image URLs are never interpreted.
  const blocks = [];
  let paragraph = [], list = [], listTag = null, quote = [];
  let fence = null, code = [];
  function inline(source) {
    // Single-pass, inert emphasis parsing. Code spans and backslash escapes
    // become opaque tokens before any formatting delimiters are considered.
    const tokens = [], open = [];
    const special = /[\\`*_~]/;
    const word = value => !!value && /[\p{L}\p{N}_]/u.test(value);
    const tags = {"**":"strong", "__":"strong", "*":"em", "_":"em", "~~":"del"};
    for (let i = 0; i < source.length;) {
      if (source[i] === "\\" && /[\\`*_~]/.test(source[i + 1] || "")) {
        tokens.push(escapeHTML(source[i + 1])); i += 2; continue;
      }
      if (source[i] === "`") {
        let end = i + 1;
        while (source[end] === "`") end++;
        const delimiter = source.slice(i, end);
        let close = source.indexOf(delimiter, end);
        while (close !== -1 &&
               (source[close - 1] === "`" || source[close + delimiter.length] === "`" ||
                source[close - 1] === "\\")) {
          close = source.indexOf(delimiter, close + delimiter.length);
        }
        if (close !== -1) {
          tokens.push("<code>" + escapeHTML(source.slice(end, close)) + "</code>");
          i = close + delimiter.length;
        } else {
          tokens.push(escapeHTML(delimiter)); i = end;
        }
        continue;
      }
      const mark = ["**", "__", "~~", "*", "_"].find(value => source.startsWith(value, i));
      if (mark) {
        const before = source[i - 1] || "", after = source[i + mark.length] || "";
        const mayOpen = !!after && !/\s/.test(after) && (mark[0] !== "_" || !word(before));
        const mayClose = !!before && !/\s/.test(before) && (mark[0] !== "_" || !word(after));
        const top = open[open.length - 1];
        const index = tokens.length;
        if (mayClose && top && top.mark === mark && index > top.index + 1) {
          tokens[top.index] = "<" + tags[mark] + ">";
          tokens.push("</" + tags[mark] + ">");
          open.pop();
        } else {
          tokens.push(escapeHTML(mark));
          if (mayOpen) open.push({mark, index});
        }
        i += mark.length;
        continue;
      }
      let end = i + 1;
      while (end < source.length && !special.test(source[end])) end++;
      tokens.push(escapeHTML(source.slice(i, end)));
      i = end;
    }
    return tokens.join("");
  }
  function flushParagraph() {
    if (paragraph.length) blocks.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
    paragraph = [];
  }
  function flushList() {
    if (list.length) blocks.push("<" + listTag + ">" +
      list.map(item => "<li>" + inline(item) + "</li>").join("") +
      "</" + listTag + ">");
    list = []; listTag = null;
  }
  function flushQuote() {
    if (quote.length) blocks.push("<blockquote><p>" + quote.map(inline).join("<br>") +
      "</p></blockquote>");
    quote = [];
  }
  function flush() { flushParagraph(); flushList(); flushQuote(); }
  function flushFence() {
    const language = fence.language;
    blocks.push("<pre><code" + (language ? ' class="language-' + language + '"' : "") +
      ">" + escapeHTML(code.join("\n")) + "</code></pre>");
    fence = null; code = [];
  }
  // Inert pipe tables: only fixed alignment classes and escaped cell text.
  // Pipes inside inline code spans or escaped as \| do not split cells.
  function tableCells(line) {
    let input = line.trim(), cell = "", codeTicks = 0, separated = false;
    if (!input.includes("|")) return null;
    if (input.startsWith("|")) input = input.slice(1);
    if (input.endsWith("|") && !input.endsWith("\\|")) input = input.slice(0, -1);
    const cells = [];
    for (let i = 0; i < input.length; i++) {
      if (input[i] === "\\" && input[i + 1] === "|") {
        cell += "|"; i++; continue;
      }
      if (input[i] === "\`") {
        let end = i + 1;
        while (input[end] === "\`") end++;
        const count = end - i;
        if (!codeTicks) codeTicks = count;
        else if (codeTicks === count) codeTicks = 0;
        cell += input.slice(i, end);
        i = end - 1;
      } else if (input[i] === "|" && !codeTicks) {
        cells.push(cell.trim()); cell = ""; separated = true;
      } else cell += input[i];
    }
    cells.push(cell.trim());
    return separated || line.trim().startsWith("|") ? cells : null;
  }
  function tableAt(lines, index) {
    if (index + 1 >= lines.length) return null;
    const headings = tableCells(lines[index]);
    const rules = tableCells(lines[index + 1]);
    if (!headings || !rules || headings.length !== rules.length ||
        headings.length < 1 || headings.length > 16 ||
        !rules.every(rule => /^:?-{3,}:?$/.test(rule))) return null;
    const alignment = rules.map(rule => rule.startsWith(":") && rule.endsWith(":") ?
      "center" : rule.endsWith(":") ? "right" : rule.startsWith(":") ? "left" : "");
    const renderCell = (tag, value, column) => "<" + tag +
      (alignment[column] ? ' class="align-' + alignment[column] + '"' : "") +
      ">" + inline(value) + "</" + tag + ">";
    const head = "<thead><tr>" + headings.map((value, column) =>
      renderCell("th", value, column)).join("") + "</tr></thead>";
    const rows = [];
    let next = index + 2;
    while (next < lines.length && rows.length < 128) {
      const cells = tableCells(lines[next]);
      if (!cells || cells.length > headings.length) break;
      rows.push("<tr>" + headings.map((_, column) =>
        renderCell("td", cells[column] || "", column)).join("") + "</tr>");
      next++;
    }
    return {html:"<table>" + head + "<tbody>" + rows.join("") +
      "</tbody></table>", next};
  }
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const closing = /^ {0,3}(\`+|~+)[ \t]*$/.exec(line);
      if (closing && closing[1][0] === fence.character &&
          closing[1].length >= fence.length) flushFence();
      else code.push(line);
      continue;
    }
    const table = tableAt(lines, index);
    if (table) {
      flush(); blocks.push(table.html); index = table.next - 1;
      continue;
    }
    const opening = /^ {0,3}(\`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && (opening[1][0] === "~" || !opening[2].includes("\`"))) {
      flush();
      const info = opening[2].trim();
      fence = { character: opening[1][0], length: opening[1].length,
        language: /^[A-Za-z0-9_+.-]{1,32}$/.test(info) ? info : "" };
      code = [];
      continue;
    }
    const heading = /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
    const item = /^ {0,3}(?:([-*+])|(\d{1,9}[.)]))\s+(.+)$/.exec(line);
    const quoted = /^ {0,3}>\s?(.*)$/.exec(line);
    if (heading) {
      flush();
      const n = heading[1].length;
      blocks.push("<h" + n + ">" + inline(heading[2]) + "</h" + n + ">");
    } else if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) {
      flush(); blocks.push("<hr>");
    } else if (item) {
      flushParagraph(); flushQuote();
      const tag = item[2] ? "ol" : "ul";
      if (listTag && listTag !== tag) flushList();
      listTag = tag;
      list.push(item[3]);
    } else if (quoted) {
      flushParagraph(); flushList();
      quote.push(quoted[1]);
    } else if (!line.trim()) {
      flush();
    } else {
      flushList(); flushQuote();
      paragraph.push(line);
    }
  }
  if (fence) flushFence();
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
        else if (output.data?.["text/markdown"] !== undefined) {
          const value = text(output.data["text/markdown"]);
          if (encoder.encode(value).length > 131072) throw Error("Output exceeds 128 KiB.");
          section += '<div class="markdown-output">' + markdown(value) + '</div>';
        }
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
    "table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}" +
    "th,td{border:1px solid #d7dce4;padding:.35rem .65rem;text-align:left}" +
    ".align-right{text-align:right}.align-center{text-align:center}" +
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
      // Preserve validated Jupyter display MIME types in offline reports.
      // A portable v2 bundle cannot smuggle active HTML or modified records:
      // decodeBundle and safeJupyterOutputs both enforce the snapshot.
      if (result.jupyterOutputs !== undefined) {
        const preserved = format.safeJupyterOutputs?.(result.jupyterOutputs, result);
        if (!preserved) throw Error("Saved Jupyter output records no longer match the displayed snapshot.");
        outputs.push(...preserved);
      } else {
        if (result.output) outputs.push({output_type:"stream",
          name:result.ok ? "stdout" : "stderr", text:result.output});
        if (result.truncated) outputs.push({output_type:"stream", name:"stderr",
          text:"[FlowStudio output was truncated]"});
        for (const plot of result.plots)
          outputs.push({output_type:"display_data", metadata:{}, data:{"image/png":plot.png}});
      }
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
