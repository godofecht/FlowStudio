/* FlowStudio Data view (RStudio's environment data viewer, VS Code's data
 * wrangler shape). The sidebar lists data frames that live in the R and
 * Python sessions and the CSV/TSV files of the open folder. Either opens in a
 * full data grid with sorting, filtering, paging and CSV export. Session data
 * comes from the existing intent-gated inspect and table routes; folder files
 * are read by the browser and never uploaded. */
(function (root) {
"use strict";

const IDENT = /^[A-Za-z_.][A-Za-z0-9_.]{0,79}$/;
const PY_IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/;
const TABLE_MARK = "\u001eFLOWSTUDIO_TABLE ";
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/* ---------- pure helpers (unit tested) ---------- */
function sessionFrames(payload, runtime) {
  if (!payload || !Array.isArray(payload.variables)) return [];
  const type = runtime === "r" ? "data.frame" : "DataFrame";
  return payload.variables
    .filter(item => item && typeof item.name === "string" && item.type === type)
    .map(item => {
      const dims = Array.isArray(item.dimensions) && item.dimensions.length === 2 ? item.dimensions : null;
      return { runtime, name: item.name, rows: dims ? dims[0] : null, cols: dims ? dims[1] : null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
function tabularFiles(index) {
  if (!Array.isArray(index)) return [];
  return index.filter(file => /\.(csv|tsv|tab)$/i.test(file.name));
}
function pythonTableCode(name) {
  if (!PY_IDENT.test(name)) throw new Error("Not a Python identifier.");
  /* One expression, so the user's namespace gains no helper names. */
  return "print(" + JSON.stringify(TABLE_MARK) + " + (lambda _j, _d: _j.dumps({" +
    "'columns': [str(c) for c in list(_d.columns)[:200]], " +
    "'rows': _d.iloc[:5000, :200].astype(str).values.tolist(), " +
    "'total': int(_d.shape[0])}))(__import__('json'), " + name + "))";
}
function parsePythonTable(output) {
  const text = String(output || "");
  const at = text.lastIndexOf(TABLE_MARK);
  if (at < 0) return null;
  const line = text.slice(at + TABLE_MARK.length).split("\n")[0];
  try {
    const parsed = JSON.parse(line);
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    return { columns: parsed.columns.map(String), rows: parsed.rows.map(row => row.map(String)),
      total: Number(parsed.total) || parsed.rows.length };
  } catch (_) { return null; }
}
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function columnKinds(dataset) {
  return dataset.columns.map((_, column) => {
    let seen = 0;
    for (const row of dataset.rows) {
      const value = (row[column] ?? "").trim();
      if (!value || value === "NA" || value === "nan" || value === "None") continue;
      if (!NUMBER.test(value)) return "text";
      if (++seen > 500) break;
    }
    return seen ? "number" : "text";
  });
}
function formatCount(n) { return Number(n).toLocaleString("en-US"); }

/* ---------- DOM ---------- */
function mount(doc, options = {}) {
  const view = doc.getElementById("view-data");
  if (!view) return null;
  const viewer = options.viewer || root.FlowStudioData;
  const request = options.fetch || (typeof fetch === "function" ? fetch.bind(root) : null);
  const h = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const svg = d => '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  const iconButton = (id, title, path, onClick) => {
    const button = h("button", "sv-icon");
    button.type = "button";
    if (id) button.id = id;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = svg(path);
    button.addEventListener("click", onClick);
    return button;
  };

  view.className = "body data-view";
  view.replaceChildren();
  const sessionHead = h("div", "dv-section");
  const sessionTitle = h("span", "dv-section-title", "In session");
  const refresh = iconButton("dataRefresh", "Refresh data frames",
    '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.2v3h-3"/>', () => void refreshSessions(true));
  sessionHead.append(sessionTitle, refresh);
  const sessionList = h("div", "dv-list");
  sessionList.id = "dataSessionList";
  sessionList.setAttribute("role", "list");
  const fileHead = h("div", "dv-section");
  const openFile = iconButton("dataOpenFile", "Open a CSV or TSV file",
    '<path d="M3.5 1.8h5l3 3v9.4h-8z"/><path d="M8.5 1.8v3h3"/><path d="M8 7.5v4M6 9.5h4"/>', () => picker.click());
  fileHead.append(h("span", "dv-section-title", "Folder files"), openFile);
  const fileList = h("div", "dv-list");
  fileList.id = "dataFileList";
  fileList.setAttribute("role", "list");
  const picker = h("input");
  picker.type = "file";
  picker.accept = ".csv,.tsv,.tab,text/csv,text/tab-separated-values";
  picker.hidden = true;
  picker.addEventListener("change", () => {
    const file = picker.files && picker.files[0];
    picker.value = "";
    if (file) void openBlob(file, file.name);
  });
  const note = h("p", "dv-note", "Session data comes from the local R and Python processes. Files are read by your browser.");
  view.append(sessionHead, sessionList, fileHead, fileList, picker, note);

  /* ----- grid dialog ----- */
  const dialog = h("dialog", "dg-dialog");
  dialog.id = "dataGrid";
  dialog.setAttribute("aria-label", "Data grid");
  const head = h("div", "dg-head");
  const title = h("div", "dg-title");
  const titleName = h("span", "dg-name");
  const titleMeta = h("span", "dg-meta");
  title.append(titleName, titleMeta);
  const filter = h("input", "dg-filter");
  filter.type = "search";
  filter.placeholder = "Filter rows";
  filter.setAttribute("aria-label", "Filter rows");
  filter.maxLength = 256;
  const exportButton = iconButton("dataExport", "Export filtered rows as CSV",
    '<path d="M8 2.5v7.5"/><path d="M5 7l3 3 3-3"/><path d="M3 12.5v1h10v-1"/>', () => exportRows());
  const close = iconButton("dataGridClose", "Close", '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>', () => dialog.close());
  head.append(title, filter, exportButton, close);
  const scroller = h("div", "dg-scroll");
  const table = h("table", "dg-table");
  scroller.append(table);
  const foot = h("div", "dg-foot");
  const range = h("span", "dg-range");
  const prev = iconButton("dataPrev", "Previous page", '<path d="M10 4L6 8l4 4"/>', () => page(-1));
  const next = iconButton("dataNext", "Next page", '<path d="M6 4l4 4-4 4"/>', () => page(1));
  foot.append(range, prev, next);
  dialog.append(head, scroller, foot);
  doc.body.append(dialog);
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (event.target === filter && filter.value) {
      filter.value = "";
      state.filter = "";
      state.page = 0;
      renderGrid();
    } else dialog.close();
  });
  dialog.addEventListener("cancel", event => event.preventDefault());

  let current = null;
  let state = { filter: "", sortColumn: null, descending: false, page: 0 };
  let filterTimer = 0;
  filter.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.filter = filter.value; state.page = 0; renderGrid(); }, 120);
  });

  function showGrid(dataset, label, meta) {
    current = { dataset, label, kinds: columnKinds(dataset) };
    state = { filter: "", sortColumn: null, descending: false, page: 0 };
    filter.value = "";
    titleName.textContent = label;
    titleMeta.textContent = meta;
    renderGrid();
    if (!dialog.open) dialog.showModal();
    scroller.scrollTop = 0;
    filter.focus();
  }
  function renderGrid() {
    if (!current || !viewer) return;
    const { dataset, kinds } = current;
    const view = viewer.viewRows(dataset, { filter: state.filter, sortColumn: state.sortColumn,
      descending: state.descending, page: state.page });
    state.page = view.page;
    table.replaceChildren();
    const thead = h("thead");
    const headRow = h("tr");
    headRow.append(h("th", "dg-rownum", ""));
    dataset.columns.forEach((name, column) => {
      const cell = h("th", kinds[column] === "number" ? "num" : "");
      cell.scope = "col";
      const button = h("button", "dg-sort");
      button.type = "button";
      const label = h("span", "dg-col", name);
      const kind = h("span", "dg-kind", kinds[column] === "number" ? "num" : "chr");
      button.append(label, kind);
      if (state.sortColumn === column) {
        button.append(h("span", "dg-arrow", state.descending ? "↓" : "↑"));
        cell.setAttribute("aria-sort", state.descending ? "descending" : "ascending");
      }
      button.addEventListener("click", () => {
        if (state.sortColumn !== column) { state.sortColumn = column; state.descending = false; }
        else if (!state.descending) state.descending = true;
        else { state.sortColumn = null; state.descending = false; }
        state.page = 0;
        renderGrid();
      });
      cell.append(button);
      headRow.append(cell);
    });
    thead.append(headRow);
    const tbody = h("tbody");
    for (const row of view.rows) {
      const tr = h("tr");
      tr.append(h("td", "dg-rownum", String(row.index + 1)));
      row.values.forEach((value, column) => {
        const td = h("td", kinds[column] === "number" ? "num" : "", value);
        if (value === "NA" || value === "nan" || value === "None" || value === "") td.classList.add("dg-na");
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const first = view.total ? view.page * viewer.PAGE_SIZE + 1 : 0;
    const last = Math.min(view.total, (view.page + 1) * viewer.PAGE_SIZE);
    range.textContent = view.total
      ? "Rows " + formatCount(first) + " to " + formatCount(last) + " of " + formatCount(view.total) +
        (view.total !== dataset.rows.length ? " (filtered from " + formatCount(dataset.rows.length) + ")" : "")
      : "No rows match.";
    prev.disabled = view.page <= 0;
    next.disabled = view.page >= view.pageCount - 1;
  }
  function page(step) { state.page += step; renderGrid(); scroller.scrollTop = 0; }
  function exportRows() {
    if (!current || !viewer) return;
    try {
      const csv = viewer.exportCSV(current.dataset, { filter: state.filter,
        sortColumn: state.sortColumn, descending: state.descending });
      viewer.downloadCSV(csv, current.label.replace(/[^\w.-]+/g, "_").replace(/\.(tsv|tab)$/i, "") + ".csv", doc);
    } catch (error) { status(error.message || String(error), "error"); }
  }
  function status(message, kind) {
    const app = root.FlowStudioApp;
    if (app && typeof app.status === "function") app.status(message, kind);
  }

  /* ----- session frames ----- */
  async function post(route, body) {
    const response = await request(route, { method: "POST", body,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" } });
    return { ok: response.ok, status: response.status, text: await response.text() };
  }
  let refreshing = null;
  async function refreshSessions(explicit) {
    if (!request) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const frames = [];
      const failures = [];
      for (const runtime of ["r", "python"]) {
        try {
          const reply = await post("/api/inspect/" + runtime, "");
          if (reply.ok) frames.push(...sessionFrames(JSON.parse(reply.text), runtime));
          else if (explicit) failures.push(runtime === "r" ? "R" : "Python");
        } catch (_) { if (explicit) failures.push(runtime === "r" ? "R" : "Python"); }
      }
      renderSessions(frames, failures);
    })();
    try { await refreshing; } finally { refreshing = null; }
  }
  function renderSessions(frames, failures) {
    sessionList.replaceChildren();
    for (const frame of frames) {
      const row = h("button", "dv-row");
      row.type = "button";
      row.setAttribute("role", "listitem");
      row.dataset.name = frame.name;
      row.dataset.runtime = frame.runtime;
      const tag = h("span", "dv-tag rt-" + frame.runtime, frame.runtime === "r" ? "R" : "Py");
      const name = h("span", "dv-name", frame.name);
      const dims = h("span", "dv-dims", frame.rows == null ? "" :
        formatCount(frame.rows) + " × " + formatCount(frame.cols));
      row.append(tag, name, dims);
      row.title = "Open " + frame.name + " in the data grid";
      row.addEventListener("click", () => void openFrame(frame));
      sessionList.append(row);
    }
    if (!frames.length) {
      const empty = h("div", "dv-empty");
      empty.append(h("span", "", "No data frames yet. Create one in the R or Python console, for example "),
        h("code", "", "df <- head(mtcars, 20)"), h("span", "", "."));
      sessionList.append(empty);
    }
    if (failures.length) sessionList.append(h("div", "dv-empty", failures.join(" and ") + " session unavailable."));
  }
  async function openFrame(frame) {
    status("Loading " + frame.name + " …");
    try {
      let dataset;
      if (frame.runtime === "r") {
        if (!IDENT.test(frame.name)) throw new Error("Unsupported R name.");
        /* The R table route pages 200 rows at a time; gather up to 5,000. */
        let offset = 0;
        dataset = null;
        while (offset !== null && (!dataset || dataset.rows.length < 5000)) {
          const reply = await post("/api/table/r", frame.name + (offset ? "\t" + offset : ""));
          if (!reply.ok) throw new Error(reply.text.slice(0, 300) || "R table failed.");
          const parsed = JSON.parse(reply.text);
          if (!dataset) dataset = { columns: parsed.columns.map(String), rows: [], total: parsed.totalRows };
          for (const row of parsed.rows) dataset.rows.push(row.map(v => v == null ? "" : String(v)));
          offset = typeof parsed.nextOffset === "number" ? parsed.nextOffset : null;
        }
      } else {
        const reply = await post("/api/run/python", pythonTableCode(frame.name));
        dataset = parsePythonTable(reply.text);
        if (!dataset) throw new Error(reply.text.slice(-300) || "Python table failed.");
      }
      const total = frame.rows != null ? frame.rows : dataset.rows.length;
      showGrid(dataset, frame.name, (frame.runtime === "r" ? "R" : "Python") + "  " +
        formatCount(total) + " × " + formatCount(dataset.columns.length) +
        (total > dataset.rows.length ? "  first " + formatCount(dataset.rows.length) + " rows" : ""));
      status("Opened " + frame.name + ".", "ok");
    } catch (error) {
      status("Data: " + (error.message || String(error)), "error");
    }
  }

  /* ----- folder files ----- */
  async function refreshFiles() {
    const explorer = root.FlowStudioWorkspaceExplorer;
    const handle = explorer && explorer.hasRoot && explorer.hasRoot() ? explorer.root() : null;
    fileList.replaceChildren();
    if (!handle) { fileList.append(h("div", "dv-empty", "Open a folder to list its CSV and TSV files.")); return; }
    const search = root.FlowStudioSearchEverywhere;
    const index = search ? (await search.buildFileIndex(handle)).files : [];
    const files = tabularFiles(index);
    for (const file of files.slice(0, 200)) {
      const row = h("button", "dv-row");
      row.type = "button";
      row.setAttribute("role", "listitem");
      row.dataset.rel = file.rel;
      const tag = h("span", "ex-badge tone-data", "T");
      row.append(tag, h("span", "dv-name", file.name), h("span", "dv-dims", file.dir));
      row.title = file.rel;
      row.addEventListener("click", async () => {
        try { await openBlob(await file.handle.getFile(), file.name, file.rel); }
        catch (error) { status(error.message || String(error), "error"); }
      });
      fileList.append(row);
    }
    if (!files.length) fileList.append(h("div", "dv-empty", "No CSV or TSV files in this folder."));
  }
  async function openBlob(blob, name, rel) {
    if (!viewer) return;
    if (blob.size > MAX_FILE_BYTES) { status(name + " is larger than 8 MiB.", "error"); return; }
    try {
      const dataset = viewer.parseDelimited(await blob.text(), viewer.delimiterForName(name));
      showGrid(dataset, name, (rel || "Local file") + "  " + formatCount(dataset.rows.length) +
        " × " + formatCount(dataset.columns.length));
    } catch (error) { status(name + ": " + (error.message || String(error)), "error"); }
  }

  function refreshAll(explicit) { void refreshSessions(explicit); void refreshFiles(); }
  const tab = doc.getElementById("tab-data");
  if (tab) tab.addEventListener("click", () => refreshAll(false));
  doc.addEventListener("flowstudio:root", () => { if (!view.hidden) void refreshFiles(); });
  /* After a console or editor run finishes, a new frame may exist. */
  const resultStatus = doc.getElementById("resultStatus");
  if (resultStatus && typeof MutationObserver === "function") {
    new MutationObserver(() => {
      if (!view.hidden && /^Finished/.test(resultStatus.textContent || "")) void refreshSessions(false);
    }).observe(resultStatus, { childList: true, characterData: true, subtree: true });
  }
  renderSessions([], []);
  void refreshFiles();
  return Object.freeze({ refresh: refreshAll, openFrame, showGrid, dialog });
}

const api = { mount, sessionFrames, tabularFiles, pythonTableCode, parsePythonTable, columnKinds, TABLE_MARK };
root.FlowStudioDataView = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.getElementById("view-data")) {
  const start = () => { try { api.instance = mount(document); } catch (_) { /* optional */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
