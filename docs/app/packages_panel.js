/* Browser-local Python (Pyodide) and R (webR) package controls. */
(function (global) {
"use strict";
const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:==[0-9][A-Za-z0-9.!+_-]{0,39})?$/;
const R_NAME = /^[A-Za-z][A-Za-z0-9.]{0,79}$/;
function validRName(name) {
  return R_NAME.test(name) && !name.includes("..") && !name.endsWith(".");
}
function create(options) {
  const {document, request, notice, target, input, installButton, listButton,
    language = () => "python", rSession = null} = options;
  let busy = false, revision = 0;
  function render(packages, kind) {
    target.replaceChildren();
    if (!packages.length) { target.textContent = "No installed " + (kind === "r" ? "R packages" : "Python distributions") + " reported."; return; }
    const table = document.createElement("table");
    table.setAttribute("aria-label", kind === "r" ? "Installed R packages" : "Installed Python distributions");
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
  function currentLanguage() { return language(); }
  function updateLanguage() {
    revision++; // Language switches invalidate responses, including switch-away-and-back.
    const kind = currentLanguage();
    target.replaceChildren();
    target.setAttribute?.("aria-label", "Installed " + (kind === "r" ? "R" : "Python") + " packages");
    input.placeholder = kind === "r" ? "ggplot2" : "package==version";
    input.setAttribute?.("aria-label", kind === "r" ? "R package name" : "Python package name");
    installButton.textContent = kind === "r" ? "Install R package" : "Install package";
    listButton.textContent = kind === "r" ? "List R packages" : "List packages";
    installButton.disabled = listButton.disabled = busy || kind === "flow";
  }
  async function perform(operation, code) {
    if (busy) return false;
    const kind = currentLanguage();
    const token = revision;
    if (kind !== "r" && kind !== "python") {
      notice("Browser package management supports Python and R, not Flow.");
      return false;
    }
    busy = true;
    installButton.disabled = listButton.disabled = true;
    notice(operation === "install" ? "Installing into the browser " + kind + " session…" :
      "Inspecting browser " + kind + " packages…");
    try {
      let inventory;
      if (kind === "r") {
        if (typeof rSession !== "function") throw Error("R package session unavailable.");
        const session = rSession();
        if (operation === "install") {
          const installed = await session.installPackage(code);
          if (!installed.ok) throw Error(installed.output || "R installation failed");
        }
        if (token !== revision) return false;
        inventory = await session.packages();
      } else {
        if (operation === "install") {
          const installed = await request("install", code);
          if (!installed.ok) throw Error(installed.output || "Python installation failed");
        }
        if (token !== revision) return false;
        inventory = await request("packages");
      }
      if (token !== revision) return false;
      if (!inventory.ok || !Array.isArray(inventory.packages))
        throw Error(inventory.output || "Package inventory unavailable");
      if (currentLanguage() !== kind) return false;
      if (inventory.packages.length > 1000 || inventory.packages.some(item =>
          !item || typeof item.name !== "string" || typeof item.version !== "string" ||
          item.name.length > 100 || item.version.length > 100))
        throw Error("Invalid package inventory response.");
      render(inventory.packages, kind);
      notice(operation === "install" ? "Package installed in the current " + kind + " session." :
        kind + " package inventory updated.");
      return true;
    } catch (error) {
      if (token === revision && currentLanguage() === kind)
        notice(kind + " packages: " + String(error.message || error).slice(0, 300));
      return false;
    } finally {
      busy = false;
      installButton.disabled = listButton.disabled = currentLanguage() === "flow";
    }
  }
  listButton.addEventListener("click", () => { void perform("packages"); });
  installButton.addEventListener("click", () => {
    const spec = input.value.trim();
    const kind = currentLanguage();
    if (!(kind === "r" ? validRName(spec) : SPEC.test(spec))) {
      notice(kind === "r" ? "Enter a valid R package name (no versions, URLs or paths)." :
        "Enter a package name, optionally pinned with ==version (no URLs or paths).");
      return;
    }
    void perform("install", spec);
  });
  updateLanguage();
  return {list: () => perform("packages"), clear: () => { revision++; target.replaceChildren(); }, updateLanguage};
}
global.FlowStudioPackages = {create};
})(typeof window !== "undefined" ? window : globalThis);
