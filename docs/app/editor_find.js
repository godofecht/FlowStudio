/* Bounded in-buffer literal/regex find and replace. No filesystem or network. */
(function (global) {
"use strict";
const MAX_QUERY = 256;
const MAX_REPLACEMENT = 10000;
const MAX_SOURCE = 2 * 1024 * 1024;
const MAX_REGEX_SOURCE = 128 * 1024;
const MAX_MATCHES = 10000;
function validate(text, query, options = {}) {
  if (typeof text !== "string" || text.length > MAX_SOURCE)
    throw new Error("Editor search supports buffers up to 2 MiB.");
  if (typeof query !== "string" || query.length < 1 || query.length > MAX_QUERY)
    throw new Error("Find text must be 1–256 characters.");
  if (options.regex && text.length > MAX_REGEX_SOURCE)
    throw new Error("Regex search is limited to 128 KiB buffers; use literal search for larger files.");
}
function compile(query, options = {}) {
  const escaped = [...query].map(ch => "\\^$.*+?()[]{}|".includes(ch) ? "\\" + ch : ch).join("");
  const body = options.regex ? query : escaped;
  const pattern = options.wholeWord
    ? "(?<![\\p{L}\\p{N}_])(?:" + body + ")(?![\\p{L}\\p{N}_])" : body;
  try {
    return new RegExp(pattern, options.regex ? (options.caseSensitive ? "gmu" : "gimu") : (options.caseSensitive ? "gu" : "giu"));
  } catch (error) {
    throw new Error("Invalid regular expression: " + error.message);
  }
}
function findMatches(text, query, options = {}) {
  if (query === "") return { matches: [], truncated: false };
  validate(text, query, options);
  const regex = compile(query, options);
  const matches = [];
  for (const hit of text.matchAll(regex)) {
    if (matches.length === MAX_MATCHES) return { matches, truncated: true };
    const match = { index: hit.index, end: hit.index + hit[0].length };
    if (options.regex) {
      match.text = hit[0];
      match.captures = hit.slice(1);
      match.groups = hit.groups || null;
    }
    matches.push(match);
  }
  return { matches, truncated: false };
}
function nextMatch(matches, start, end, backwards = false) {
  if (matches.length === 0) return null;
  if (backwards) {
    for (let i = matches.length - 1; i >= 0; i--)
      if (matches[i].end <= start && (matches[i].index !== start || matches[i].end !== start))
        return matches[i];
    return matches[matches.length - 1];
  }
  for (const match of matches)
    if (match.index >= end && (match.index !== end || match.end !== end || start !== end))
      return match;
  return matches[0];
}
function expand(template, hit) {
  if (!hit.captures) return template;
  return template.replace(/\$(\$|&|<[^>]+>|[0-9]{1,2})/g, (token, key) => {
    if (key === "$") return "$";
    if (key === "&") return hit.text;
    if (key[0] === "<") {
      if (!hit.groups) return token;
      const name = key.slice(1, -1);
      return Object.hasOwn(hit.groups, name) ? (hit.groups[name] ?? "") : token;
    }
    const number = Number(key);
    if (number > 0 && number <= hit.captures.length)
      return hit.captures[number - 1] ?? "";
    if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) <= hit.captures.length)
      return (hit.captures[Number(key[0]) - 1] ?? "") + key[1];
    return token;
  });
}
function replacementText(replacement, hit, options) {
  return options.regex ? expand(replacement, hit) : replacement;
}
function validateReplacement(replacement) {
  if (typeof replacement !== "string" || replacement.length > MAX_REPLACEMENT)
    throw new Error("Replacement must be at most 10,000 characters.");
}
function replaceSelection(text, query, replacement, start, end, options = {}) {
  validateReplacement(replacement);
  const result = findMatches(text, query, options);
  if (result.truncated) throw new Error("More than 10,000 matches; narrow the query before replacing.");
  const hit = result.matches.find(match => match.index === start && match.end === end);
  if (!hit) return { value: text, replaced: false, start, end };
  const inserted = replacementText(replacement, hit, options);
  if (text.length - (end - start) + inserted.length > MAX_SOURCE)
    throw new Error("Replacement exceeds the 2 MiB editor limit.");
  return { value: text.slice(0, start) + inserted + text.slice(end),
    replaced: true, start, end: start + inserted.length };
}
function replaceAll(text, query, replacement, options = {}) {
  validateReplacement(replacement);
  const result = findMatches(text, query, options);
  if (result.truncated) throw new Error("More than 10,000 matches; narrow the query before replacing.");
  let position = 0, size = 0;
  const parts = [];
  for (const match of result.matches) {
    const before = text.slice(position, match.index);
    const inserted = replacementText(replacement, match, options);
    size += before.length + inserted.length;
    if (size > MAX_SOURCE) throw new Error("Replacement exceeds the 2 MiB editor limit.");
    parts.push(before, inserted);
    position = match.end;
  }
  const tail = text.slice(position);
  if (size + tail.length > MAX_SOURCE) throw new Error("Replacement exceeds the 2 MiB editor limit.");
  parts.push(tail);
  return { value: parts.join(""), count: result.matches.length,
    firstIndex: result.matches.length ? result.matches[0].index : -1 };
}
const api = { findMatches, nextMatch, replaceSelection, replaceAll };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioEditorFind = api;
})(globalThis);
