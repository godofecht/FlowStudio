/* Strict, non-executing R Markdown import into FlowStudio percent cells. */
(function (global) {
"use strict";
function utf8Bytes(value) {
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    count += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return count;
}
function decode(input, parseCells) {
  const MAX_INPUT = 4 * 1024 * 1024;
  const MAX_SOURCE = 2 * 1024 * 1024;
  const MAX_CELL = 65536;
  const MAX_CELLS = 256;
  if (typeof input !== "string" || utf8Bytes(input) > MAX_INPUT || input.includes("\0"))
    throw new Error("R Markdown input must be text of at most 4 MiB without NUL bytes.");
  if (typeof parseCells !== "function")
    throw new TypeError("A source-cell parser is required for R Markdown import.");
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  let metadataDiscarded = false;
  if (lines[0] === "---") {
    let end = -1;
    for (let i = 1; i < Math.min(lines.length, 66); i++) {
      if (lines[i] === "---") { end = i; break; }
    }
    if (end < 0) throw new Error("R Markdown YAML header is not terminated within 64 lines.");
    const seen = new Set();
    for (let i = 1; i < end; i++) {
      if (!lines[i].trim()) continue;
      const match = /^(title|author|date|output):[ \t]*(.+)$/i.exec(lines[i]);
      if (!match || seen.has(match[1].toLowerCase()))
        throw new Error("Unsupported R Markdown YAML metadata; only scalar title, author, date and output are accepted.");
      seen.add(match[1].toLowerCase());
      if (match[1].toLowerCase() === "output" &&
          !/^(?:html_document|"html_document"|'html_document')$/.test(match[2].trim()))
        throw new Error("Only R Markdown html_document output is supported.");
    }
    index = end + 1;
    metadataDiscarded = true;
  }
  const chunks = [];
  let markdown = "";
  function append(kind, body, language) {
    if (utf8Bytes(body) > MAX_CELL)
      throw new Error("R Markdown cells must be at most 64 KiB.");
    if (/^[ \t]*#[ \t]*%%(?:[ \t]|$)/m.test(body))
      throw new Error("R Markdown contains a percent-cell marker that cannot be imported without changing source.");
    if (chunks.length >= MAX_CELLS)
      throw new Error("R Markdown import supports at most 256 cells.");
    chunks.push({kind, body, language});
  }
  function flushMarkdown() {
    if (markdown.trim()) append("markdown", markdown, null);
    markdown = "";
  }
  function closingFence(start, opener) {
    const symbol = opener[0];
    for (let i = start + 1; i < lines.length; i++) {
      const candidate = lines[i].trim();
      if (candidate.length >= opener.length &&
          candidate.split("").every(character => character === symbol)) return i;
    }
    return -1;
  }
  while (index < lines.length) {
    const line = lines[index];
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const info = fence[2].trim();
      const end = closingFence(index, fence[1]);
      if (info.startsWith("{")) {
        // Only constant eval=TRUE/FALSE is safe to translate: arbitrary knitr
        // options are R expressions and cannot be silently discarded.
        const header = /^\{(r|python)(?:\s*,\s*eval\s*=\s*(TRUE|FALSE))?\}$/.exec(info);
        if (!header)
          throw new Error("Unsupported R Markdown chunk engine or options; only {r}, {python} and literal eval=TRUE/FALSE are accepted.");
        if (end < 0) throw new Error("Unterminated R Markdown executable chunk.");
        flushMarkdown();
        const body = lines.slice(index + 1, end).join("\n") + (end > index + 1 ? "\n" : "");
        if (header[2] === "FALSE") {
          // Keep the original disabled knitr chunk intact as inert Markdown.
          // It stays non-executable in FlowStudio and remains eval=FALSE
          // if the notebook is exported back to R Markdown.
          append("markdown", lines.slice(index, end + 1).join("\n") + "\n", null);
        } else {
          append("code", body, header[1]);
        }
        index = end + 1;
        continue;
      }
      const last = end < 0 ? lines.length - 1 : end;
      for (let i = index; i <= last; i++)
        markdown += lines[i] + (i < lines.length - 1 ? "\n" : "");
      index = last + 1;
      continue;
    }
    markdown += line + (index < lines.length - 1 ? "\n" : "");
    index++;
  }
  flushMarkdown();
  if (!chunks.length) throw new Error("R Markdown has no supported Markdown or executable cells.");
  let source = "";
  for (const chunk of chunks) {
    source += "# %% " + (chunk.kind === "markdown" ? "[markdown]" : "[" + chunk.language + "]") + "\n";
    source += chunk.body;
    if (chunk.body && !chunk.body.endsWith("\n")) source += "\n";
    if (utf8Bytes(source) > MAX_SOURCE)
      throw new Error("Imported R Markdown exceeds the 2 MiB editor limit.");
  }
  const parsed = parseCells(source);
  if (!Array.isArray(parsed) || parsed.length !== chunks.length ||
      parsed.some((cell, i) => cell.kind !== chunks[i].kind ||
        (cell.kind === "code" && cell.language !== chunks[i].language)))
    throw new Error("R Markdown cannot be represented safely as FlowStudio source cells.");
  const firstCode = chunks.find(chunk => chunk.kind === "code");
  return {source, language:firstCode ? firstCode.language : "r", metadataDiscarded};
}
const api = Object.freeze({decode});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioRMarkdownImport = api;
})(globalThis);
