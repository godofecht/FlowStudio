/* Literal in-buffer find and replace. Pure operations: no filesystem or network access. */
(function (global) {
"use strict";
const MAX_QUERY = 256;
const MAX_REPLACEMENT = 10000;
const MAX_SOURCE = 2 * 1024 * 1024;
const MAX_MATCHES = 10000;
function validate(text, query) {
  if (typeof text !== "string" || text.length > MAX_SOURCE)
    throw new Error("Editor search supports buffers up to 2 MiB.");
  if (typeof query !== "string" || query.length < 1 || query.length > MAX_QUERY)
    throw new Error("Find text must be 1–256 characters.");
}
function findMatches(text, query, options = {}) {
  if (query === "") return { matches: [], truncated: false };
  validate(text, query);
  const escaped = [...query].map(ch => "\\^$.*+?()[]{}|".includes(ch) ? "\\" + ch : ch).join("");
  const regex = new RegExp(escaped, options.caseSensitive ? "gu" : "giu");
  const matches = [];
  for (const hit of text.matchAll(regex)) {
    if (matches.length === MAX_MATCHES) return { matches, truncated: true };
    matches.push({ index: hit.index, end: hit.index + hit[0].length });
  }
  return { matches, truncated: false };
}
function nextMatch(matches, start, end, backwards = false) {
  if (matches.length === 0) return null;
  if (backwards) {
    for (let i = matches.length - 1; i >= 0; i--)
      if (matches[i].end <= start) return matches[i];
    return matches[matches.length - 1];
  }
  for (const match of matches) if (match.index >= end) return match;
  return matches[0];
}
function replaceSelection(text, query, replacement, start, end, options = {}) {
  if (typeof replacement !== "string" || replacement.length > MAX_REPLACEMENT)
    throw new Error("Replacement must be at most 10,000 characters.");
  const result = findMatches(text, query, options);
  const hit = result.matches.find(match => match.index === start && match.end === end);
  if (!hit) return { value: text, replaced: false, start, end };
  return { value: text.slice(0, start) + replacement + text.slice(end),
    replaced: true, start, end: start + replacement.length };
}
function replaceAll(text, query, replacement, options = {}) {
  if (typeof replacement !== "string" || replacement.length > MAX_REPLACEMENT)
    throw new Error("Replacement must be at most 10,000 characters.");
  const result = findMatches(text, query, options);
  if (result.truncated) throw new Error("More than 10,000 matches; narrow the query before replacing.");
  let position = 0;
  const parts = [];
  for (const match of result.matches) {
    parts.push(text.slice(position, match.index), replacement);
    position = match.end;
  }
  parts.push(text.slice(position));
  return { value: parts.join(""), count: result.matches.length,
    firstIndex: result.matches.length ? result.matches[0].index : -1 };
}
const api = { findMatches, nextMatch, replaceSelection, replaceAll };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioEditorFind = api;
})(globalThis);
