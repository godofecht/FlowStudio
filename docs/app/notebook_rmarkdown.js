/* R Markdown export from FlowStudio percent-cell source. No source execution. */
(function (global) {
"use strict";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_CELL_BYTES = 65536;
const MAX_CELLS = 256;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TICK = String.fromCharCode(96);
const encoder = new TextEncoder();
function byteLength(value) { return encoder.encode(value).length; }
function fenceFor(code) {
  let run = 0, longest = 0;
  for (const char of code) {
    if (char === TICK) { run++; if (run > longest) longest = run; }
    else run = 0;
  }
  return TICK.repeat(Math.max(3, longest + 1));
}
function preservedFrontmatter(body) {
  if (!body.startsWith("---\n")) return null;
  const lines = body.split("\n");
  // A Markdown thematic break is not YAML metadata.
  if (!/^[A-Za-z][A-Za-z0-9_-]*:/.test(lines[1] || "")) return null;
  const end = lines.indexOf("---", 1);
  if (end < 0 || end > 64)
    throw new Error("R Markdown YAML header is not terminated within 64 lines.");
  const seen = new Set();
  for (let i = 1; i < end; i++) {
    if (!lines[i].trim()) continue;
    const match = /^(title|author|date|output):[ \t]*(.+)$/i.exec(lines[i]);
    if (!match || seen.has(match[1].toLowerCase()))
      throw new Error("Unsupported R Markdown YAML metadata.");
    seen.add(match[1].toLowerCase());
    if (match[1].toLowerCase() === "output" &&
        !/^(?:html_document|"html_document"|'html_document')$/.test(match[2].trim()))
      throw new Error("Only R Markdown html_document output is supported.");
  }
  return {header:lines.slice(0, end + 1).join("\n") + "\n\n",
    remainder:lines.slice(end + 1).join("\n").replace(/^\n/, "")};
}
function encode(source, defaultLanguage, parseCells) {
  if (defaultLanguage !== "r" && defaultLanguage !== "python")
    throw new Error("R Markdown export requires an R or Python default language; Flow chunks are unsupported.");
  if (typeof source !== "string" || byteLength(source) > MAX_SOURCE_BYTES || source.includes("\0"))
    throw new Error("R Markdown source must be text of at most 2 MiB without NUL bytes.");
  if (typeof parseCells !== "function")
    throw new TypeError("A source-cell parser is required for R Markdown export.");
  const cells = source ? parseCells(source) : [];
  if (!Array.isArray(cells) || cells.length > MAX_CELLS)
    throw new Error("R Markdown export supports at most 256 cells.");
  let output = "---\ntitle: \"FlowStudio notebook\"\noutput: html_document\n---\n\n";
  const chunkLabels = new Set();
  for (const [index, cell] of cells.entries()) {
    if (!cell || (cell.kind !== "code" && cell.kind !== "markdown") ||
        typeof cell.code !== "string")
      throw new Error("Invalid source cell in R Markdown export.");
    let body = cell.code.replace(/\r\n?/g, "\n");
    if (byteLength(body) > MAX_CELL_BYTES || body.includes("\0"))
      throw new Error("R Markdown cells must be at most 64 KiB without NUL bytes.");
    if (cell.kind === "markdown") {
      const metadata = index === 0 ? preservedFrontmatter(body) : null;
      if (metadata) {
        output = metadata.header;
        body = metadata.remainder;
      }
      if (body.trim()) output += body + (body.endsWith("\n") ? "" : "\n") + "\n";
    } else {
      const language = cell.language || defaultLanguage;
      if (language !== "r" && language !== "python")
        throw new Error("R Markdown cannot execute Flow cells; export .fsnb or HTML instead.");
      const label = cell.label || "";
      if (label && !/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(label))
        throw new Error("Invalid R Markdown chunk label.");
      // Never silently discard malformed label metadata on export.
      const marker = source.slice(cell.start, cell.codeStart);
      if (/\blabel\s*=/.test(marker) && !label)
        throw new Error("Invalid R Markdown chunk label in source marker.");
      if (label && chunkLabels.has(label))
        throw new Error("Duplicate R Markdown chunk label: " + label);
      if (label) chunkLabels.add(label);
      const fence = fenceFor(body);
      output += fence + "{" + language + (label ? " " + label : "") + "}\n" +
        body + (body.endsWith("\n") || !body ? "" : "\n") + fence + "\n\n";
    }
    if (byteLength(output) > MAX_OUTPUT_BYTES)
      throw new Error("R Markdown output exceeds 4 MiB.");
  }
  return output;
}
const api = Object.freeze({encode, MAX_SOURCE_BYTES, MAX_CELL_BYTES, MAX_CELLS});
global.FlowStudioRMarkdown = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
