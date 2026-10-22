"use strict";
const el = id => document.getElementById(id);
let data = null, page = 0, sort = null, descending = false;
function render() {
  if (!data) return;
  const view = FlowStudioData.viewRows(data, {filter:el("filter").value, page, sortColumn:sort, descending});
  page = view.page;
  el("previous").disabled = page === 0;
  el("next").disabled = page >= view.pageCount - 1;
  el("summary").textContent = view.total + "/" + data.rows.length + " rows, page " + (page + 1) + "/" + view.pageCount;
  const table = document.createElement("table"), head = document.createElement("tr");
  data.columns.forEach((name, i) => {
    const th = document.createElement("th"), button = document.createElement("button");
    button.textContent = name + (sort === i ? (descending ? " ▼" : " ▲") : " ↕");
    button.addEventListener("click", () => { descending = sort === i ? !descending : false; sort = i; page = 0; render(); });
    th.append(button); head.append(th);
  });
  table.append(head);
  view.rows.forEach(item => {
    const tr = document.createElement("tr");
    item.values.forEach(value => {
      const td = document.createElement("td");
      td.textContent = value === "" ? "—" : value;
      tr.append(td);
    });
    table.append(tr);
  });
  el("grid").replaceChildren(table);
}

async function loadFile(file) {
  if (!file) return;
  try {
    const delimiter = FlowStudioData.delimiterForName(file.name);
    if (file.size > FlowStudioData.MAX_BYTES) throw new Error("File exceeds 8 MiB");
    const parsed = FlowStudioData.parseDelimited(await file.text(), delimiter);
    data = parsed; page = 0; sort = null; descending = false;
    el("filter").value = ""; el("filter").disabled = false;
    render();
    el("status").textContent = "Loaded " + file.name;
  } catch (error) {
    el("status").textContent = error.message || String(error);
  }
}
el("open").addEventListener("click", async () => {
  if (typeof window.showOpenFilePicker !== "function") { el("fallback").click(); return; }
  try {
    const handles = await window.showOpenFilePicker({multiple:false});
    if (handles.length) await loadFile(await handles[0].getFile());
  } catch (error) {
    if (error.name !== "AbortError") el("status").textContent = String(error);
  }
});
el("fallback").addEventListener("change", async event => {
  await loadFile(event.target.files[0]); event.target.value = "";
});
el("filter").addEventListener("input", () => { page = 0; render(); });
el("previous").addEventListener("click", () => { page--; render(); });
el("next").addEventListener("click", () => { page++; render(); });
