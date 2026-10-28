/* Strict Quarto .qmd interchange for R/Python percent-cell notebooks.
 * Converts only inert, supported YAML and chunks through the existing
 * R Markdown codec. Never executes notebook source or invokes Quarto.
 */
(function (global) {
"use strict";
const MAX_INPUT = 4 * 1024 * 1024;
const encoder = new TextEncoder();

function convertFrontmatter(input, toQuarto) {
  if (typeof input !== "string" || encoder.encode(input).length > MAX_INPUT ||
      input.includes("\0"))
    throw new Error("Quarto document must be text of at most 4 MiB without NUL bytes.");
  const normalized = input.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    if (toQuarto) throw new Error("R Markdown export did not produce a YAML header.");
    return normalized;
  }
  const lines = normalized.split("\n");
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 66); i++) {
    if (lines[i] === "---") { end = i; break; }
  }
  if (end < 0) throw new Error("Quarto YAML header is not terminated within 64 lines.");
  let converted = false;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (toQuarto) {
      if (/^format\s*:/i.test(line))
        throw new Error("Conflicting Quarto format metadata.");
      const match = /^output:[ \t]*(html_document|"html_document"|'html_document')[ \t]*$/.exec(line);
      if (match) {
        if (converted) throw new Error("Duplicate output metadata.");
        lines[i] = "format: html";
        converted = true;
      }
    } else {
      if (/^output\s*:/i.test(line))
        throw new Error("R Markdown output metadata is not valid Quarto format metadata.");
      const match = /^format:[ \t]*(html|"html"|'html')[ \t]*$/.exec(line);
      if (match) {
        if (converted) throw new Error("Duplicate Quarto format metadata.");
        lines[i] = "output: html_document";
        converted = true;
      } else if (/^format\s*:/i.test(line)) {
        throw new Error("Only scalar Quarto format: html is supported.");
      }
    }
  }
  if (toQuarto && !converted)
    lines.splice(end, 0, "format: html");
  return lines.join("\n");
}


/* Translate only representable leading Quarto #| options. Unsupported
 * directives fail closed rather than silently changing execution. */
function normalizeChunkOptions(input) {
  const lines = input.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const opener = /^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!opener) continue;
    const header = /^\{(r|python)(?:[ \t]+([A-Za-z][A-Za-z0-9_.-]{0,79}))?\}$/.exec(opener[2].trim());
    if (!header) continue;
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (candidate.length >= opener[1].length &&
          [...candidate].every(character => character === opener[1][0])) {
        end = j;
        break;
      }
    }
    if (end < 0) throw new Error("Unterminated Quarto executable chunk.");
    let label = header[2] || null, evalOption = null, seenCode = false, sawLabel = false;
    const body = [];
    for (let j = i + 1; j < end; j++) {
      const line = lines[j];
      if (/^[ \t]*#\|/.test(line)) {
        if (seenCode) throw new Error("Quarto #| options must precede executable code.");
        const option = /^[ \t]*#\|[ \t]*(label|eval):[ \t]*([^\r\n]*?)[ \t]*$/.exec(line);
        if (!option) throw new Error("Unsupported Quarto #| chunk option.");
        if (option[1] === "label") {
          if (sawLabel || label) throw new Error("Duplicate Quarto chunk label.");
          if (!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(option[2]))
            throw new Error("Invalid Quarto chunk label.");
          label = option[2];
          sawLabel = true;
        } else {
          if (evalOption !== null || !/^(true|false)$/.test(option[2]))
            throw new Error("Unsupported or duplicate Quarto eval option.");
          evalOption = option[2] === "true";
        }
      } else {
        if (line.trim()) seenCode = true;
        body.push(line);
      }
    }
    if (evalOption === false && header[1] !== "r")
      throw new Error("Disabled Quarto Python chunks cannot be preserved safely.");
    lines.splice(i, end - i + 1,
      opener[1] + "{" + header[1] + (label ? " " + label : "") +
      (evalOption === false ? ", eval=FALSE" : "") + "}", ...body, lines[end]);
    i += body.length + 1;
  }
  return lines.join("\n");
}

function assertRepresentable(source, parseCells) {
  if (typeof parseCells !== "function")
    throw new TypeError("A source-cell parser is required for Quarto interchange.");
  const cells = parseCells(source);
  if (!Array.isArray(cells)) throw new Error("Invalid Quarto source cells.");
  for (const cell of cells) {
    if (cell.kind === "code") {
      // Quarto #| options can change execution or inject code. They are not
      // represented by the percent-cell model and must not be discarded.
      if (/^[ \t]*#\|/m.test(cell.code))
        throw new Error("Quarto #| chunk options are unsupported; remove them explicitly.");
    } else if (cell.kind === "markdown") {
      // Quarto shortcodes and inline engines are executable/render-time
      // directives, unlike FlowStudio's inert Markdown cells.
      if (/\{\{[<%]/.test(cell.code) ||
          /\x60[ \t]*\{(?:r|python)\}[ \t]+\S/i.test(cell.code))
        throw new Error("Quarto shortcodes and inline engine expressions are unsupported.");
    }
  }
}

function decode(input, parseCells) {
  const importer = global.FlowStudioRMarkdownImport;
  if (!importer || typeof importer.decode !== "function")
    throw new Error("R Markdown importer is required for Quarto import.");
  const converted = normalizeChunkOptions(convertFrontmatter(input, false));
  const imported = importer.decode(converted, parseCells);
  assertRepresentable(imported.source, parseCells);
  return imported;
}

function encode(source, language, parseCells) {
  const exporter = global.FlowStudioRMarkdown;
  if (!exporter || typeof exporter.encode !== "function")
    throw new Error("R Markdown exporter is required for Quarto export.");
  assertRepresentable(source, parseCells);
  return convertFrontmatter(exporter.encode(source, language, parseCells), true);
}

const api = Object.freeze({encode, decode});
global.FlowStudioQuarto = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
