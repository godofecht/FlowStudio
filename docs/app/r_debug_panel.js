/* Native R cooperative top-level expression stepping; no simulated evaluator. */
(function (global) {
"use strict";
const STATES = new Set(["idle", "paused", "done", "error"]);
function format(result) {
  if (!result || !STATES.has(result.state) || typeof result.ok !== "boolean" ||
      typeof result.output !== "string" || result.output.length > 20000 ||
      !Number.isSafeInteger(result.index) || !Number.isSafeInteger(result.total))
    throw Error("Invalid native R debugger state.");
  const lines = ["R expression debugger: " + result.state +
    (result.ok ? "" : " (error)")];
  if (result.executed_line !== null) lines.push("Executed expression at line " + result.executed_line);
  if (result.next_line !== null) lines.push("Next expression at line " + result.next_line);
  lines.push("Expression " + Math.min(result.index, result.total) + " of " + result.total);
  if (result.output) lines.push("Output:\n" + result.output);
  return lines.join("\n");
}
function create({native, source, language, runtime, startButton, stepButton,
                 continueButton, targetLine, stopButton, statusButton, target, notice}) {
  if (!native || !source || !language || !runtime || !startButton || !stepButton ||
      !continueButton || !targetLine || !stopButton || !statusButton || !target)
    throw Error("Missing R debugger controls.");
  const supported = native.available();
  let state = "idle", pending = false;
  function update() {
    const enabled = supported && language.value === "r" && runtime.value === "native";
    startButton.disabled = !enabled || pending || state === "paused";
    stepButton.disabled = !enabled || pending || state !== "paused";
    continueButton.disabled = !enabled || pending || state !== "paused";
    targetLine.disabled = !enabled || pending || state !== "paused";
    stopButton.disabled = !enabled || pending || state === "idle";
    statusButton.disabled = !enabled || pending;
  }
  async function execute(action) {
    if (pending || !supported || language.value !== "r" || runtime.value !== "native")
      return false;
    if ((action === "step" || action === "continue") && state !== "paused") return false;
    pending = true;
    update();
    try {
      const line = action === "continue" ? targetLine.value.trim() : "";
      if (line && (line.length > 447 ||
          !/^[1-9][0-9]{0,5}(?:,[1-9][0-9]{0,5}){0,63}$/.test(line)))
        throw Error("R continue targets must be 1 to 64 comma-separated positive source lines.");
      const result = action === "start" ?
        await native.debugRStart(source.value) :
        await native.debugRCommand(action, line);
      state = result.state;
      target.textContent = format(result);
      if (notice) notice("Native R expression debugger: " + state + ".");
      return result.ok;
    } catch (error) {
      target.textContent = "Native R debugger error: " + String(error.message || error);
      if (notice) notice(target.textContent);
      return false;
    } finally {
      pending = false;
      update();
    }
  }
  startButton.addEventListener("click", () => { void execute("start"); });
  stepButton.addEventListener("click", () => { void execute("step"); });
  continueButton.addEventListener("click", () => { void execute("continue"); });
  stopButton.addEventListener("click", () => { void execute("stop"); });
  statusButton.addEventListener("click", () => { void execute("status"); });
  language.addEventListener("change", update);
  runtime.addEventListener("change", update);
  if (!supported) target.textContent = "Native R debugger requires FlowStudio on localhost:8751.";
  update();
  return Object.freeze({execute, update});
}
const api = Object.freeze({format, create});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioRDebugPanel = api;
})(globalThis);
