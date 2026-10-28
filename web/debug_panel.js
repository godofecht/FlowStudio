/* FlowStudio Python replay debugger.
 *
 * Marks breakpoints on the active Python buffer, executes the real Python
 * line trace (/api/trace/python - standard sys tracing in the persistent
 * kernel), and lets you scrub the recorded states: click a step to jump the
 * editor caret to that line and read the locals captured there.
 *
 * Honest scope: replay of a completed bounded execution, Python only.
 * This is not a live pause/resume kernel debugger and not a sandbox.
 */
(function (global) {
"use strict";
const MAX_BREAKPOINTS = 32;
const MAX_SOURCE = 131072;

/* Breakpoints live in the document model keyed per document id. */
function createBreakpointStore() {
  const byDoc = new Map();
  return {
    toggle(docId, line) {
      const lineValue = Math.trunc(Number(line));
      if (!docId || !Number.isSafeInteger(lineValue) || lineValue < 1) return false;
      const set = byDoc.get(docId) || new Set();
      const nowSet = byDoc.has(docId) ? set.has(lineValue) : false;
      if (!nowSet && set.size >= MAX_BREAKPOINTS) return false;
      if (nowSet) set.delete(lineValue); else set.add(lineValue);
      if (set.size) byDoc.set(docId, set); else byDoc.delete(docId);
      return true;
    },
    lines(docId) {
      const set = byDoc.get(docId);
      return set ? [...set].sort((a, b) => a - b) : [];
    },
    clear(docId) { byDoc.delete(docId); },
    count(docId) { const set = byDoc.get(docId); return set ? set.size : 0; }
  };
}

/* Pure: given a trace response, produce renderable steps. Breakpoint filters
 * keep first-hit semantics: steps before the first breakpoint still appear so
 * the user can see program start. */
function stepsFromTrace(payload, breakpoints) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.events))
    throw new Error("Malformed trace response.");
  const lines = new Set(Array.isArray(breakpoints) ? breakpoints : []);
  const steps = [];
  for (let index = 0; index < payload.events.length; index++) {
    const event = payload.events[index];
    if (!event || !Number.isSafeInteger(event.line) || event.line < 1 || events_bad(event)) continue;
    steps.push({
      // Use a dense UI index: invalid trace records are skipped, so the
      // original event offset is not a valid index into `steps`.
      index: steps.length,
      eventIndex: index,
      line: event.line,
      function: typeof event.function === "string" ? event.function.slice(0, 80) : "",
      elapsed_ms: typeof event.elapsed_ms === "number" ? event.elapsed_ms : null,
      locals: sanitizeLocals(event.locals),
      atBreakpoint: lines.has(event.line)
    });
  }
  return { steps, truncated: payload.truncated === true, ok: payload.ok !== false,
    output: typeof payload.output === "string" ? payload.output : "" };
}
function events_bad(event) { return event.line > 100000; }

function sanitizeLocals(locals) {
  if (!locals || typeof locals !== "object" || Array.isArray(locals)) return [];
  const entries = [];
  for (const name of Object.keys(locals)) {
    const entry = locals[name];
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string" ||
        name.startsWith("__")) continue;
    if (typeof entry.value === "string" && entry.value.length > 100) continue;
    entries.push({ name: name.slice(0, 80), type: entry.type.slice(0, 80),
      value: typeof entry.value === "string" ? entry.value : null });
    if (entries.length >= 16) break;
  }
  return entries;
}

function mount(document, options) {
  const {
    traceRoute = "/api/trace/python", fetchFn = null, getSource = () => "",
    getDocId = () => null, getBreakpoints = () => [], onStep = () => {}, notice = () => {},
    node = null
  } = options || {};
  if (!node) throw new TypeError("Debug panel needs a panel node.");
  if (typeof fetchFn !== "function") throw new TypeError("Debug panel needs a fetch function.");
  if (typeof getSource !== "function" || typeof getBreakpoints !== "function")
    throw new TypeError("Debug panel needs getSource and getBreakpoints.");

  let steps = [];
  let position = -1;
  let busy = false;
  let revision = 0;
  let traceDocId = null;

  function describeStep(step, node) {
    const row = document.createElement("div");
    row.className = "debug-step" + (step.atBreakpoint ? " debug-step-here" : "");
    const label = document.createElement("button");
    label.type = "button";
    label.textContent = "#" + (step.index + 1) + "  line " + step.line +
      (step.function ? "  " + step.function : "") +
      (step.elapsed_ms !== null ? "  " + step.elapsed_ms + " ms" : "") +
      (step.atBreakpoint ? "  ● bp" : "");
    label.title = "Jump to line " + step.line;
    label.dataset.stepIndex = String(step.index);
    label.addEventListener("click", () => {
      if (getDocId() !== traceDocId) {
        notice("This trace belongs to another editor buffer; run the trace again.", "error");
        return;
      }
      position = step.index;
      onStep(step);
      renderLocals(document, node, steps[position]);
      markActive(node, step.index);
    });
    row.append(label);
    return row;
  }

  function markActive(node, index) {
    for (const child of node.querySelectorAll(".debug-step"))
      child.classList.toggle("debug-step-active",
        Number(child.dataset.stepIndex) === index);
  }

  function renderLocals(document, node, step) {
    const pane = node && node.querySelector ? node.querySelector(".debug-locals") : null;
    if (!pane) return;
    pane.replaceChildren();
    if (!step) { pane.append(Object.assign(document.createElement("p"),
      { className: "muted", textContent: "Select a step to inspect its locals." })); return; }
    const title = document.createElement("p");
    title.textContent = "Locals at step #" + (step.index + 1) + " (line " + step.line + ")";
    pane.append(title);
    if (!step.locals.length) {
      pane.append(Object.assign(document.createElement("p"),
        { className: "muted", textContent: "No builtin-typed locals captured here." }));
      return;
    }
    const table = document.createElement("table");
    table.setAttribute("aria-label", "Locals at the selected step");
    for (const entry of step.locals) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = entry.name;
      const type = document.createElement("td");
      type.textContent = entry.type;
      const value = document.createElement("td");
      value.textContent = entry.value === null ? "—" : entry.value;
      row.append(name, type, value);
      table.append(row);
    }
    pane.append(table);
    const warn = document.createElement("p");
    warn.className = "muted";
    warn.textContent = "Only builtin scalars are previewed; complex values show type only.";
    pane.append(warn);
  }

  function render(node, result) {
    const list = node && node.querySelector ? node.querySelector(".debug-steps") : null;
    const summary = node && node.querySelector ? node.querySelector(".debug-summary") : null;
    if (!list) return;
    list.replaceChildren();
    if (summary)
      summary.textContent = result.truncated ? "Trace truncated; first " + steps.length + " steps." :
      steps.length + " steps recorded" + (result.ok ? "" : " (execution failed; see console)");
    for (const step of steps) {
      const row = describeStep(step, node);
      row.dataset.stepIndex = String(step.index);
      list.append(row);
    }
    renderLocals(document, node, steps[position]);
  }

  return Object.freeze({
    async run() {
      if (busy) return null;
      const source = String(getSource() || "");
      if (!source.trim()) { notice("Debug needs a non-empty Python buffer.", "error"); return null; }
      if (source.length > MAX_SOURCE) {
        notice("Buffers above 128 KiB cannot be traced on the local server.", "error");
        return null;
      }
      const breakpoints = getBreakpoints();
      const requestedDocId = getDocId();
      busy = true;
      const token = ++revision;
      notice("Running Python with the real line tracer…");
      try {
        const response = await fetchFn(traceRoute, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
          body: source
        });
        if (token !== revision) return null;
        const text = await response.text();
        const payload = JSON.parse(text);
        const result = stepsFromTrace(payload, breakpoints);
        if (token !== revision) return null;
        if (getDocId() !== requestedDocId || String(getSource() || "") !== source) {
          notice("Editor buffer changed while tracing; discard the stale trace and run again.", "error");
          return null;
        }
        traceDocId = requestedDocId;
        steps = result.steps;
        position = steps.length ? 0 : -1;
        render(node, result);
        return result;
      } catch (error) {
        notice("Trace failed: " + String(error.message || error).slice(0, 300), "error");
        return null;
      } finally {
        busy = false;
      }
    },
    current() { return position >= 0 ? steps[position] : null; },
    next() { if (position < steps.length - 1) { position++; return steps[position]; } return null; },
    previous() { if (position > 0) { position--; return steps[position]; } return null; },
    total() { return steps.length; },
    at() { return position; },
    goTo(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= steps.length) return null;
      position = index;
      return steps[index];
    }
  });
}

const api = { createBreakpointStore, stepsFromTrace, sanitizeLocals, mount, MAX_BREAKPOINTS };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioDebugPanel = api;
})(globalThis);
