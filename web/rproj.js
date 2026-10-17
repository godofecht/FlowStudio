/* Browser-local .Rproj metadata support. No R code is evaluated. */
(function (global) {
"use strict";
const MAX_BYTES = 256 * 1024;
const OPTIONS = Object.freeze({
  RestoreWorkspace: ["Default", "Yes", "No"],
  SaveWorkspace: ["Default", "Yes", "No"],
  AlwaysSaveHistory: ["Default", "Yes", "No"],
  EnableCodeIndexing: ["Yes", "No"],
  UseSpacesForTab: ["Yes", "No"],
  NumSpacesForTab: "indent",
  Encoding: "encoding",
  RnwWeave: ["Sweave", "knitr"],
  LaTeX: ["pdfLaTeX", "XeLaTeX", "LuaLaTeX"]
});
const KEY = /^([A-Za-z][A-Za-z0-9]*)([ \t]*:[ \t]*)([^\r\n]*)$/;
function parse(source) {
  if (typeof source !== "string") throw new TypeError("Project metadata must be text");
  if (new Blob([source]).size > MAX_BYTES || source.includes("\0"))
    throw new RangeError("Invalid or oversized .Rproj file");
  if (/(^|[^\r])\r(?!\n)/.test(source)) throw new Error("Unsupported bare-CR line ending");
  const bom = source.startsWith("\ufeff");
  const body = bom ? source.slice(1) : source;
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  if (newline === "\r\n" && body.replace(/\r\n/g, "").includes("\n"))
    throw new Error("Mixed line endings are not supported");
  const lines = body.split(newline);
  const entries = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = KEY.exec(line);
    if (!match) throw new Error("Malformed .Rproj setting at line " + (i + 1));
    const key = match[1];
    if (entries.has(key)) throw new Error("Duplicate .Rproj setting: " + key);
    entries.set(key, {line: i, value: match[3].trim(), prefix: match[1] + match[2]});
  }
  return { bom, newline, lines, entries };
}
function validate(key, value) {
  if (!Object.prototype.hasOwnProperty.call(OPTIONS, key))
    throw new Error("Unsupported project setting: " + key);
  if (typeof value !== "string" || value.length > 80 || /[\r\n\0]/.test(value))
    throw new Error("Invalid project setting value");
  const kind = OPTIONS[key];
  if (Array.isArray(kind) && !kind.includes(value)) throw new Error("Invalid value for " + key);
  if (kind === "indent" && (!/^[1-9][0-9]?$/.test(value) || Number(value) > 16))
    throw new Error("Indent width must be 1–16");
  if (kind === "encoding" && !/^[A-Za-z0-9._-]{1,40}$/.test(value))
    throw new Error("Invalid encoding name");
}
function read(source) {
  const parsed = parse(source), settings = {};
  for (const key of Object.keys(OPTIONS)) {
    const entry = parsed.entries.get(key);
    if (entry) settings[key] = entry.value;
  }
  return settings;
}
function update(source, changes) {
  const parsed = parse(source);
  if (!changes || typeof changes !== "object" || Array.isArray(changes))
    throw new TypeError("Expected settings object");
  const keys = Object.keys(changes);
  for (const key of keys) validate(key, changes[key]);
  const lines = parsed.lines.slice();
  const appended = [];
  for (const key of keys) {
    const entry = parsed.entries.get(key);
    if (entry) {
      const original = lines[entry.line];
      const suffix = /[ \t]*$/.exec(original)[0];
      lines[entry.line] = entry.prefix + changes[key] + suffix;
    } else {
      appended.push(key + ": " + changes[key]);
    }
  }
  if (appended.length) {
    if (lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, ...appended);
    else lines.push(...appended);
  }
  const result = (parsed.bom ? "\ufeff" : "") + lines.join(parsed.newline);
  if (new Blob([result]).size > MAX_BYTES) throw new RangeError("Updated .Rproj file too large");
  return result;
}
const api = Object.freeze({MAX_BYTES, OPTIONS, parse, read, update});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioRproj = api;
})(globalThis);
