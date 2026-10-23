/* FlowStudio browser-local conflict-aware source saves. */
(function (global) {
"use strict";
const MAX_BYTES = 2 * 1024 * 1024;
class FileConflictError extends Error {
  constructor() {
    super("The file changed on disk since it was opened. Reload it or save a separate copy.");
    this.name = "FileConflictError";
  }
}
async function readSnapshot(handle) {
  if (!handle || typeof handle.getFile !== "function")
    throw new TypeError("A readable file handle is required.");
  const file = await handle.getFile();
  if (file.size > MAX_BYTES) throw new RangeError("Source file exceeds the 2 MiB limit.");
  const text = await file.text();
  if (new Blob([text]).size > MAX_BYTES)
    throw new RangeError("Source file exceeds the 2 MiB limit.");
  return text;
}
async function writeIfUnchanged(handle, baseline, source) {
  if (typeof baseline !== "string" || typeof source !== "string")
    throw new TypeError("Source and baseline must be strings.");
  if (new Blob([source]).size > MAX_BYTES)
    throw new RangeError("Source file exceeds the 2 MiB limit.");
  if (!handle || typeof handle.createWritable !== "function")
    throw new TypeError("A writable file handle is required.");
  if (await readSnapshot(handle) !== baseline) throw new FileConflictError();
  const stream = await handle.createWritable();
  try {
    await stream.write(source);
    await stream.close();
  } catch (error) {
    if (typeof stream.abort === "function") {
      try { await stream.abort(); } catch (_) { /* Preserve original failure. */ }
    }
    throw error;
  }
  return source;
}
const api = { readSnapshot, writeIfUnchanged, FileConflictError, MAX_BYTES };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioFileSave = api;
})(globalThis);
