/* Explicit, browser-local, bounded export/import of Python or R session values.
 * Never serializes arbitrary objects or silently restores interpreter state.
 */
(function (global) {
"use strict";
const FORMAT = "flowstudio-session-v1";
const MAX_BYTES = 131072;
const MAX_VARIABLES = 64;
const MAX_INSPECTED = 128;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const transfer = global.FlowStudioVariableTransfer ||
  (typeof require === "function" ? require("./variable_transfer.js") : null);
function validName(name) {
  return typeof name === "string" && NAME.test(name) && name !== "__proto__";
}
function byteLength(text) { return new TextEncoder().encode(text).length; }
function validate(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join(",") !== "format,language,omitted,truncated,variables" ||
      snapshot.format !== FORMAT || !["python", "r"].includes(snapshot.language) ||
      !Array.isArray(snapshot.variables) || snapshot.variables.length > MAX_VARIABLES ||
      !Number.isSafeInteger(snapshot.omitted) || snapshot.omitted < 0 ||
      snapshot.omitted > MAX_INSPECTED ||
      typeof snapshot.truncated !== "boolean")
    throw Error("Invalid FlowStudio session snapshot.");
  const names = new Set();
  for (const entry of snapshot.variables) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !== "name,value" ||
        !validName(entry.name) || names.has(entry.name))
      throw Error("Snapshot contains an invalid or duplicate variable name.");
    names.add(entry.name);
    if (!transfer || typeof transfer.validate !== "function")
      throw Error("Variable transfer protocol unavailable.");
    transfer.validate(entry.value);
  }
  if (byteLength(JSON.stringify(snapshot)) > MAX_BYTES)
    throw Error("Session snapshot exceeds 128 KiB.");
  return snapshot;
}
function same(generation, epoch) {
  if (generation() !== epoch) throw Error("Session or selected language changed; snapshot operation cancelled.");
}
async function capture({language, inspect, exportValue, generation}) {
  if (!["python", "r"].includes(language)) throw Error("Select Python or R to export a session.");
  const epoch = generation();
  const inspected = await inspect(language);
  same(generation, epoch);
  if (!inspected || inspected.ok !== true || !Array.isArray(inspected.variables))
    throw Error(inspected?.output || "Could not inspect the selected session.");
  const seen = new Set(), names = [];
  let omitted = 0;
  for (const variable of inspected.variables.slice(0, MAX_INSPECTED)) {
    const name = variable?.name;
    if (!validName(name) || seen.has(name)) { omitted++; continue; }
    seen.add(name);
    names.push(name);
  }
  omitted += Math.max(0, inspected.variables.length - MAX_INSPECTED);
  names.sort();
  const snapshot = {format:FORMAT, language, variables:[], omitted,
    truncated:inspected.truncated === true || inspected.variables.length > MAX_INSPECTED};
  for (const name of names) {
    same(generation, epoch);
    if (snapshot.variables.length >= MAX_VARIABLES) { snapshot.omitted++; continue; }
    try {
      const result = await exportValue(language, name);
      same(generation, epoch);
      if (!result || result.ok !== true) { snapshot.omitted++; continue; }
      const value = transfer.validate(result.value);
      const candidate = {...snapshot, variables:[...snapshot.variables, {name, value}]};
      if (byteLength(JSON.stringify(candidate)) > MAX_BYTES) {
        snapshot.omitted++;
        continue;
      }
      snapshot.variables.push({name, value});
    } catch (error) {
      same(generation, epoch);
      snapshot.omitted++;
    }
  }
  same(generation, epoch);
  return validate(snapshot);
}
async function restore({snapshot, language, importValue, generation}) {
  validate(snapshot); // Preflight every variable before mutating any interpreter state.
  if (snapshot.language !== language) throw Error("Snapshot language does not match the selected session.");
  const epoch = generation();
  let imported = 0;
  for (const entry of snapshot.variables) {
    same(generation, epoch);
    let result;
    try { result = await importValue(language, entry.name, entry.value); }
    catch (error) {
      same(generation, epoch);
      throw Error("Restored " + imported + " of " + snapshot.variables.length +
        " values; " + entry.name + ": " + String(error.message || error));
    }
    same(generation, epoch);
    if (!result || result.ok !== true)
      throw Error("Restored " + imported + " of " + snapshot.variables.length +
        " values; " + entry.name + ": " + String(result?.output || "import rejected"));
    imported++;
  }
  return imported;
}
function create({exportButton, importButton, fileInput, language, inspect, exportValue,
                 importValue, generation, isBusy, setBusy, notice, download,
                 refresh, confirmOverwrite}) {
  if (![exportButton, importButton, fileInput].every(Boolean) ||
      [language, inspect, exportValue, importValue, generation, isBusy, setBusy,
       notice, download, refresh, confirmOverwrite].some(fn => typeof fn !== "function"))
    throw TypeError("Session snapshot requires UI controls and runtime callbacks.");
  const currentGeneration = () => String(generation()) + ":" + language();
  async function exportCurrent() {
    if (isBusy() || exportButton.disabled || importButton.disabled) return false;
    const selected = language();
    if (!["python", "r"].includes(selected)) {
      notice("Flow execution is stateless; only Python/R browser sessions can be exported.");
      return false;
    }
    const epoch = currentGeneration();
    exportButton.disabled = importButton.disabled = true;
    setBusy(true);
    notice("Exporting supported " + selected + " values from the live interpreter…");
    try {
      const snapshot = await capture({language:selected, inspect, exportValue,
        generation:currentGeneration});
      same(currentGeneration, epoch);
      download(JSON.stringify(snapshot), "flowstudio-" + selected + "-session.json");
      notice("Exported " + snapshot.variables.length + " " + selected + " variables" +
        (snapshot.omitted || snapshot.truncated ? " (partial: " + snapshot.omitted +
          " omitted" + (snapshot.truncated ? "; inspection truncated" : "") + ")" : "") +
        ". Only plain scalar/vector values are supported.");
      return true;
    } catch (error) {
      if (currentGeneration() === epoch) notice("Session export failed: " + String(error.message || error).slice(0, 350));
      return false;
    } finally {
      exportButton.disabled = importButton.disabled = false;
      if (currentGeneration() === epoch) setBusy(false);
    }
  }
  async function importFile(file) {
    if (isBusy() || exportButton.disabled || importButton.disabled || !file) return false;
    const selected = language(), epoch = currentGeneration();
    if (!["python", "r"].includes(selected)) {
      notice("Select Python or R before importing a session snapshot.");
      return false;
    }
    if (file.size > MAX_BYTES || file.size < 1) {
      notice("Session snapshot must be between 1 byte and 128 KiB.");
      return false;
    }
    exportButton.disabled = importButton.disabled = true;
    setBusy(true);
    try {
      const text = await file.text();
      same(currentGeneration, epoch);
      if (byteLength(text) > MAX_BYTES) throw Error("Session snapshot exceeds 128 KiB.");
      const snapshot = validate(JSON.parse(text));
      if (snapshot.language !== selected) throw Error("Snapshot language does not match the selected session.");
      if (!confirmOverwrite("Import " + snapshot.variables.length + " " + selected +
        " variables? Existing names may be overwritten; import cannot be rolled back.")) return false;
      same(currentGeneration, epoch);
      const count = await restore({snapshot, language:selected, importValue, generation:currentGeneration});
      same(currentGeneration, epoch);
      await refresh(selected);
      same(currentGeneration, epoch);
      notice("Imported " + count + " " + selected + " variables." +
        (snapshot.omitted || snapshot.truncated ? " Snapshot was partial when exported." : ""));
      return true;
    } catch (error) {
      if (currentGeneration() === epoch) {
        try { await refresh(selected); } catch (_) { /* report the original import failure */ }
        notice("Session import failed: " + String(error.message || error).slice(0, 350) +
          " Any previously imported variables remain in the interpreter.");
      }
      return false;
    } finally {
      exportButton.disabled = importButton.disabled = false;
      if (currentGeneration() === epoch) setBusy(false);
    }
  }
  exportButton.addEventListener("click", () => { void exportCurrent(); });
  importButton.addEventListener("click", () => {
    if (!isBusy()) fileInput.click();
  });
  fileInput.addEventListener("change", event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importFile(file);
  });
  return Object.freeze({exportCurrent, importFile});
}
const api = Object.freeze({FORMAT, MAX_BYTES, MAX_VARIABLES, validate, capture, restore, create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioSessionSnapshot = api;
})(globalThis);
