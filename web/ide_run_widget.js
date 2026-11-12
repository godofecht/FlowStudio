/* FlowStudio run-configuration widget (polysemantic top-bar cluster).
 * The chip mirrors the hidden #language / #flowBackend selects; the dialog
 * gives searchable keyboard apply across language × backend configurations.
 * The selects stay the single source of truth so workspace wiring, the Monaco
 * language sync and the native server contract keep working untouched. */
(function (root) {
"use strict";

const KEY = "flowstudio.runConfig.v1";
const LANGUAGES = [
  { id: "flow", label: "Flow" },
  { id: "r", label: "R" },
  { id: "python", label: "Python" }
];
const BACKENDS = [
  { id: "", label: "C backend (default)" },
  { id: "mlir", label: "MLIR backend (experimental)" }
];

function languageLabel(id) {
  const match = LANGUAGES.find(lang => lang.id === id);
  return match ? match.label : id;
}
function backendLabel(id) {
  const match = BACKENDS.find(backend => backend.id === id);
  return match ? match.label : id;
}
/* Compose synthetic 'change' dispatch that works for real DOM elements and
 * the workspace harness's node fakes. */
function emitChange(node) {
  if (!node) return false;
  if (typeof node.dispatchEvent === "function") {
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (typeof node.fire === "function") { node.fire("change"); return true; }
  return false;
}
function readStorage(storage) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(KEY); } catch (_) { return null; }
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!LANGUAGES.some(lang => lang.id === parsed.language)) return null;
    if (!BACKENDS.some(backend => backend.id === parsed.backend)) return null;
    return { language: parsed.language, backend: parsed.backend };
  } catch (_) { return null; }
}
function writeStorage(storage, config) {
  if (!storage) return;
  try { storage.setItem(KEY, JSON.stringify(config)); } catch (_) { /* optional */ }
}

function mount(doc, options = {}) {
  const chip = doc.getElementById("runConfigChip");
  const chipLang = doc.getElementById("runChipLang");
  const chipBackend = doc.getElementById("runChipBackend");
  const language = doc.getElementById("language");
  const backend = doc.getElementById("flowBackend");
  const dialog = doc.getElementById("runConfigDialog");
  const list = doc.getElementById("runConfigList");
  const query = doc.getElementById("runConfigQuery");
  if (!chip || !dialog || !list) return null;
  let storage = options.storage;
  if (storage === undefined) {
    try { storage = root.localStorage || null; } catch (_) { storage = null; }
  }

  const controller = { open: false, items: [], selection: 0 };

  function chipSync() {
    const lang = language && typeof language.value === "string" ? language.value : "flow";
    const conf = backend && typeof backend.value === "string" ? backend.value : "";
    if (chipLang && typeof chipLang.textContent === "string") chipLang.textContent = languageLabel(lang);
    if (chipBackend && typeof chipBackend.textContent === "string") {
      chipBackend.textContent = lang === "flow" ? backendLabel(conf) : "—";
    }
  }
  function configurations() {
    const rows = [];
    for (const lang of LANGUAGES) {
      for (const backendOption of (lang.id === "flow" ? BACKENDS : BACKENDS.slice(0, 1))) {
        rows.push({ language: lang.id, backend: backendOption.id });
      }
    }
    return rows;
  }
  function render(filter = "") {
    const needle = String(filter || "").toLowerCase().trim();
    controller.items = configurations().filter(row =>
      !needle ||
      languageLabel(row.language).toLowerCase().includes(needle) ||
      backendLabel(row.backend).toLowerCase().includes(needle));
    controller.selection = 0;
    if (list.replaceChildren) list.replaceChildren();
    if (!controller.items.length) {
      const empty = doc.createElement ? doc.createElement("div") : null;
      if (empty) { empty.className = "se-empty"; empty.textContent = "No matching run configuration."; if (list.append) list.append(empty); }
    }
    for (const row of controller.items) {
      const option = doc.createElement("div");
      option.className = "se-row";
      option.setAttribute("role", "option");
      option.dataset.language = row.language;
      option.dataset.backend = row.backend;
      const kind = doc.createElement("span");
      kind.className = "se-kind";
      kind.textContent = "config";
      const label = doc.createElement("span");
      label.className = "se-label";
      label.textContent = languageLabel(row.language);
      const meta = doc.createElement("span");
      meta.className = "se-meta";
      meta.textContent = backendLabel(row.backend);
      option.append(kind, label, meta);
      option.addEventListener?.("click", () => apply(row.language, row.backend));
      list.append(option);
    }
    highlight();
  }
  function highlight() {
    const rows = Array.from(list.querySelectorAll(".se-row"));
    rows.forEach((row, index) => {
      if (index === controller.selection) row.setAttribute("aria-selected", "true");
      else if (row.getAttribute("aria-selected")) row.setAttribute("aria-selected", "false");
    });
  }
  function apply(lang, conf) {
    if (!LANGUAGES.some(item => item.id === lang)) return false;
    if (!BACKENDS.some(item => item.id === conf)) return false;
    if (language) {
      language.value = lang;
      if (language.setAttribute) language.setAttribute("value", String(lang));
      emitChange(language);
    }
    if (backend) {
      backend.value = conf;
      if (backend.setAttribute) backend.setAttribute("value", String(conf));
      emitChange(backend);
    }
    writeStorage(storage, { language: lang, backend: conf });
    chipSync();
    closeDialog();
    return true;
  }
  function moveSelection(step) {
    if (!controller.items.length) return;
    controller.selection = (controller.selection + step + controller.items.length) % controller.items.length;
    highlight();
  }
  function openDialog() {
    if (query && typeof query.value === "string") query.value = "";
    render("");
    // Preselect the currently applied configuration so Enter keeps it.
    const currentLang = language && typeof language.value === "string" ? language.value : null;
    const currentBackend = backend && typeof backend.value === "string" ? backend.value : null;
    const index = controller.items.findIndex(row =>
      row.language === currentLang && row.backend === currentBackend);
    if (index >= 0) controller.selection = index;
    highlight();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.hidden = false;
    controller.open = true;
    if (query && typeof query.focus === "function") query.focus();
  }
  function closeDialog() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.hidden = true;
    controller.open = false;
  }

  chip.addEventListener?.("click", () => (controller.open ? closeDialog() : openDialog()));
  language?.addEventListener?.("change", chipSync);
  backend?.addEventListener?.("change", chipSync);
  query?.addEventListener?.("input", () => render(query.value || ""));
  query?.addEventListener?.("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault?.();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault?.();
      const chosen = controller.items[controller.selection];
      if (chosen) apply(chosen.language, chosen.backend);
    } else if (event.key === "Escape") {
      event.preventDefault?.();
      closeDialog();
    }
  });

  /* Restore the last configuration once at mount; requires the stored config
   * to differ from the current one to avoid a same-frame reset. */
  const restored = readStorage(storage);
  if (restored && language && backend &&
      language.value !== restored.language) {
    language.value = restored.language;
    emitChange(language);
    chipSync();
  }

  chipSync();

  return Object.freeze({
    chipSync,
    render: () => render(query && typeof query.value === "string" ? query.value : ""),
    apply,
    openDialog,
    closeDialog,
    selection: () => controller.selection,
    moveSelection,
    items: () => controller.items.slice(),
    isOpen: () => controller.open,
    configs: configurations,
    dispose() { closeDialog(); }
  });
}

const api = Object.freeze({ mount, KEY, LANGUAGES, BACKENDS, languageLabel, backendLabel, readStorage, writeStorage });
root.FlowStudioRunWidget = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined") {
  const start = () => {
    try { mount(document, {}); } catch (_) { /* Widget enhancement is optional. */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
