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
