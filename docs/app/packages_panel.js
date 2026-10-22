/* Browser Python package controls. Installations are scoped to the current Pyodide worker. */
(function (global) {
"use strict";
const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:==[0-9][A-Za-z0-9.!+_-]{0,39})?$/;
function create(options) {
  const {document, request, notice, target, input, installButton, listButton} = options;
  let busy = false;
  function render(packages) {
    target.replaceChildren();
    if (!packages.length) { target.textContent = "No installed distributions reported."; return; }
    const table = document.createElement("table");
    table.setAttribute("aria-label", "Installed Python distributions");
    const header = document.createElement("tr");
    for (const label of ["Package", "Version"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      header.append(cell);
    }
    table.append(header);
    for (const item of packages) {
      const row = document.createElement("tr");
      for (const value of [item.name, item.version]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      table.append(row);
    }
    target.append(table);
  }
  async function perform(operation, code) {
    if (busy) return false;
    busy = true;
    installButton.disabled = listButton.disabled = true;
    notice(operation === "install" ? "Installing into the browser Python session…" : "Inspecting browser Python packages…");
    try {
      if (operation === "install") {
        const installed = await request("install", code);
        if (!installed.ok) throw Error(installed.output || "Installation failed");
      }
      const inventory = await request("packages");
      if (!inventory.ok || !Array.isArray(inventory.packages))
        throw Error(inventory.output || "Package inventory unavailable");
      render(inventory.packages);
      notice(operation === "install" ? "Package installed in the current Python session." : "Python package inventory updated.");
      return true;
    } catch (error) {
      notice("Python packages: " + String(error.message || error).slice(0, 300));
      return false;
    } finally {
      busy = false;
      installButton.disabled = listButton.disabled = false;
    }
  }
  listButton.addEventListener("click", () => { void perform("packages"); });
  installButton.addEventListener("click", () => {
    const spec = input.value.trim();
    if (!SPEC.test(spec)) {
      notice("Enter a package name, optionally pinned with ==version (no URLs or paths).");
      return;
    }
    void perform("install", spec);
  });
  return {list: () => perform("packages"), clear: () => target.replaceChildren()};
}
global.FlowStudioPackages = {create};
})(typeof window !== "undefined" ? window : globalThis);
