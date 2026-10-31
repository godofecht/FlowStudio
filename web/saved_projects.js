/* Saved example projects: projects opened from the Examples gallery persist
 * on this device as project files (id, title, files with their current
 * buffer text) so they can be reopened after a reload.
 * Pure storage discipline, mirroring the console-history module:
 * bounded, validated, and corruption must never break the editor. */
(function (root) {
"use strict";
const KEY = "flowstudio.savedProjects.v1";
const MAX_PROJECTS = 20;
const MAX_FILES = 12;
const MAX_FILE_TEXT = 65536;   // bytes of source per file
const MAX_TITLE = 200;
const MAX_TOTAL_BYTES = 786432;

function wellFormedUnicode(value) {
  // TextEncoder replaces unpaired surrogates, silently corrupting source.
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}
function validFile(file) {
  if (!file || typeof file.name !== "string" || !file.name ||
      file.name.length > 256 || file.name === "." || file.name === ".." ||
      file.name.includes("/") || file.name.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(file.name) ||
      !wellFormedUnicode(file.name) ||
      !["flow", "r", "python"].includes(file.language) ||
      typeof file.text !== "string" || file.text.length > MAX_FILE_TEXT ||
      !wellFormedUnicode(file.text)) return false;
  return new TextEncoder().encode(file.text).byteLength <= MAX_FILE_TEXT;
}
function validProject(project) {
  if (!project || typeof project.id !== "string" || !project.id || project.id.length > 120)
    return false;
  if (typeof project.title !== "string" || !project.title || project.title.length > MAX_TITLE)
    return false;
  if (!Number.isFinite(project.savedAt)) return false;
  if (!Array.isArray(project.files) || !project.files.length || project.files.length > MAX_FILES)
    return false;
  if (!project.files.every(validFile)) return false;
  if (new Set(project.files.map(file => file.name)).size !== project.files.length)
    return false;
  return new TextEncoder().encode(JSON.stringify(sanitize(project))).byteLength <= MAX_TOTAL_BYTES;
}
function sanitize(project) {
  return {
    id: project.id, title: project.title, savedAt: project.savedAt,
    files: project.files.map(file => ({ name: file.name, language: file.language, text: file.text }))
  };
}
function load(storage) {
  if (!storage) return [];
  let raw = null;
  try { raw = storage.getItem(KEY); } catch (_) { return []; }
  if (typeof raw !== "string" || !raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    try { storage.removeItem(KEY); } catch (_) {}
    return [];
  }
  if (!Array.isArray(parsed)) {
    try { storage.removeItem(KEY); } catch (_) {}
    return [];
  }
  return parsed.filter(validProject).slice(0, MAX_PROJECTS).map(sanitize);
}
function store(storage, projects) {
  if (!storage) return;
  try { storage.setItem(KEY, JSON.stringify(projects)); }
  catch (_) { /* Quota failures must not break the editor session. */ }
}
function createStore(storage) {
  let projects = load(storage);
  function persist() { store(storage, projects); }
  function indexOf(id) { return projects.findIndex(project => project.id === id); }
  return Object.freeze({
    // Callers may edit returned buffers; never expose the in-memory snapshot.
    list: () => projects.map(sanitize),
    find: id => {
      const index = indexOf(id);
      return index >= 0 ? sanitize(projects[index]) : null;
    },
    upsert(project) {
      if (!validProject(project)) return null;
      const clean = sanitize(project);
      const existing = indexOf(clean.id);
      if (existing >= 0) projects.splice(existing, 1);
      projects.unshift(clean);
      while (projects.length > MAX_PROJECTS) projects.pop();
      persist();
      return clean && clean.id ? this.find(clean.id) : null;
    },
    remove(id) {
      const index = indexOf(id);
      if (index < 0) return false;
      projects.splice(index, 1);
      persist();
      return true;
    }
  });
}
const api = Object.freeze({ createStore, validProject, validFile, KEY,
  MAX_PROJECTS, MAX_FILES, MAX_FILE_TEXT, MAX_TOTAL_BYTES });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioSavedProjects = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
