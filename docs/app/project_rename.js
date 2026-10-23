/* Browser-local project file rename. File System Access has no atomic rename:
 * copy, verify, then remove the original, retaining both on ambiguous failure. */
(function (global) {
"use strict";
async function rename({parent, handle, name, nextName, baseline, fileSaveApi,
                       validFilename, confirmRename}) {
  if (!parent || parent.kind !== "directory" || typeof parent.getFileHandle !== "function" ||
      typeof parent.removeEntry !== "function" || !handle || handle.kind !== "file")
    throw new Error("Project rename requires a writable parent directory.");
  if (typeof validFilename !== "function" || !validFilename(nextName) ||
      typeof name !== "string" || nextName === name)
    throw new Error("Choose a different supported source filename.");
  if (typeof baseline !== "string" || !fileSaveApi ||
      typeof fileSaveApi.readSnapshot !== "function" ||
      typeof fileSaveApi.writeIfUnchanged !== "function" ||
      typeof confirmRename !== "function") throw new TypeError("Invalid rename dependencies.");

  async function verifyOriginal() {
    const current = await parent.getFileHandle(name);
    if (typeof current.isSameEntry === "function" && !(await current.isSameEntry(handle)))
      throw new Error("Source file was replaced externally; rename refused.");
    if (await fileSaveApi.readSnapshot(current) !== baseline)
      throw new Error("Source file changed on disk; rename refused.");
  }
  await verifyOriginal();
  // A failed lookup must be a real NotFoundError, not a permission failure.
  try {
    await parent.getFileHandle(nextName);
    throw new Error("Destination already exists; rename refused.");
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }
  if (!confirmRename('Rename "' + name + '" to "' + nextName + '"?')) return null;
  await verifyOriginal();
  // Recheck immediately before create. This is still not an atomic
  // create-if-absent operation; File System Access offers no such primitive.
  try {
    await parent.getFileHandle(nextName);
    throw new Error("Destination appeared during rename; rename refused.");
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;
  }

  const destination = await parent.getFileHandle(nextName, {create:true});
  let copied = false;
  try {
    if (typeof destination.isSameEntry === "function" && await destination.isSameEntry(handle))
      throw new Error("Destination resolves to the original file; rename refused.");
    await fileSaveApi.writeIfUnchanged(destination, "", baseline);
    copied = true;
    if (await fileSaveApi.readSnapshot(destination) !== baseline)
      throw new Error("Destination verification failed; original retained.");
    await verifyOriginal();
    // No browser API makes the following check-and-remove atomic.
    await parent.removeEntry(name);
    return {handle:destination, name:nextName, source:baseline};
  } catch (error) {
    // Preserve any successfully copied file: it may be the only remaining
    // recoverable copy after an ambiguous removeEntry failure.
    if (copied) {
      throw new Error("Rename incomplete; check both files before retrying. " +
        (error.message || String(error)), {cause:error});
    }
    // Before copy succeeds, remove only the exact empty file we created.
    try {
      const current = await parent.getFileHandle(nextName);
      const same = typeof current.isSameEntry === "function" &&
        await current.isSameEntry(destination);
      if (same && await fileSaveApi.readSnapshot(current) === "")
        await parent.removeEntry(nextName);
    } catch (_) { /* Do not mask the original failure. */ }
    throw error;
  }
}
const api = Object.freeze({rename});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProjectRename = api;
})(globalThis);
