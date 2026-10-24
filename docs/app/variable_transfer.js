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
  if (!packet || typeof packet !== "object" || Array.isArray(packet) ||
      Object.keys(packet).sort().join(",") !== "kind,type,values" ||
      !["scalar", "vector"].includes(packet.kind) || !TYPES.includes(packet.type) ||
      !Array.isArray(packet.values) || packet.values.length > MAX_ITEMS ||
      (packet.kind === "scalar" && packet.values.length !== 1))
    throw Error("Unsupported transfer value: expected a typed scalar or vector.");
  for (const value of packet.values) {
    if (packet.type === "number" &&
        (typeof value !== "number" || !Number.isFinite(value) ||
         Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw Error("Transfer number is not finite or safe.");
    if (packet.type === "boolean" && typeof value !== "boolean")
      throw Error("Transfer boolean has an invalid value.");
    if (packet.type === "string") {
      if (typeof value !== "string" || value.length > 512 || value.includes("\0"))
        throw Error("Transfer string exceeds 512 characters.");
      try { encodeURIComponent(value); }
      catch (_) { throw Error("Transfer string contains invalid Unicode."); }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(packet)).length > MAX_BYTES)
    throw Error("Transfer payload exceeds 32 KiB.");
  return packet;
}
function create({direction, source, destination, button, python, rSession,
                 notice, isBusy, setBusy, generation, refresh = async () => {}}) {
  if (![direction, source, destination, button].every(Boolean) ||
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
      const target = route === "python-to-r" ? await rSession().importVariable(to, packet) :
        await python("import", to, packet);
      if (generation() !== epoch) throw Error("Session changed during transfer.");
      if (!target || target.ok !== true) throw Error(target?.output || "Destination rejected transfer.");
      await refresh(route === "python-to-r" ? "r" : "python");
      if (generation() !== epoch) throw Error("Session changed during transfer.");
      notice("Transferred " + from + " to " + to + " (" + packet.type + " " + packet.kind + ").");
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
