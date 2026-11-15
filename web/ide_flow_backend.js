/* Flow backend switcher: the "C / MLIR" menu next to the run configuration.
 *
 * The hidden #flowBackend select stays the single source of truth for runs
 * ("" is the C backend, "mlir" posts to /api/run/flow-mlir). This file adds
 * a menu button that shows both backends with a one-line description, asks
 * the server once whether MLIR tools exist on this machine
 * (GET /api/flow/backends, which only looks for files), remembers the choice
 * per project, and names the active backend on the Run button tooltip.
 *
 * createState() holds the logic and has no DOM, so node tests cover it. */
(function (root) {
"use strict";

const KEY = "flowstudio.flowBackend.v1";
const BACKENDS = Object.freeze([
  Object.freeze({ id: "c", value: "", short: "C", label: "C backend",
    description: "Default. Compiles Flow to C. Programs can import flowstudio to call live Python and R." }),
  Object.freeze({ id: "mlir", value: "mlir", short: "MLIR", label: "MLIR backend",
    description: "Experimental. Compiles Flow through MLIR and LLVM." })
]);
const RUN_SHORTCUT = "(Ctrl/⌘+Enter)";

function byId(id) { return BACKENDS.find(item => item.id === id) || null; }
function fromValue(value) { return BACKENDS.find(item => item.value === value) || BACKENDS[0]; }

/* Tooltip for the Run button: names the backend for Flow runs. */
function runTooltip(language, backendId) {
  if (language !== "flow") return "Run selection or entire buffer " + RUN_SHORTCUT;
  return "Run with the Flow " + (byId(backendId) || BACKENDS[0]).label + " " + RUN_SHORTCUT;
}

/* The runtime named on the console run line, e.g. "flow, MLIR backend". */
function runtimeLabel(language, backendValue) {
  if (language !== "flow") return String(language || "");
  return "flow, " + fromValue(backendValue || "").label;
}

/* Appended to the run label on the console's run line, e.g.
 * "app.flow on the MLIR backend". Empty for Python and R. */
function runNote(language, backendValue) {
  if (language !== "flow") return "";
  return " on the " + fromValue(backendValue || "").label;
}

function createState(options = {}) {
  const storage = options.storage || null;
  let saved = { projects: {}, last: "c" };
  try {
    const raw = storage && storage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const projects = {};
      if (parsed.projects && typeof parsed.projects === "object")
        for (const [name, id] of Object.entries(parsed.projects)) if (byId(id)) projects[name] = id;
      saved = { projects, last: byId(parsed.last) ? parsed.last : "c" };
    }
  } catch (_) { /* unreadable storage starts fresh */ }
  /* null while the probe is out; then { available, reason } per backend. */
  let availability = null;

  function persist() {
    if (!storage) return;
    try { storage.setItem(KEY, JSON.stringify(saved)); } catch (_) { /* optional */ }
  }
  const projectKey = project => (project && project.name ? "p:" + project.name : "");

  return {
    /* What the user chose for this project; a project never seen before
     * starts on the C backend, the default. No project uses the last choice. */
    preferred(project) {
      const key = projectKey(project);
      if (!key) return saved.last;
      return saved.projects[key] || "c";
    },
    /* The backend runs use: the preference, unless that backend is known to
     * be missing on this machine. */
    effective(project) {
      const id = this.preferred(project);
      return this.available(id) === false ? "c" : id;
    },
    remember(project, id) {
      if (!byId(id)) return false;
      const key = projectKey(project);
      if (key) saved.projects[key] = id;
      saved.last = id;
      persist();
      return true;
    },
    setAvailability(report) {
      const next = {};
      for (const backend of BACKENDS) {
        const entry = report && report[backend.id];
        next[backend.id] = entry && typeof entry === "object"
          ? { available: entry.available === true, reason: typeof entry.reason === "string" ? entry.reason : "" }
          : { available: null, reason: "" };
      }
      availability = next;
    },
    /* true, false, or null when unknown (not probed yet, or probe failed). */
    available(id) {
      if (!availability || !availability[id]) return null;
      return availability[id].available;
    },
    reason(id) { return availability && availability[id] ? availability[id].reason : ""; },
    probed() { return availability !== null; },
    snapshot() { return JSON.parse(JSON.stringify(saved)); }
  };
}

const CARET = '<svg class="bs-caret" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>';

function mount(doc, options = {}) {
  const chip = doc.getElementById("runConfigChip");
  const select = doc.getElementById("flowBackend");
  const language = doc.getElementById("language");
  const runButton = doc.getElementById("run");
  if (!chip || !select || !language) return null;
  let storage = options.storage;
  if (storage === undefined) { try { storage = root.localStorage || null; } catch (_) { storage = null; } }
  const state = createState({ storage });
  const projects = () => root.FlowStudioProjects || null;
  const currentProject = () => { const p = projects(); return p && p.current ? p.current() : null; };

  const wrap = doc.createElement("div");
  wrap.className = "backend-switch";
  const button = doc.createElement("button");
  button.type = "button";
  button.id = "flowBackendButton";
  button.className = "backend-button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "flowBackendMenu");
  const buttonLabel = doc.createElement("span");
  buttonLabel.className = "bs-label";
  button.append(buttonLabel);
  button.insertAdjacentHTML("beforeend", CARET);
  const menu = doc.createElement("div");
  menu.id = "flowBackendMenu";
  menu.className = "menu-popup backend-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Flow backend");
  menu.hidden = true;
  const heading = doc.createElement("div");
  heading.className = "bm-heading";
  heading.textContent = "Flow backend";
  heading.setAttribute("aria-hidden", "true");
  menu.append(heading);
  const items = BACKENDS.map(backend => {
    const item = doc.createElement("button");
    item.type = "button";
    item.className = "bm-item";
    item.id = "flowBackendItem-" + backend.id;
    item.dataset.backend = backend.id;
    item.setAttribute("role", "menuitemradio");
    item.tabIndex = -1;
    const mark = doc.createElement("span");
    mark.className = "bm-mark";
    mark.setAttribute("aria-hidden", "true");
    const body = doc.createElement("span");
    body.className = "bm-body";
    const title = doc.createElement("span");
    title.className = "bm-title";
    title.textContent = backend.label;
    const description = doc.createElement("span");
    description.className = "bm-desc";
    description.textContent = backend.description;
    const note = doc.createElement("span");
    note.className = "bm-status";
    body.append(title, description, note);
    item.append(mark, body);
    item.addEventListener("click", () => choose(backend.id));
    menu.append(item);
    return item;
  });
  wrap.append(button, menu);
  chip.after(wrap);

  function current() { return fromValue(select.value).id; }
  function render() {
    const lang = language.value;
    const active = byId(current());
    wrap.hidden = lang !== "flow";
    buttonLabel.textContent = active.short;
    const note = state.preferred(currentProject()) !== active.id && state.available(state.preferred(currentProject())) === false
      ? " (MLIR is not available on this machine)" : "";
    button.title = "Flow backend: " + active.label + note + ". Change backend";
    button.setAttribute("aria-label", "Flow backend: " + active.label + note);
    if (runButton) runButton.title = runTooltip(lang, active.id);
    for (const item of items) {
      const id = item.dataset.backend;
      const status = item.querySelector(".bm-status");
      const known = state.available(id);
      item.setAttribute("aria-checked", String(id === active.id));
      item.setAttribute("aria-disabled", String(known === false));
      item.dataset.availability = known === true ? "yes" : known === false ? "no" : state.probed() ? "unknown" : "checking";
      status.textContent = id === "c" && known !== false ? "" :
        known === true ? "Available on this machine" :
        known === false ? (state.reason(id) || "Not available on this machine") :
        state.probed() ? "Could not check this machine" : "Checking this machine…";
      status.hidden = !status.textContent;
    }
  }
  /* Set the select the way a person would, so every listener hears it. */
  let applying = false;
  function applyValue(id) {
    const backend = byId(id) || BACKENDS[0];
    if (select.value === backend.value) { render(); return; }
    select.value = backend.value;
    applying = true;
    try { select.dispatchEvent(new Event("change", { bubbles: true })); }
    finally { applying = false; }
  }
  function choose(id) {
    if (state.available(id) === false) return false;
    state.remember(currentProject(), id);
    applyValue(id);
    render();
    close(true);
    return true;
  }
  function isOpen() { return !menu.hidden; }
  function focusItem(index) {
    const item = items[(index + items.length) % items.length];
    item.focus();
  }
  function open(focusLast = false) {
    if (isOpen()) return;
    render();
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    const checked = items.findIndex(item => item.getAttribute("aria-checked") === "true");
    focusItem(focusLast ? items.length - 1 : Math.max(0, checked));
  }
  function close(returnFocus) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (returnFocus) button.focus();
  }

  button.addEventListener("click", () => (isOpen() ? close(true) : open()));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open(event.key === "ArrowUp");
    }
  });
  menu.addEventListener("keydown", event => {
    const index = items.indexOf(doc.activeElement);
    const key = event.key;
    if (key === "ArrowDown") { event.preventDefault(); focusItem(index + 1); }
    else if (key === "ArrowUp") { event.preventDefault(); focusItem(index - 1); }
    else if (key === "Home") { event.preventDefault(); focusItem(0); }
    else if (key === "End") { event.preventDefault(); focusItem(items.length - 1); }
    else if (key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (key === "Tab") { close(false); }
    else if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (index >= 0) choose(items[index].dataset.backend);
    } else if (key.length === 1) {
      const match = items.findIndex(item => item.textContent.trim().toLowerCase().startsWith(key.toLowerCase()));
      if (match >= 0) { event.preventDefault(); focusItem(match); }
    }
  });
  doc.addEventListener("mousedown", event => {
    if (isOpen() && !wrap.contains(event.target)) close(false);
  }, true);

  /* Other ways to change the backend (the run configuration dialog) count
   * as the user's choice for this project too. */
  select.addEventListener("change", () => {
    if (!applying) state.remember(currentProject(), current());
    render();
  });
  language.addEventListener("change", render);

  function applyProject() { applyValue(state.effective(currentProject())); render(); }
  function watchProjects() {
    const p = projects();
    if (p && p.onChange) { p.onChange(applyProject); return true; }
    return false;
  }
  if (!watchProjects() && doc.readyState === "loading")
    doc.addEventListener("DOMContentLoaded", () => { watchProjects(); applyProject(); });

  const fetcher = options.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
  const probe = fetcher
    ? Promise.resolve()
      .then(() => fetcher("/api/flow/backends", { headers: { Accept: "application/json" } }))
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null)
      .then(report => { state.setAvailability(report); applyProject(); })
    : Promise.resolve();

  applyProject();
  return Object.freeze({ state, open, close, isOpen, choose, render, probe, button, menu });
}

const api = Object.freeze({ KEY, BACKENDS, createState, runTooltip, runtimeLabel, runNote, mount });
root.FlowStudioFlowBackend = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.getElementById && document.getElementById("flowBackend")) {
  try { root.FlowStudioFlowBackendMenu = mount(document); }
  catch (error) { if (root.console) root.console.error("FlowStudio backend menu failed to mount: " + (error && error.message)); }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
