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
  if (table.offset !== undefined) {
    if (!Number.isSafeInteger(table.offset) || table.offset < 0 ||
        table.offset > table.totalRows || table.rows.length > table.totalRows - table.offset ||
        !(table.nextOffset === null ||
          (Number.isSafeInteger(table.nextOffset) && table.rows.length > 0 &&
           table.nextOffset === table.offset + table.rows.length &&
           table.nextOffset < table.totalRows)))
      throw Error("Invalid table slice.");
  } else if (table.nextOffset !== undefined) throw Error("Invalid table slice.");
  return table;
}
function create({target, document, dataApi, fetchPage = null}) {
  if (!dataApi || typeof dataApi.viewRows !== "function") throw TypeError("Data viewer API required.");
  if (fetchPage !== null && typeof fetchPage !== "function") throw TypeError("Invalid table page loader.");
  let current = null;
  function clear() {
    if (current) {
      current._alive = false;
      if (target.firstChild === current) target.replaceChildren();
    }
    current = null;
  }
  function show(name, response) {
    let tableData = validate(response);
    clear();
    const holder = document.createElement("div");
    holder._alive = true;
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
    const exportButton = document.createElement("button");
    const exportStatus = document.createElement("span");
    exportStatus.setAttribute("role", "status");
    previous.textContent = "Previous page";
    next.textContent = "Next page";
    exportButton.textContent = "Export loaded CSV";
    exportButton.title = "Download only the loaded table slice with current filter and sort; never the complete kernel variable.";
    let page = 0, sortColumn = null, descending = false, loading = false;
    const history = [];
    const pageable = fetchPage !== null && Number.isSafeInteger(tableData.offset);
    function render() {
      const view = dataApi.viewRows(tableData, {filter:search.value, page, sortColumn, descending});
      page = view.page;
      const priorSlice = pageable && history.length > 0;
      const nextSlice = pageable && Number.isSafeInteger(tableData.nextOffset);
      previous.disabled = loading || (page === 0 && !priorSlice);
      next.disabled = loading || (page >= view.pageCount - 1 && !nextSlice);
      exportButton.disabled = loading;
      const offset = pageable ? tableData.offset : 0;
      const loaded = tableData.rows.length;
      const range = loaded ? (offset + 1) + "-" + (offset + loaded) : "empty";
      summary.textContent = view.total + " matching in loaded rows " + range +
        " of " + tableData.totalRows + ", page " + (page + 1) + "/" + view.pageCount +
        (pageable ? "; filter/sort apply only to the loaded slice" :
          (tableData.truncated ? "; preview truncated" : ""));
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
    async function move(direction) {
      if (loading || !holder._alive || current !== holder) return;
      const view = dataApi.viewRows(tableData, {filter:search.value, page, sortColumn, descending});
      if (direction > 0 && page < view.pageCount - 1) { page++; render(); return; }
      if (direction < 0 && page > 0) { page--; render(); return; }
      if (!pageable) return;
      const offset = direction > 0 ? tableData.nextOffset : history[history.length - 1];
      if (!Number.isSafeInteger(offset)) return;
      loading = true;
      render();
      try {
        const response = await fetchPage(name, offset);
        if (!holder._alive || current !== holder) return;
        const nextTable = validate(response);
        if (nextTable.offset !== offset || nextTable.totalRows !== tableData.totalRows ||
            JSON.stringify(nextTable.columns) !== JSON.stringify(tableData.columns))
          throw Error("R table changed while paging; reopen the variable.");
        if (direction > 0) history.push(tableData.offset);
        else history.pop();
        tableData = nextTable;
        page = direction < 0 ? Math.max(0, Math.ceil(tableData.rows.length / 50) - 1) : 0;
        // A filter/sort on one slice cannot be represented as a global query.
        search.value = "";
        sortColumn = null;
        descending = false;
        exportStatus.textContent = "";
      } catch (error) {
        if (holder._alive && current === holder)
          exportStatus.textContent = "Table paging failed: " + String(error.message || error);
      } finally {
        loading = false;
        if (holder._alive && current === holder) render();
      }
    }
    search.addEventListener("input", () => { page = 0; render(); });
    previous.addEventListener("click", () => { void move(-1); });
    next.addEventListener("click", () => { void move(1); });
    exportButton.addEventListener("click", () => {
      try {
        const result = dataApi.exportCSV(tableData, {filter:search.value,
          sortColumn, descending});
        dataApi.downloadCSV(result.csv, name + "-loaded-slice", document);
        exportStatus.textContent = "Exported " + result.count +
          " loaded, filtered rows; this is not a full kernel dataset export.";
      } catch (error) {
        exportStatus.textContent = "CSV export failed: " + String(error.message || error);
      }
    });
    holder.append(heading, search, summary, grid, previous, next, exportButton, exportStatus);
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
