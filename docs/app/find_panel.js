/* Accessible Pages source find/replace controller; source edits go through input
 * events so the existing notebook invalidation and draft tracking remain active. */
(function (global) {
"use strict";
const MAX_SOURCE = 2 * 1024 * 1024;
function create({source, query, replacement, caseSensitive, status,
                 nextButton, previousButton, replaceButton, allButton, document,
                 engine = global.FlowStudioEditorFind}) {
  if (!engine || !source || !query || !replacement || !status)
    throw TypeError("Source find/replace requires its editor and search engine.");
  function options() { return {caseSensitive:!!caseSensitive.checked}; }
  function report(message) { status.textContent = message; }
  function matches() {
    try {
      return engine.findMatches(source.value, query.value, options());
    } catch (error) {
      report(String(error.message || error));
      return null;
    }
  }
  function select(hit) {
    source.focus();
    source.setSelectionRange(hit.index, hit.end);
  }
  function move(backwards = false) {
    const found = matches();
    if (!found) return false;
    if (!found.matches.length) { report("No matches."); return false; }
    if (found.truncated) {
      report("More than 10,000 matches. Narrow the search."); return false;
    }
    const hit = engine.nextMatch(found.matches, source.selectionStart, source.selectionEnd, backwards);
    if (!hit) return false;
    select(hit);
    const position = found.matches.findIndex(match => match.index === hit.index && match.end === hit.end);
    report("Match " + (position + 1) + " of " + found.matches.length + ".");
    return true;
  }
  function changed() {
    source.dispatchEvent(new Event("input", {bubbles:true}));
  }
  function replaceOne() {
    if (!query.value) { report("Enter text to find."); return false; }
    try {
      const result = engine.replaceSelection(source.value, query.value, replacement.value,
        source.selectionStart, source.selectionEnd, options());
      if (!result.replaced) { report("Select a matching occurrence first."); return false; }
      if (result.value.length > MAX_SOURCE) throw Error("Replacement exceeds the 2 MiB editor limit.");
      // setRangeText retains the browser's native editing semantics where available.
      if (typeof source.setRangeText === "function")
        source.setRangeText(replacement.value, result.start, source.selectionEnd, "select");
      else source.value = result.value;
      source.setSelectionRange(result.start, result.end);
      changed();
      report("Replaced one occurrence.");
      return true;
    } catch (error) { report(String(error.message || error)); return false; }
  }
  function replaceAll() {
    if (!query.value) { report("Enter text to find."); return 0; }
    try {
      const result = engine.replaceAll(source.value, query.value, replacement.value, options());
      if (result.value.length > MAX_SOURCE) throw Error("Replacement exceeds the 2 MiB editor limit.");
      if (result.count) {
        source.value = result.value;
        source.setSelectionRange(result.firstIndex, result.firstIndex);
        changed();
      }
      report("Replaced " + result.count + " occurrence" + (result.count === 1 ? "" : "s") + ".");
      return result.count;
    } catch (error) { report(String(error.message || error)); return 0; }
  }
  nextButton.addEventListener("click", () => move(false));
  previousButton.addEventListener("click", () => move(true));
  replaceButton.addEventListener("click", replaceOne);
  allButton.addEventListener("click", replaceAll);
  query.addEventListener("input", () => {
    if (!query.value) { report("Enter text to find."); return; }
    const found = matches();
    if (found) report(found.matches.length + (found.truncated ? "+" : "") + " matches.");
  });
  caseSensitive.addEventListener("change", () => {
    const found = matches();
    if (found) report(found.matches.length + (found.truncated ? "+" : "") + " matches.");
  });
  source.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey &&
        (event.key.toLowerCase() === "f" || event.key.toLowerCase() === "h")) {
      event.preventDefault();
      if (event.key.toLowerCase() === "h") replacement.focus();
      else query.focus();
    } else if (event.key === "F3") {
      event.preventDefault();
      move(!!event.shiftKey);
    }
  });
  query.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); move(!!event.shiftKey); }
  });
  return Object.freeze({move, replaceOne, replaceAll});
}
const api = Object.freeze({create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioFindPanel = api;
})(globalThis);
