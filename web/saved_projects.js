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

function validFile(file) {
  return Boolean(file) && typeof file.name === "string" && file.name.length > 0 &&
    file.name.length <= 256 && !file.name.includes("/") && !file.name.includes("\\") &&
    (file.language === "flow" || file.language === "r" || file.language === "python") &&
    typeof file.text === "string" && file.text.length <= MAX_FILE_TEXT;
}
function validProject(project) {
  if (!project || typeof project.id !== "string" || !project.id || project.id.length > 120)
    return false;
  if (typeof project.title !== "string" || !project.title || project.title.length > MAX_TITLE)
    return false;
  if (!Number.isFinite(project.savedAt)) return false;
  if (!Array.isArray(project.files) || !project.files.length || project.files.length > MAX_FILES)
    return false;
  return project.files.every(validFile) &&
    new TextEncoder().encode(JSON.stringify(project)).length <= MAX_TOTAL_BYTES;
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
    list: () => projects.map(project => ({ ...project, files: project.files.slice() })),
    find: id => {
      const index = indexOf(id);
      return index >= 0 ? { ...projects[index], files: projects[index].files.slice() } : null;
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
