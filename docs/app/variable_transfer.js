/* Explicit, bounded transfer of plain scalar/vector values between browser Python and R. */
(function (global) {
"use strict";
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const TYPES = ["number", "boolean", "string"];
const MAX_ITEMS = 256;
const MAX_BYTES = 32768;
function validName(name) {
  return typeof name === "string" && NAME.test(name);
}
function validate(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet))
    throw Error("Unsupported transfer packet.");
  if (packet.kind === "table") {
    if (Object.keys(packet).sort().join(",") !== "columns,kind" ||
        !Array.isArray(packet.columns) || packet.columns.length < 1 ||
        packet.columns.length > 16)
      throw Error("Table transfer requires 1–16 typed columns.");
    const seen = new Set();
    let rows = null;
    for (const column of packet.columns) {
      if (!column || typeof column !== "object" || Array.isArray(column) ||
          Object.keys(column).sort().join(",") !== "name,type,values" ||
          !validName(column.name) || seen.has(column.name) ||
          !TYPES.includes(column.type) || !Array.isArray(column.values) ||
          column.values.length > 128 || (rows !== null && rows !== column.values.length))
        throw Error("Invalid table column, name or row count.");
      seen.add(column.name);
      rows = column.values.length;
      validateValues(column.type, column.values, true);
    }
  } else {
    if (Object.keys(packet).sort().join(",") !== "kind,type,values" ||
        !["scalar", "vector"].includes(packet.kind) || !TYPES.includes(packet.type) ||
        !Array.isArray(packet.values) || packet.values.length > MAX_ITEMS ||
        (packet.kind === "scalar" && packet.values.length !== 1))
      throw Error("Unsupported transfer value: expected a typed scalar or vector.");
    validateValues(packet.type, packet.values, packet.kind === "vector");
  }
  if (new TextEncoder().encode(JSON.stringify(packet)).length > MAX_BYTES)
    throw Error("Transfer payload exceeds 32 KiB.");
  return packet;
}
function validateValues(type, values, allowMissing) {
  for (const value of values) {
    if (value === null && allowMissing) continue;
    if (type === "number" &&
        (typeof value !== "number" || !Number.isFinite(value) ||
         Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw Error("Transfer number is not finite or safe.");
    if (type === "boolean" && typeof value !== "boolean")
      throw Error("Transfer boolean has an invalid value.");
    if (type === "string") {
      if (typeof value !== "string" || value.length > 512 || value.includes("\0"))
        throw Error("Transfer string exceeds 512 characters.");
      try { encodeURIComponent(value); }
      catch (_) { throw Error("Transfer string contains invalid Unicode."); }
    }
  }
}
function create({direction, source, destination, button, pandas = null, numpy = null, rMatrix = null, python, rSession,
                 notice, isBusy, setBusy, generation, refresh = async () => {}}) {
  if (![direction, source, destination, button].every(Boolean) ||
      (pandas !== null && (typeof pandas !== "object" ||
        (pandas.checked !== undefined && typeof pandas.checked !== "boolean"))) ||
      (numpy !== null && (typeof numpy !== "object" ||
        (numpy.checked !== undefined && typeof numpy.checked !== "boolean"))) ||
      (rMatrix !== null && (typeof rMatrix !== "object" ||
        (rMatrix.checked !== undefined && typeof rMatrix.checked !== "boolean"))) ||
      [python, rSession, notice, isBusy, setBusy, generation, refresh].some(fn => typeof fn !== "function"))
    throw TypeError("Variable transfer requires controls and runtime callbacks.");
  async function transfer() {
    if (button.disabled || isBusy()) return false;
    const route = direction.value;
    const from = source.value.trim(), to = destination.value.trim() || from;
    if (!["python-to-r", "r-to-python"].includes(route) ||
        !validName(from) || !validName(to)) {
      notice("Use a shared Python/R identifier (letter, then letters, digits or underscore).");
      return false;
    }
    const epoch = generation();
    button.disabled = true;
    setBusy(true);
    notice("Transferring " + from + " (" + route + ")…");
    try {
      const origin = route === "python-to-r" ? await python("export", from) :
        await rSession().exportVariable(from);
      if (generation() !== epoch) throw Error("Session changed during transfer.");
      if (!origin || origin.ok !== true) throw Error(origin?.output || "Source variable could not be exported.");
      const packet = validate(origin.value);
      const asRMatrix = route === "python-to-r" && rMatrix?.checked === true;
      const asPandas = route === "r-to-python" && pandas?.checked === true;
      const asNumpy = route === "r-to-python" && numpy?.checked === true;
      if (asPandas && asNumpy)
        throw Error("Choose either pandas or NumPy destination.");
      if (asPandas && packet.kind !== "table")
        throw Error("Pandas destination requires an R data.frame.");
      if (asNumpy) {
        const supported = packet.kind === "vector" ?
          packet.values.length > 0 && (packet.type === "number" || !packet.values.includes(null)) :
          packet.kind === "table" && packet.columns[0].values.length > 0 &&
          packet.columns.every(column => column.type === packet.columns[0].type &&
            (column.type === "number" || !column.values.includes(null)));
        if (!supported)
          throw Error("NumPy destination requires a nonempty numeric or nonmissing boolean/string R vector, or homogeneous R data.frame without missing boolean/string cells.");
      }
      if (asRMatrix && (packet.kind !== "table" ||
          packet.columns[0].values.length < 1 ||
          !packet.columns.every(column => column.type === packet.columns[0].type)))
        throw Error("R matrix destination requires a nonempty homogeneous Python table or 2D NumPy ndarray.");
      const target = route === "python-to-r" ? await rSession().importVariable(to, packet, asRMatrix ? {asMatrix:true} : undefined) :
        await python(asNumpy ? "import-numpy" : asPandas ? "import-pandas" : "import", to, packet);
      if (generation() !== epoch) throw Error("Session changed during transfer.");
      if (!target || target.ok !== true) throw Error(target?.output || "Destination rejected transfer.");
      await refresh(route === "python-to-r" ? "r" : "python");
      if (generation() !== epoch) throw Error("Session changed during transfer.");
      notice("Transferred " + from + " to " + to + " (" + (packet.kind === "table" ? packet.columns.length + " table columns" : packet.type + " " + packet.kind) + (asRMatrix ? " as R matrix" : asPandas ? " as pandas DataFrame" : asNumpy ? " as NumPy ndarray" : "") + ").");
      return true;
    } catch (error) {
      if (generation() === epoch) notice("Variable transfer failed: " + String(error.message || error).slice(0, 300));
      return false;
    } finally {
      button.disabled = false;
      if (generation() === epoch) setBusy(false);
    }
  }
  button.addEventListener("click", () => { void transfer(); });
  return Object.freeze({transfer});
}
const api = Object.freeze({validName, validate, create, MAX_ITEMS, MAX_BYTES});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioVariableTransfer = api;
})(globalThis);
