/* Explicit, browser-local, bounded export/import of Python or R session values.
 * Never serializes arbitrary objects or silently restores interpreter state.
 */
(function (global) {
"use strict";
const FORMAT = "flowstudio-session-v1";
const FORMAT_V2 = "flowstudio-session-v2";
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
function matrixPacket(packet) {
  return packet && packet.kind === "table" && Array.isArray(packet.columns) &&
    packet.columns.length > 0 && packet.columns[0] &&
    Array.isArray(packet.columns[0].values) && packet.columns[0].values.length > 0 &&
    packet.columns.every(column => column && column.type === packet.columns[0].type &&
      Array.isArray(column.values) &&
      column.values.length === packet.columns[0].values.length);
}
function numpyPacket(packet) {
  if (!packet) return false;
  if (packet.kind === "vector")
    return Array.isArray(packet.values) && packet.values.length > 0 &&
      (packet.type === "number" || !packet.values.includes(null));
  return matrixPacket(packet) &&
    (packet.columns[0].type === "number" ||
      packet.columns.every(column => !column.values.includes(null)));
}
function validNumpyDtype(dtype, packet) {
  if (typeof dtype !== "string" ||
      !/^(?:u?int(?:8|16|32|64)|float(?:16|32|64)|bool|<U[1-9][0-9]{0,2})$/.test(dtype) ||
      !numpyPacket(packet)) return false;
  const type = packet.kind === "vector" ? packet.type : packet.columns[0].type;
  const values = packet.kind === "vector" ? packet.values :
    packet.columns.flatMap(column => column.values);
  if (dtype === "bool") return type === "boolean";
  if (dtype.startsWith("<U")) {
    const width = Number(dtype.slice(2));
    return type === "string" && width <= 512 &&
      values.every(value => typeof value === "string" && [...value].length <= width);
  }
  if (type !== "number") return false;
  if (dtype.startsWith("float"))
    return dtype !== "float16" || values.every(value => value === null || Math.abs(value) <= 65504);
  const limits = {int8:[-128,127],uint8:[0,255],int16:[-32768,32767],
    uint16:[0,65535],int32:[-2147483648,2147483647],uint32:[0,4294967295]};
  const [low, high] = limits[dtype] || (dtype === "uint64" ?
    [0, Number.MAX_SAFE_INTEGER] : [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);
  return values.every(value => Number.isSafeInteger(value) && value >= low && value <= high);
}
function validFactor(factor, packet) {
  if (!factor || typeof factor !== "object" || Array.isArray(factor) ||
      Object.keys(factor).sort().join(",") !== "levels,ordered" ||
      typeof factor.ordered !== "boolean" || !Array.isArray(factor.levels) ||
      factor.levels.length > 64 || new Set(factor.levels).size !== factor.levels.length ||
      !factor.levels.every(level => typeof level === "string" &&
        [...level].length <= 512 && !level.includes("\0")) ||
      !packet || packet.kind !== "vector" || packet.type !== "string" ||
      !Array.isArray(packet.values) ||
      !packet.values.every(value => value === null || factor.levels.includes(value)))
    return false;
  try { factor.levels.forEach(level => encodeURIComponent(level)); }
  catch (_) { return false; }
  return true;
}
function validate(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      Object.keys(snapshot).sort().join(",") !== "format,language,omitted,truncated,variables" ||
      ![FORMAT, FORMAT_V2].includes(snapshot.format) || !["python", "r"].includes(snapshot.language) ||
      !Array.isArray(snapshot.variables) || snapshot.variables.length > MAX_VARIABLES ||
      !Number.isSafeInteger(snapshot.omitted) || snapshot.omitted < 0 ||
      snapshot.omitted > MAX_INSPECTED ||
      typeof snapshot.truncated !== "boolean")
    throw Error("Invalid FlowStudio session snapshot.");
  const names = new Set();
  for (const entry of snapshot.variables) {
    const restoreAs = entry && Object.prototype.hasOwnProperty.call(entry, "restoreAs");
    const hasDtype = entry && Object.prototype.hasOwnProperty.call(entry, "dtype");
    const hasFactor = entry && Object.prototype.hasOwnProperty.call(entry, "factor");
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).sort().join(",") !== (restoreAs ?
          (hasDtype ? "dtype,name,restoreAs,value" :
            hasFactor ? "factor,name,restoreAs,value" : "name,restoreAs,value") : "name,value") ||
        !validName(entry.name) || names.has(entry.name) ||
        (restoreAs && (snapshot.format !== FORMAT_V2 ||
          !((snapshot.language === "python" && entry.restoreAs === "pandas" &&
             entry.value?.kind === "table") ||
            (snapshot.language === "python" && entry.restoreAs === "numpy" &&
             numpyPacket(entry.value)) ||
            (snapshot.language === "r" && entry.restoreAs === "matrix" &&
             matrixPacket(entry.value)) ||
            (snapshot.language === "r" && entry.restoreAs === "factor" &&
             hasFactor && validFactor(entry.factor, entry.value))))) ||
        (hasDtype && (entry.restoreAs !== "numpy" ||
          !validNumpyDtype(entry.dtype, entry.value))) ||
        (hasFactor && (entry.restoreAs !== "factor" ||
          !validFactor(entry.factor, entry.value))))
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
      if (result.origin !== undefined &&
          !((language === "python" && ["pandas", "ndarray"].includes(result.origin)) ||
            (language === "r" && ["matrix", "factor"].includes(result.origin))))
        throw Error("Unsupported session snapshot source type.");
      const entry = {name, value};
      if (result.origin === "pandas") {
        if (value.kind !== "table")
          throw Error("Pandas origin requires a Python typed table.");
        entry.restoreAs = "pandas";
      } else if (result.origin === "ndarray") {
        if (!numpyPacket(value))
          throw Error("NumPy origin requires a nonempty homogeneous vector or matrix packet.");
        entry.restoreAs = "numpy";
        if (result.dtype !== undefined) {
          if (!validNumpyDtype(result.dtype, value))
            throw Error("Unsupported or incompatible NumPy snapshot dtype.");
          entry.dtype = result.dtype;
        }
      } else if (result.origin === "matrix") {
        if (!matrixPacket(value))
          throw Error("R matrix origin requires a nonempty homogeneous typed table.");
        entry.restoreAs = "matrix";
      }
      if (result.origin === "factor") {
        if (!validFactor(result.factor, value))
          throw Error("R factor origin requires valid ordered levels and a typed string vector.");
        entry.restoreAs = "factor";
        entry.factor = {levels:[...result.factor.levels], ordered:result.factor.ordered};
      }
      const nextFormat = entry.restoreAs ? FORMAT_V2 : snapshot.format;
      const candidate = {...snapshot, format:nextFormat, variables:[...snapshot.variables, entry]};
      if (byteLength(JSON.stringify(candidate)) > MAX_BYTES) {
        snapshot.omitted++;
        continue;
      }
      snapshot.format = nextFormat;
      snapshot.variables.push(entry);
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
    try {
      result = entry.dtype || entry.factor ?
        await importValue(language, entry.name, entry.value, entry.restoreAs || null,
          entry.dtype || entry.factor) :
        await importValue(language, entry.name, entry.value, entry.restoreAs || null);
    }
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
        ". Only bounded scalar, vector and typed-table values are saved; pandas, NumPy ndarray, plain R matrix and base R factor identity are retained when supported.");
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
const api = Object.freeze({FORMAT, FORMAT_V2, MAX_BYTES, MAX_VARIABLES, validNumpyDtype, validate, capture, restore, create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioSessionSnapshot = api;
})(globalThis);
