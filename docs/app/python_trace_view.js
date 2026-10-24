/* Native CPython line trace viewer; never evaluates trace data as HTML. */
(function (global) {
"use strict";
const MAX_EVENTS = 256;
const MAX_LOCALS = 16;
function validate(data) {
  if (!data || typeof data !== "object" || typeof data.ok !== "boolean" ||
      typeof data.output !== "string" || data.output.length > 131072 ||
      !Array.isArray(data.events) || data.events.length > MAX_EVENTS ||
      typeof data.truncated !== "boolean") throw Error("Invalid Python trace response.");
  for (const entry of data.events) {
    if (!entry || !Number.isSafeInteger(entry.line) || entry.line < 1 ||
        typeof entry.function !== "string" || entry.function.length > 80 ||
        !Number.isFinite(entry.elapsed_ms) || entry.elapsed_ms < 0 ||
        !entry.locals || typeof entry.locals !== "object" ||
        Array.isArray(entry.locals) || Object.keys(entry.locals).length > MAX_LOCALS)
      throw Error("Invalid Python trace event.");
  }
  return data;
}
function lineOffset(source, line) {
  if (line < 1) return -1;
  let offset = 0;
  for (let i = 1; i < line; i++) {
    const end = /\r\n|\r|\n/g;
    end.lastIndex = offset;
    const match = end.exec(source);
    if (!match) return -1;
    offset = match.index + match[0].length;
  }
  return offset;
}
function render(target, source, data, doc = global.document) {
  validate(data);
  const snapshot = source.value;
  const section = doc.createElement("section");
  section.setAttribute("aria-label", "Native Python execution trace");
  const title = doc.createElement("h3");
  title.textContent = "Native Python execution trace";
  section.append(title);
  const output = doc.createElement("pre");
  output.textContent = data.output || "(No output)";
  section.append(output);
  const table = doc.createElement("table");
  const caption = doc.createElement("caption");
  caption.textContent = data.events.length + " traced lines" + (data.truncated ? " (truncated)" : "");
  table.append(caption);
  const head = doc.createElement("tr");
  for (const label of ["Line", "Function", "Elapsed (ms)", "Locals"]) {
    const cell = doc.createElement("th");
    cell.textContent = label;
    head.append(cell);
  }
  table.append(head);
  for (const event of data.events) {
    const row = doc.createElement("tr");
    const line = doc.createElement("td");
    const jump = doc.createElement("button");
    jump.type = "button";
    jump.textContent = String(event.line);
    jump.setAttribute("aria-label", "Go to Python source line " + event.line);
    jump.addEventListener("click", () => {
      if (source.value !== snapshot) return;
      const offset = lineOffset(snapshot, event.line);
      if (offset < 0) return;
      source.focus();
      source.setSelectionRange(offset, offset);
    });
    line.append(jump);
    row.append(line);
    for (const value of [event.function, String(event.elapsed_ms),
      Object.entries(event.locals).map(([name, item]) =>
        name + ": " + String(item.type || "unknown") +
        (typeof item.value === "string" ? " = " + item.value : "")).join("; ")]) {
      const cell = doc.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    table.append(row);
  }
  section.append(table);
  target.replaceChildren(section);
  return data.events.length;
}
const api = Object.freeze({validate, lineOffset, render});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioPythonTraceView = api;
})(globalThis);
