/* The data viewer for Flow session values, like R's View().
 *
 * Clicking an array or struct in the Environment pane asks the server for
 * that variable as a table (POST /api/flow/session/view, which runs
 * src/flow_session.py view). Struct fields are columns and array elements
 * are rows; a nested struct field becomes columns such as `a.x`. The table
 * opens in the Data view's grid (web/ide_data_view.js), which sorts, filters,
 * pages and exports. The server sends at most 1,000 rows and 64 columns, and
 * the grid says so when a value is larger. */
(function (root) {
"use strict";

const ROUTE = "/api/flow/session/view";
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const NOTE_ID = "dataGridNote";

function formatCount(n) { return Number(n).toLocaleString("en-US"); }

/* The server reply as a dataset for the grid, or an Error. */
function tableDataset(reply) {
  if (!reply || reply.ok !== true) return new Error(reply && reply.error ? String(reply.error) : "No table for this value.");
  if (!Array.isArray(reply.columns) || !Array.isArray(reply.rows) || !reply.columns.length)
    return new Error("The table reply is malformed.");
  const width = reply.columns.length;
  const rows = reply.rows.filter(Array.isArray).map(row => {
    const cells = row.slice(0, width).map(value => value == null ? "" : String(value));
    while (cells.length < width) cells.push("");
    return cells;
  });
  const total = Number.isFinite(Number(reply.total)) ? Number(reply.total) : rows.length;
  return {
    columns: reply.columns.map(String), rows, total,
    truncated: reply.truncated === true || total > rows.length,
    hiddenColumns: Number(reply.hiddenColumns) > 0 ? Number(reply.hiddenColumns) : 0,
    type: String(reply.type || ""), name: String(reply.name || "")
  };
}

/* The line under the grid title: language, type and size. */
function metaText(dataset) {
  const columns = dataset.columns.length + dataset.hiddenColumns;
  return "Flow  " + dataset.type + "  " + formatCount(dataset.total) + (dataset.total === 1 ? " row" : " rows") +
    " × " + formatCount(columns) + (columns === 1 ? " column" : " columns");
}

/* A note when the grid holds less than the whole value, else "". */
function noteText(dataset) {
  const parts = [];
  if (dataset.truncated)
    parts.push("Showing the first " + formatCount(dataset.rows.length) + " of " + formatCount(dataset.total) + " rows.");
  if (dataset.hiddenColumns)
    parts.push(formatCount(dataset.hiddenColumns) + (dataset.hiddenColumns === 1 ? " column is" : " columns are") +
      " not shown.");
  return parts.join(" ");
}

function create(options = {}) {
  const request = options.request || (typeof root.fetch === "function" ? (url, init) => root.fetch(url, init) : null);
  const doc = options.doc || root.document;
  const status = options.status || ((message, kind) => {
    const app = root.FlowStudioApp;
    if (app && typeof app.status === "function") app.status(message, kind);
  });
  const dataView = options.dataView || (() => root.FlowStudioDataView && root.FlowStudioDataView.instance);

  async function fetchTable(name) {
    if (!NAME.test(String(name || ""))) throw new Error("Not a Flow variable name.");
    if (!request) throw new Error("No network access.");
    const response = await request(ROUTE, { method: "POST", body: name,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" } });
    const text = await response.text();
    let reply = null;
    try { reply = JSON.parse(text); } catch (_) { reply = { ok: false, error: text.slice(0, 300) || "HTTP " + response.status }; }
    const dataset = tableDataset(reply);
    if (dataset instanceof Error) throw dataset;
    return dataset;
  }

  /* The note sits under the grid header and leaves when the grid closes, so
   * an R or Python table opened later never shows it. */
  function showNote(text) {
    const view = dataView();
    const dialog = view && view.dialog;
    if (!dialog || !doc) return;
    let note = doc.getElementById(NOTE_ID);
    if (!text) { if (note) note.remove(); return; }
    if (!note) {
      note = doc.createElement("p");
      note.id = NOTE_ID;
      note.className = "dg-note";
      note.setAttribute("role", "note");
      const head = dialog.querySelector(".dg-head");
      if (head && head.nextSibling) dialog.insertBefore(note, head.nextSibling);
      else dialog.append(note);
      dialog.addEventListener("close", () => note.remove(), { once: true });
    }
    note.textContent = text;
  }

  async function open(name) {
    const view = dataView();
    if (!view || typeof view.showGrid !== "function") {
      status("The data grid is not available.", "error");
      return false;
    }
    status("Loading " + name + " …");
    try {
      const dataset = await fetchTable(name);
      view.showGrid({ columns: dataset.columns, rows: dataset.rows }, dataset.name || name, metaText(dataset));
      showNote(noteText(dataset));
      status("Opened " + name + " in the data viewer.", "ok");
      return true;
    } catch (error) {
      status("Flow data: " + (error.message || String(error)), "error");
      return false;
    }
  }

  return Object.freeze({ open, fetchTable });
}

const api = { create, tableDataset, metaText, noteText, ROUTE };
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioFlowDataModule = api;
if (typeof document !== "undefined") root.FlowStudioFlowData = create();
})(typeof globalThis !== "undefined" ? globalThis : this);
