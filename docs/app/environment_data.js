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
// Export every bounded native R *preview* row; never claim raw-data fidelity.
async function collectRPreviewCSV(name, fetchPage, dataApi, alive = () => true) {
  if (typeof fetchPage !== "function" || !dataApi ||
      typeof dataApi.exportCSV !== "function" ||
      !Number.isSafeInteger(dataApi.MAX_BYTES) || dataApi.MAX_BYTES < 1)
    throw TypeError("Native R preview export requires a bounded CSV API.");
  const maxBytes = Math.min(dataApi.MAX_BYTES, 8 * 1024 * 1024);
  const encoder = new TextEncoder();
  let columns = null, totalRows = null, offset = 0, count = 0;
  let header = "", bytes = 0, pages = 0;
  const parts = [];
  while (true) {
    if (!alive()) throw Error("R preview export cancelled.");
    if (++pages > 512) throw Error("R preview export exceeds 512 kernel pages.");
    const table = validate(await fetchPage(name, offset));
    if (!alive()) throw Error("R preview export cancelled.");
    if (table.offset !== offset) throw Error("R preview export has a missing or repeated row slice.");
    if (totalRows === null) {
      totalRows = table.totalRows;
      if (totalRows > 25000) throw Error("R preview export exceeds 25,000 rows.");
      columns = table.columns;
      header = dataApi.exportCSV({columns, rows:[]}).csv;
      bytes = encoder.encode(header).length;
      if (bytes > maxBytes) throw Error("R preview CSV exceeds the 8 MiB export bound.");
      parts.push(header);
    } else if (table.totalRows !== totalRows ||
               JSON.stringify(table.columns) !== JSON.stringify(columns)) {
      throw Error("R table changed during preview export; reopen and retry.");
    }
    if (!table.rows.length && count < totalRows)
      throw Error("R preview export cannot advance past an empty kernel page.");
    const csv = dataApi.exportCSV({columns, rows:table.rows}).csv;
    if (!csv.startsWith(header)) throw Error("R preview CSV header changed.");
    const content = csv.slice(header.length);
    bytes += encoder.encode(content).length;
    if (bytes > maxBytes) throw Error("R preview CSV exceeds the 8 MiB export bound.");
    parts.push(content);
    count += table.rows.length;
    if (count > totalRows) throw Error("R preview export row count changed.");
    if (table.nextOffset === null) {
      if (count !== totalRows) throw Error("R preview export ended before the final row.");
      return {csv:parts.join(""), count, previewOnly:true};
    }
    if (table.nextOffset !== count)
      throw Error("R preview export has a missing or repeated row slice.");
    offset = table.nextOffset;
  }
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
    const jumpInput = document.createElement("input");
    jumpInput.type = "text";
    jumpInput.inputMode = "numeric";
    jumpInput.maxLength = 10;
    jumpInput.setAttribute("aria-label", "Jump to R row");
    const exportAllButton = document.createElement("button");
    exportAllButton.textContent = "Export R preview rows";
    exportAllButton.title = "Fetch at most 25,000 R preview rows and 8 MiB. Values are shortened to 160 characters and only the first 32 columns are included; this is not a raw or atomic snapshot.";
    const jumpButton = document.createElement("button");
    jumpButton.textContent = "Go to row";
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
      exportAllButton.disabled = loading;
      jumpInput.disabled = loading;
      jumpButton.disabled = loading;
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
    async function loadSlice(offset, requestedPage, historyAction) {
      loading = true;
      render();
      try {
        const response = await fetchPage(name, offset);
        if (!holder._alive || current !== holder) return;
        const nextTable = validate(response);
        if (nextTable.offset !== offset || nextTable.totalRows !== tableData.totalRows ||
            JSON.stringify(nextTable.columns) !== JSON.stringify(tableData.columns))
          throw Error("R table changed while paging; reopen the variable.");
        if (historyAction === "push") {
          if (history.length >= 128) history.shift();
          history.push({offset:tableData.offset, page});
        } else if (historyAction === "pop") history.pop();
        tableData = nextTable;
        page = requestedPage;
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
    async function move(direction) {
      if (loading || !holder._alive || current !== holder) return;
      const view = dataApi.viewRows(tableData, {filter:search.value, page, sortColumn, descending});
      if (direction > 0 && page < view.pageCount - 1) { page++; render(); return; }
      if (direction < 0 && page > 0) { page--; render(); return; }
      if (!pageable) return;
      const prior = history[history.length - 1];
      const offset = direction > 0 ? tableData.nextOffset : prior?.offset;
      if (!Number.isSafeInteger(offset)) return;
      await loadSlice(offset, direction > 0 ? 0 : prior.page,
        direction > 0 ? "push" : "pop");
    }
    async function jumpToRow() {
      if (!pageable || loading || !holder._alive || current !== holder) return;
      const raw = jumpInput.value.trim();
      if (!/^[1-9][0-9]{0,9}$/.test(raw) ||
          Number(raw) > tableData.totalRows || Number(raw) > 10000000000) {
        exportStatus.textContent = "Enter a whole row number between 1 and " +
          tableData.totalRows + ".";
        return;
      }
      const row = Number(raw);
      if (row > tableData.offset && row <= tableData.offset + tableData.rows.length) {
        search.value = "";
        sortColumn = null;
        descending = false;
        page = Math.floor((row - 1 - tableData.offset) / 50);
        exportStatus.textContent = "";
        render();
        return;
      }
      // The R kernel accepts arbitrary offsets; start exactly at the
      // requested row even when response-size limits shorten a 200-row slice.
      await loadSlice(row - 1, 0, "push");
    }
    search.addEventListener("input", () => { page = 0; render(); });
    previous.addEventListener("click", () => { void move(-1); });
    next.addEventListener("click", () => { void move(1); });
    jumpButton.addEventListener("click", () => { void jumpToRow(); });
    jumpInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); void jumpToRow(); }
    });
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
    async function exportAllRPreview() {
      if (!pageable || loading || !holder._alive || current !== holder) return;
      loading = true;
      exportStatus.textContent = "Fetching bounded R preview rows…";
      render();
      try {
        const result = await collectRPreviewCSV(name, fetchPage, dataApi,
          () => holder._alive && current === holder);
        if (!holder._alive || current !== holder) return;
        dataApi.downloadCSV(result.csv, name + "-all-preview-rows", document);
        exportStatus.textContent = "Exported " + result.count +
          " preview rows. Values may be shortened to 160 characters; only the first 32 columns are included. Not a raw dataset export or an atomic snapshot.";
      } catch (error) {
        if (holder._alive && current === holder)
          exportStatus.textContent = "R preview export failed: " + String(error.message || error);
      } finally {
        loading = false;
        if (holder._alive && current === holder) render();
      }
    }
    exportAllButton.addEventListener("click", () => { void exportAllRPreview(); });
    holder.append(heading, search, summary, grid, previous, next, exportButton, exportStatus);
    if (pageable) holder.append(jumpInput, jumpButton, exportAllButton);
    target.replaceChildren(holder);
    current = holder;
    render();
    return tableData.rows.length;
  }
  return Object.freeze({show, clear});
}
const api = Object.freeze({create, validate, collectRPreviewCSV});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioEnvironmentData = api;
})(globalThis);
