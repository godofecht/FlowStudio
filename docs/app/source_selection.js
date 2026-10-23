/* Pure selection extraction for browser Python execution. */
(function (global) {
"use strict";
const MAX_SOURCE_BYTES = 65536;

function selectedSource(editor, selectedOnly) {
  if (!editor || typeof editor.value !== "string") return null;
  const text = editor.value;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const validRange = Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
    start >= 0 && end >= start && end <= text.length;
  if (selectedOnly && (!validRange || start === end)) return null;
  return selectedOnly ? text.slice(start, end) : text;
}

function prepare(editor, selectedOnly) {
  const code = selectedSource(editor, selectedOnly);
  if (code === null) return {ok:false, error:"Select source code to run."};
  if (!code.trim()) return {ok:false, error:"There is no executable source."};
  if (new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
    return {ok:false, error:"Maximum Python submission: 64 KiB."};
  return {ok:true, code};
}

global.FlowStudioSourceSelection = {prepare, selectedSource, MAX_SOURCE_BYTES};
})(typeof window !== "undefined" ? window : globalThis);
