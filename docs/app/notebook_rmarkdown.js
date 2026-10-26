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
  for (const cell of cells) {
    if (!cell || (cell.kind !== "code" && cell.kind !== "markdown") ||
        typeof cell.code !== "string")
      throw new Error("Invalid source cell in R Markdown export.");
    const body = cell.code.replace(/\r\n?/g, "\n");
    if (byteLength(body) > MAX_CELL_BYTES || body.includes("\0"))
      throw new Error("R Markdown cells must be at most 64 KiB without NUL bytes.");
    if (cell.kind === "markdown") {
      output += body + (body.endsWith("\n") || !body ? "" : "\n") + "\n";
    } else {
      const language = cell.language || defaultLanguage;
      if (language !== "r" && language !== "python")
        throw new Error("R Markdown cannot execute Flow cells; export .fsnb or HTML instead.");
      const fence = fenceFor(body);
      output += fence + "{" + language + "}\n" +
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
