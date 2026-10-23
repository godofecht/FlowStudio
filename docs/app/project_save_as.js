/* Save As through a browser-granted file handle; never send source to a server. */
(function (global) {
"use strict";
async function save({picker, fileSaveApi, validFilename, filename, source,
                     activeHandle, activeBaseline, confirmOverwrite}) {
  if (typeof picker !== "function")
    throw new Error("Save As requires a browser with the File System Access API. Use Download source instead.");
  if (!fileSaveApi || typeof fileSaveApi.readSnapshot !== "function" ||
      typeof fileSaveApi.writeIfUnchanged !== "function" ||
      typeof validFilename !== "function" || typeof source !== "function" ||
      typeof confirmOverwrite !== "function") throw new TypeError("Invalid Save As dependencies.");
  const handle = await picker({suggestedName: filename});
  if (!handle || handle.kind !== "file" || !validFilename(handle.name))
    throw new Error("Choose a supported source filename.");
  // Reusing the active handle must retain its original conflict baseline.
  // A new handle can still refer to the same file; check identity when available.
  let same = handle === activeHandle;
  if (!same && activeHandle && typeof handle.isSameEntry === "function")
    same = await handle.isSameEntry(activeHandle);
  if (same && typeof activeBaseline !== "string")
    throw new Error("The active file has no verified baseline.");
  const baseline = same ? activeBaseline : await fileSaveApi.readSnapshot(handle);
  if (!same && !confirmOverwrite('Save source as "' + handle.name + '"? This will replace its current contents if it exists.'))
    return null;
  // Source is sampled after the picker/confirmation, so no edits made while
  // those dialogs are open are silently lost. writeIfUnchanged rechecks disk.
  const written = await fileSaveApi.writeIfUnchanged(handle, baseline, source());
  return {handle, name:handle.name, source:written};
}
const api = Object.freeze({save});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProjectSaveAs = api;
})(globalThis);
