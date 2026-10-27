/* Safe, browser-local project file and directory creation through granted handles.
 * Paths are relative to the selected root. No absolute paths or implicit mkdir -p.
 */
(function (global) {
"use strict";
const MAX_DEPTH = 12;
const MAX_PATH = 512;
const MAX_NAME = 255;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function validFolderName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME &&
    name !== "." && name !== ".." && name === name.trim() &&
    !name.endsWith(".") && !/[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) &&
    !RESERVED.test(name);
}
function partsFor(path, kind, validFilename) {
  if (typeof path !== "string" || !path || path.length > MAX_PATH ||
      path.startsWith("/") || path.endsWith("/") || path.includes("\\"))
    throw new Error("Project path must be relative to the selected folder.");
  const parts = path.split("/");
  if (parts.length > MAX_DEPTH || parts.some(part => !validFolderName(part)))
    throw new Error("Project path contains an invalid folder name or exceeds 12 levels.");
  if (kind === "file" && (typeof validFilename !== "function" ||
      !validFilename(parts[parts.length - 1])))
    throw new Error("Invalid source filename.");
  return parts;
}
function validSourcePath(path, validFilename) {
  try { partsFor(path, "file", validFilename); return true; }
  catch (_) { return false; }
}
function validFolderPath(path) {
  try { partsFor(path, "directory"); return true; }
  catch (_) { return false; }
}
async function resolveParent(root, parts) {
  if (!root || root.kind !== "directory") throw new Error("Open a project folder first.");
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    // Never create missing ancestors. This also prevents implicit writes
    // outside the exact browser-granted directory hierarchy.
    parent = await parent.getDirectoryHandle(part);
    if (!parent || parent.kind !== "directory")
      throw new Error("Project path parent is not a directory.");
  }
  return parent;
}
async function assertMissing(parent, name) {
  // getFileHandle reports TypeMismatchError for an existing directory, so a
  // single lookup detects both occupied file and directory names.
  try {
    await parent.getFileHandle(name);
  } catch (error) {
    if (error && error.name === "NotFoundError") return;
    if (error && error.name === "TypeMismatchError")
      throw new Error("Project entry already exists: " + name);
    throw error;
  }
  throw new Error("Project entry already exists: " + name);
}
async function createFile(root, path, validFilename) {
  const parts = partsFor(path, "file", validFilename);
  const parent = await resolveParent(root, parts);
  const name = parts[parts.length - 1];
  await assertMissing(parent, name);
  const handle = await parent.getFileHandle(name, {create: true});
  if (!handle || handle.kind !== "file") throw new Error("New project entry is not a file.");
  // Creation is not atomic with the preflight check. Refuse to open a
  // nonempty file that appeared in the intervening filesystem race.
  const snapshot = await handle.getFile();
  if (!snapshot || snapshot.size !== 0)
    throw new Error("New project file is not empty; an external creation may have raced.");
  return {handle, parent, path: parts.join("/")};
}
async function createDirectory(root, path) {
  const parts = partsFor(path, "directory");
  const parent = await resolveParent(root, parts);
  const name = parts[parts.length - 1];
  await assertMissing(parent, name);
  const handle = await parent.getDirectoryHandle(name, {create: true});
  if (!handle || handle.kind !== "directory")
    throw new Error("New project entry is not a directory.");
  return {handle, parent, path: parts.join("/")};
}
const api = Object.freeze({validFolderName, validSourcePath, validFolderPath,
  createFile, createDirectory});
global.FlowStudioProjectCreate = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
