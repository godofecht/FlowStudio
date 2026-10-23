/* Bounded, accessible snapshots of tabular variables from the active kernel. */
(function (global) {
"use strict";
const MAX_ROWS = 200, MAX_COLUMNS = 32, MAX_CELL = 160;
function validate(response) {
  if (!response || response.ok !== true || !response.table) throw Error(response?.output || "Table unavailable.");
  const table = response.table;
  if (!Array.isArray(table.columns) || !table.columns.length || table.columns.length > MAX_COLUMNS ||
      !Array.isArray(table.rows) || table.rows.length > MAX_ROWS ||
      !Number.isSafeInteger(table.totalRows) || table.totalRows < table.rows.length ||
      typeof table.truncated !== "boolean") throw Error("Invalid table response.");
  if (!table.columns.every(x => typeof x === "string" && x.length <= MAX_CELL) ||
      !table.rows.every(row => Array.isArray(row) && row.length === table.columns.length &&
        row.every(x => typeof x === "string" && x.length <= MAX_CELL)))
    throw Error("Invalid table cell.");
  return table;
}
function create({target, document, dataApi}) {
  if (!dataApi || typeof dataApi.viewRows !== "function") throw TypeError("Data viewer API required.");
  let current = null;
  function clear() {
    if (current && target.firstChild === current) target.replaceChildren();
    current = null;
  }
  function show(name, response) {
    const tableData = validate(response);
    const holder = document.createElement("div");
    holder.setAttribute("aria-label", "Environment table snapshot");
    const heading = document.createElement("h3");
    heading.textContent = "Snapshot: " + name;
    const search = document.createElement("input");
    search.type = "search";
    search.maxLength = 256;
    search.setAttribute("aria-label", "Filter table rows");
    const summary = document.createElement("p");
    summary.setAttribute("role", "status");
    const grid = document.createElement("div");
    grid.style.overflow = "auto";
    const previous = document.createElement("button"), next = document.createElement("button");
    previous.textContent = "Previous page";
    next.textContent = "Next page";
    let page = 0, sortColumn = null, descending = false;
    function render() {
      const view = dataApi.viewRows(tableData, {filter:search.value, page, sortColumn, descending});
      page = view.page;
      previous.disabled = page === 0;
      next.disabled = page >= view.pageCount - 1;
      summary.textContent = view.total + " matching of " + tableData.totalRows + " rows (" +
        tableData.rows.length + " sampled), page " + (page + 1) + "/" + view.pageCount +
        (tableData.truncated ? "; preview truncated" : "");
      const element = document.createElement("table"), header = document.createElement("tr");
      tableData.columns.forEach((label, index) => {
        const th = document.createElement("th"), button = document.createElement("button");
        button.textContent = label + (sortColumn === index ? (descending ? " ▼" : " ▲") : " ↕");
        button.addEventListener("click", () => {
          descending = sortColumn === index ? !descending : false;
          sortColumn = index; page = 0; render();
        });
        th.append(button); header.append(th);
      });
      element.append(header);
      for (const item of view.rows) {
        const row = document.createElement("tr");
        for (const value of item.values) {
          const cell = document.createElement("td");
          cell.textContent = value === "" ? "—" : value;
          row.append(cell);
        }
        element.append(row);
      }
      grid.replaceChildren(element);
    }
    search.addEventListener("input", () => { page = 0; render(); });
    previous.addEventListener("click", () => { page--; render(); });
    next.addEventListener("click", () => { page++; render(); });
    holder.append(heading, search, summary, grid, previous, next);
    target.replaceChildren(holder);
    current = holder;
    render();
    return tableData.rows.length;
  }
  return Object.freeze({show, clear});
}
const api = Object.freeze({create, validate});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioEnvironmentData = api;
})(globalThis);
