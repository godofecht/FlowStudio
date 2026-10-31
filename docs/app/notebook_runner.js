/* Sequential percent-cell notebook execution using the existing real Python/R kernels. */
(function (global) {
"use strict";
const MAX_EXECUTABLE_CELLS = 128;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SELECTED_CELLS = 512;
const MAX_MARKDOWN_BYTES = 16384;
const MAX_CELL_BYTES = 65536;
const MAX_OUTPUT_TOTAL = 1048576;
const MAX_OUTPUT_CELL = 131072;
const MAX_IMAGES_PER_CELL = 8;
const MAX_TOTAL_IMAGES = 32;
const MAX_TOTAL_PLOTS = 32;
function closeImages(images) {
  if (!Array.isArray(images)) return;
  for (const image of images) {
    try { image?.close?.(); } catch (_) { /* already released */ }
  }
}
function boundUTF8(raw, limit) {
  let bytes = 0, end = 0;
  for (const character of raw) {
    const point = character.codePointAt(0);
    const size = point <= 127 ? 1 : point <= 2047 ? 2 : point <= 65535 ? 3 : 4;
    if (bytes + size > limit) break;
    bytes += size;
    end += character.length;
  }
  return {output:raw.slice(0, end), bytes, truncated:end < raw.length};
}
function create({parseCells, execute, onCell, notice, allowNativeFlow = false}) {
  if (typeof parseCells !== "function" || typeof execute !== "function" ||
      typeof onCell !== "function" || typeof notice !== "function")
    throw new TypeError("Notebook requires parser, executor, renderer and status callback.");
  let generation = 0;
  let active = false;
  let activeToken = 0;
  // Invalidate UI results immediately, but do not admit a new notebook until
  // the in-flight interpreter call has settled. webR PostMessage cannot interrupt.
  function cancel() { generation++; }
  async function run(source, language, options = {}) {
    if (active) return {ok:false, executed:0, error:"Notebook execution is already running."};
    if (!["python", "r", "flow"].includes(language))
      return {ok:false, executed:0, error:"Unsupported default notebook language."};
    if (typeof source !== "string" || source.length > MAX_SOURCE_BYTES)
      return {ok:false, executed:0, error:"Notebook source exceeds the 2 MiB execution limit."};
    const encoder = new TextEncoder();
    if (encoder.encode(source).length > MAX_SOURCE_BYTES)
      return {ok:false, executed:0, error:"Notebook source exceeds the 2 MiB UTF-8 execution limit."};
    try { encodeURIComponent(source); }
    catch (_) { return {ok:false, executed:0, error:"Notebook source contains invalid Unicode."}; }
    let cells;
    try { cells = parseCells(source); }
    catch (error) { return {ok:false, executed:0, error:String(error.message || error)}; }
    if (!Array.isArray(cells)) return {ok:false, executed:0, error:"Invalid source cell list."};
    const startIndex = options && options.startIndex !== undefined ? options.startIndex : 0;
    if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex >= cells.length)
      return {ok:false, executed:0, error:"Notebook start cell is outside the source buffer."};
    const endIndex = options && options.endIndex !== undefined ? options.endIndex : cells.length - 1;
    if (!Number.isSafeInteger(endIndex) || endIndex < startIndex || endIndex >= cells.length)
      return {ok:false, executed:0, error:"Notebook end cell is outside the selected source range."};
    const selectedCells = cells.slice(startIndex, endIndex + 1);
    if (selectedCells.length > MAX_SELECTED_CELLS)
      return {ok:false, executed:0, error:"Notebook exceeds the 512 selected-cell execution limit."};
    const runnable = selectedCells.filter(cell => cell.kind === "code" && typeof cell.code === "string" && cell.code.trim());
    if (!runnable.length) return {ok:false, executed:0, error:"No executable source cells."};
    const languages = runnable.map(cell => cell.language || language);
    if (languages.some(selected => !["python", "r", "flow"].includes(selected)))
      return {ok:false, executed:0, error:"Unsupported notebook cell language."};
    if (languages.includes("flow") && allowNativeFlow !== true)
      return {ok:false, executed:0, error:"Flow notebook execution requires an explicitly enabled native Flow server."};
    if (runnable.length > MAX_EXECUTABLE_CELLS)
      return {ok:false, executed:0, error:"Notebook exceeds the 128 executable-cell limit."};
    if (runnable.some(cell => encoder.encode(cell.code).length > MAX_CELL_BYTES))
      return {ok:false, executed:0, error:"Notebook cell exceeds the 64 KiB execution limit."};
    const token = ++generation;
    activeToken = token;
    active = true;
    let executed = 0, remaining = MAX_OUTPUT_TOTAL;
    let remainingImages = MAX_TOTAL_IMAGES, remainingPlots = MAX_TOTAL_PLOTS;
    try {
      for (const cell of selectedCells) {
        if (token !== generation) return {ok:false, executed, cancelled:true};
        if (cell.kind === "markdown") {
          const bounded = boundUTF8(String(cell.code), MAX_MARKDOWN_BYTES);
          try { onCell({index:cell.index, kind:"markdown", code:bounded.output}); }
          catch (error) {
            return {ok:false, executed, error:"Notebook rendering failed: " + String(error.message || error)};
          }
          continue;
        }
        if (cell.kind !== "code" || !cell.code.trim()) continue;
        const selectedLanguage = cell.language || language;
        notice("Running " + selectedLanguage + " notebook cell " + (executed + 1) + "/" + runnable.length + "…");
        let response;
        try { response = await execute(cell.code, selectedLanguage); }
        catch (error) { response = {ok:false, output:String(error.message || error)}; }
        if (token !== generation) {
          closeImages(response?.images);
          return {ok:false, executed, cancelled:true};
        }
        const raw = String(response?.output ?? "(no output)");
        const max = Math.min(remaining, MAX_OUTPUT_CELL);
        const bounded = boundUTF8(raw, max);
        const {output, truncated} = bounded;
        remaining -= bounded.bytes;
        // Per-cell limits alone permit 128 * 8 retained bitmaps/plots.
        // Bound the entire run and immediately release every excess bitmap.
        const allImages = Array.isArray(response?.images) ? response.images : [];
        const images = allImages.slice(0, Math.min(MAX_IMAGES_PER_CELL, remainingImages));
        closeImages(allImages.slice(images.length));
        remainingImages -= images.length;
        const allPlots = Array.isArray(response?.plots) ? response.plots : [];
        const plots = allPlots.slice(0, Math.min(MAX_IMAGES_PER_CELL, remainingPlots));
        remainingPlots -= plots.length;
        const entry = {index:cell.index, kind:"code", language:selectedLanguage, code:cell.code,
          ok:response?.ok === true, output, truncated, plots, images};
        try { onCell(entry); }
        catch (error) {
          closeImages(images);
          return {ok:false, executed, error:"Notebook rendering failed: " + String(error.message || error)};
        }
        executed++;
        if (!entry.ok) return {ok:false, executed, failedIndex:cell.index, error:"Cell execution failed."};
        // Reaching the exact aggregate budget is valid only when no output
        // was discarded and no further executable cells remain. Never launch
        // another kernel call once the remaining output budget is exhausted.
        if (remaining === 0 && (bounded.truncated || executed < runnable.length))
          return {ok:false, executed, error:"Notebook output limit of 1 MiB reached."};
      }
      return {ok:true, executed};
    } finally { if (token === activeToken) active = false; }
  }
  return Object.freeze({run, cancel, isRunning:() => active});
}
const api = Object.freeze({create, MAX_EXECUTABLE_CELLS});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioNotebook = api;
})(globalThis);
