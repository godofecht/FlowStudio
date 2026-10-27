/* FlowStudio local tabular data viewer: RFC-4180-style CSV and TSV. */
(function (global) {
"use strict";
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 25000;
const MAX_COLUMNS = 256;
const MAX_FIELD = 65536;
const PAGE_SIZE = 50;

function delimiterForName(name) {
  if (/\.tsv$/i.test(name)) return "\t";
  if (/\.csv$/i.test(name)) return ",";
  throw new Error("Only .csv and .tsv files can be viewed as datasets.");
}
function parseDelimited(source, delimiter = ",") {
  if (typeof source !== "string" || source.length > MAX_BYTES)
    throw new Error("Dataset exceeds the 8 MiB text limit.");
  if (delimiter !== "," && delimiter !== "\t") throw new Error("Unsupported delimiter.");
  if (source.includes("\0")) throw new Error("Dataset contains a NUL byte.");
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (!text.length) throw new Error("Dataset is empty.");
  const records = [];
  let record = [], field = "", inQuotes = false, afterQuote = false, atStart = true;
  function addChar(ch) {
    if (field.length >= MAX_FIELD) throw new Error("Dataset field exceeds 65,536 characters.");
    field += ch;
    atStart = false;
  }
  function addField() {
    if (record.length >= MAX_COLUMNS) throw new Error("Dataset exceeds 256 columns.");
    record.push(field);
    field = "";
    atStart = true;
    afterQuote = false;
  }
  function addRecord() {
    addField();
    if (records.length > MAX_ROWS) throw new Error("Dataset exceeds 25,000 data rows.");
    records.push(record);
    record = [];
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { addChar('"'); i++; }
        else { inQuotes = false; afterQuote = true; }
      } else addChar(ch);
    } else if (afterQuote) {
      if (ch === delimiter) addField();
      else if (ch === "\r" || ch === "\n") {
        addRecord();
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else throw new Error("Unexpected character after a closing quote.");
    } else if (ch === '"') {
      if (!atStart) throw new Error("Unexpected quote in an unquoted field.");
      inQuotes = true;
      atStart = false;
    } else if (ch === delimiter) addField();
    else if (ch === "\r" || ch === "\n") {
      addRecord();
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else addChar(ch);
  }
  if (inQuotes) throw new Error("Unterminated quoted field.");
  if (!/\r$|\n$/.test(text)) addRecord();
  if (!records.length) throw new Error("Dataset has no header.");
  const header = records.shift();
  const seen = new Map();
  const columns = header.map((name, index) => {
    const base = name || "Column " + (index + 1);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : base + " (" + count + ")";
  });
  const rows = records.map((values, index) => {
    if (values.length > columns.length)
      throw new Error("Row " + (index + 2) + " has more fields than the header.");
    while (values.length < columns.length) values.push("");
    return values;
  });
  return { columns, rows };
}
function viewRows(dataset, options = {}) {
  if (!dataset || !Array.isArray(dataset.columns) || !Array.isArray(dataset.rows))
    throw new Error("Invalid dataset.");
  const query = options.filter || "";
  if (typeof query !== "string" || query.length > 256)
    throw new Error("Filter must be at most 256 characters.");
  const needle = query.toLocaleLowerCase();
  const column = options.sortColumn == null ? null : options.sortColumn;
  if (column !== null && (!Number.isInteger(column) || column < 0 || column >= dataset.columns.length))
    throw new Error("Invalid sort column.");
  const matching = [];
  for (let i = 0; i < dataset.rows.length; i++) {
    const values = dataset.rows[i];
    if (!needle || values.some(value => value.toLocaleLowerCase().includes(needle)))
      matching.push({ index: i, values });
  }
  if (column !== null) {
    const numeric = matching.every(item => {
      const value = item.values[column].trim();
      return !value || (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)));
    });
    matching.sort((a, b) => {
      const x = a.values[column], y = b.values[column];
      const emptyX = x.trim() === "", emptyY = y.trim() === "";
      if (emptyX !== emptyY) return emptyX ? 1 : -1;
      let compare = numeric ? Number(x) - Number(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
      if (!Number.isFinite(compare)) compare = 0;
      return (options.descending ? -compare : compare) || a.index - b.index;
    });
  }
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const requested = Number.isInteger(options.page) ? options.page : 0;
  const page = Math.max(0, Math.min(requested, pageCount - 1));
  const rows = options.allRows === true ? matching : matching.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return { rows, total: matching.length, page, pageCount };
}
/* Bounded local CSV export of all filtered/sorted preview rows, across pages.
 * Spreadsheet formula-looking fields gain a leading apostrophe.
 */
function exportCSV(dataset, options = {}) {
  if (!dataset || !Array.isArray(dataset.columns) ||
      !dataset.columns.length || dataset.columns.length > MAX_COLUMNS ||
      !Array.isArray(dataset.rows) || dataset.rows.length > MAX_ROWS)
    throw new Error("Invalid CSV snapshot dataset.");
  const view = viewRows(dataset, {...options, allRows:true});
  const encoder = new TextEncoder();
  let size = 0;
  const lines = [];
  function add(values) {
    if (!Array.isArray(values) || values.length !== dataset.columns.length)
      throw new Error("CSV snapshot has an inconsistent row.");
    const row = values.map(value => {
      if (typeof value !== "string" || value.length > MAX_FIELD || value.includes("\0"))
        throw new Error("CSV snapshot contains an invalid field.");
      const trimmed = value.trimStart();
      const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed.trim()) &&
        Number.isFinite(Number(trimmed.trim()));
      const safe = /^[=+@-]/.test(trimmed) && !numeric ? "'" + value : value;
      return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
    }).join(",") + "\r\n";
    size += encoder.encode(row).length;
    if (size > MAX_BYTES) throw new Error("CSV export exceeds the 8 MiB limit.");
    lines.push(row);
  }
  add(dataset.columns);
  for (const item of view.rows) add(item.values);
  return {csv:lines.join(""), count:view.total,
    sampled:dataset.truncated === true ||
      (Number.isSafeInteger(dataset.totalRows) && dataset.totalRows > dataset.rows.length)};
}
function downloadCSV(csv, filename, document) {
  if (typeof csv !== "string" || new TextEncoder().encode(csv).length > MAX_BYTES)
    throw new Error("CSV download exceeds the 8 MiB limit.");
  if (!document || typeof document.createElement !== "function")
    throw new TypeError("Document required for CSV download.");
  const base = String(filename || "snapshot").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)
    .replace(/\.csv$/i, "") || "snapshot";
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = base + ".csv";
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
const api = { delimiterForName, parseDelimited, viewRows, exportCSV, downloadCSV, MAX_BYTES, PAGE_SIZE };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioData = api;
})(globalThis);
