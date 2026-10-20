/* FlowStudio source diagnostics: bounded parsing and exact source-range mapping. */
(function (global) {
"use strict";
const MAX_OUTPUT = 1024 * 1024;
function python(output) {
  if (typeof output !== "string" || output.length > MAX_OUTPUT) return null;
  const frames = /File ["']<FlowStudio Python>["'], line ([1-9][0-9]{0,5})(?=\D|$)/g;
  let found, line = 0;
  while ((found = frames.exec(output)) !== null) line = Number(found[1]);
  return line ? { language: "python", line } : null;
}
function sourceRange(source, submitted, offset, diagnostic) {
  if (typeof source !== "string" || typeof submitted !== "string" ||
      !Number.isInteger(offset) || offset < 0 || offset > source.length ||
      !diagnostic || !Number.isInteger(diagnostic.line) || diagnostic.line < 1 ||
      source.slice(offset, offset + submitted.length) !== submitted) return null;
  let local = 0;
  for (let row = 1; row < diagnostic.line; row++) {
    const newline = submitted.indexOf("\n", local);
    if (newline < 0) return null;
    local = newline + 1;
  }
  if (local > submitted.length) return null;
  const newline = submitted.indexOf("\n", local);
  const rawEnd = newline < 0 ? submitted.length : newline;
  const end = rawEnd > local && submitted[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
  const start = offset + local;
  const absoluteLine = source.slice(0, start).split("\n").length;
  return { start, end: offset + end, line: absoluteLine };
}
const api = { python, sourceRange };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioDiagnostics = api;
})(globalThis);
