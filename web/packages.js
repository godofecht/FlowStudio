/* Read-only installed package inventory UI. */
(function (global) {
"use strict";
const SOURCES = global.FlowStudioPackageQueries || (typeof require === "function" ? require("./packages_queries.js") : null);
function parseInventory(output, language) {
  if (language !== "python" && language !== "r") throw new Error("Unsupported package runtime.");
  if (typeof output !== "string" || output.length > 1048576) throw new Error("Package inventory exceeds the response limit.");
  const packages = [], seen = new Set();
  let invalidRows = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields.length !== 2 || fields[0].length > 200 || fields[1].length > 128 ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fields[0]) ||
        !/^[^\x00-\x1f\x7f]*$/.test(fields[1])) {
      invalidRows++;
      continue;
    }
    const key = fields[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (packages.length >= 5000) throw new Error("Package inventory exceeds 5000 entries.");
    packages.push({ name: fields[0], version: fields[1] });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { packages, invalidRows };
}
function createInventory({ request, doc, language, refresh, search, table, status }) {
  let revision = 0, inventory = null, activeRequest = null;
  const setStatus = message => { status.textContent = message; };
  function render() {
    table.replaceChildren();
    if (!inventory) return;
    const query = search.value.trim().toLowerCase();
    const matches = inventory.packages.filter(item =>
      item.name.toLowerCase().includes(query) || item.version.toLowerCase().includes(query));
    const head = doc.createElement("thead"), heading = doc.createElement("tr");
    for (const name of ["Package", "Version"]) {
      const th = doc.createElement("th"); th.textContent = name; heading.append(th);
    }
    head.append(heading);
    const body = doc.createElement("tbody");
    for (const item of matches.slice(0, 500)) {
      const row = doc.createElement("tr");
      for (const value of [item.name, item.version]) {
        const cell = doc.createElement("td"); cell.textContent = value; row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    setStatus(matches.length + " of " + inventory.packages.length + " installed packages" +
      (matches.length > 500 ? "; first 500 shown" : "") +
      (inventory.invalidRows ? "; " + inventory.invalidRows + " invalid rows skipped" : "") + ".");
  }
  async function load() {
    const token = ++revision, runtime = language.value;
    if (activeRequest) activeRequest.abort();
    const controller = new AbortController();
    activeRequest = controller;
    inventory = null;
    table.replaceChildren();
    refresh.disabled = true;
    setStatus("Inspecting installed " + runtime + " packages …");
    try {
      if (!Object.hasOwn(SOURCES, runtime)) throw new Error("Unsupported package runtime.");
      const response = await request("/api/run/" + runtime, {
        method: "POST", headers: {"Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run"},
        body: SOURCES[runtime], signal: controller.signal
      });
      const body = await response.text();
      if (token !== revision) return;
      if (!response.ok) throw new Error("Package inspection failed (HTTP " + response.status + "): " + body.slice(0, 300));
      inventory = parseInventory(body, runtime);
      render();
    } catch (error) {
      if (token === revision) {
        setStatus(controller.signal.aborted ? "Package inspection cancelled." : (error.message || String(error)));
      }
    } finally {
      if (token === revision) {
        activeRequest = null;
        refresh.disabled = false;
      }
    }
  }
  refresh.addEventListener("click", load);
  language.addEventListener("change", load);
  search.addEventListener("input", render);
  return { load, render };
}
const api = Object.freeze({ SOURCES, parseInventory, createInventory });
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioPackages = api;
})(globalThis);
