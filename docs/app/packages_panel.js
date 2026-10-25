/* Browser Python/webR and Flow-owned native R package controls. */
(function (global) {
"use strict";
const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:==[0-9][A-Za-z0-9.!+_-]{0,39})?$/;
const R_NAME = /^[A-Za-z][A-Za-z0-9.]{0,79}$/;
function validRName(name) {
  return R_NAME.test(name) && !name.includes("..") && !name.endsWith(".");
}
function create(options) {
  const {document, request, notice, target, input, installButton, listButton,
    loadButton = null, removeButton = null, updateButton = null, language = () => "python", rSession = null,
    rNative = () => false, confirmRemove = name => typeof global.confirm === "function" &&
      global.confirm("Remove " + name + " from the FlowStudio user R library? This cannot be undone."),
    confirmUpdate = name => typeof global.confirm === "function" &&
      global.confirm("Update " + name + " from CRAN? Package installation executes code as your local user and cannot be automatically rolled back.")} = options;
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
    installButton.disabled = busy || kind === "flow";
    listButton.disabled = busy || kind === "flow";
    if (loadButton) {
      loadButton.hidden = kind !== "r" || !rNative();
      loadButton.disabled = busy || loadButton.hidden;
    }
    if (removeButton) {
      removeButton.hidden = kind !== "r" || !rNative();
      removeButton.disabled = busy || removeButton.hidden;
    }
    if (updateButton) {
      updateButton.hidden = kind !== "r" || !rNative();
      updateButton.disabled = busy || updateButton.hidden;
    }
  }
  async function perform(operation, code) {
    if (busy) return false;
    const kind = currentLanguage();
    const token = revision;
    if (kind !== "r" && kind !== "python") {
      notice("Browser package management supports Python and R, not Flow.");
      return false;
    }
    if ((operation === "load" || operation === "remove" || operation === "update") && (kind !== "r" || !rNative())) return false;
    busy = true;
    installButton.disabled = listButton.disabled = true;
    if (loadButton) loadButton.disabled = true;
    if (removeButton) removeButton.disabled = true;
    if (updateButton) updateButton.disabled = true;
    notice(operation === "update" ? "Checking for a newer CRAN version in the native R user library…" :
      operation === "remove" ? "Removing user-installed native R package…" :
      operation === "load" ? "Loading installed native R package…" :
      operation === "install" ? "Installing into the selected " + kind + " session…" :
      "Inspecting installed " + kind + " packages…");
    try {
      let inventory, operationOutput = "";
      if (kind === "r") {
        if (typeof rSession !== "function") throw Error("R package session unavailable.");
        const session = rSession();
        if (operation === "install" || operation === "load" || operation === "remove" || operation === "update") {
          const installed = operation === "load" ? await session.loadPackage(code) :
            operation === "remove" ? await session.removePackage(code) :
            operation === "update" ? await session.updatePackage(code) :
            await session.installPackage(code);
          if (!installed.ok) throw Error(installed.output || "R package operation failed");
          operationOutput = installed.output || "";
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
      notice(operation === "update" ? (operationOutput || "R package update check completed.") :
        operation === "remove" ? "User-installed R package removed from the native library." :
        operation === "load" ? "Installed R package loaded into the native session." :
        operation === "install" ? "Package installation completed in the current " + kind + " session." :
        kind + " package inventory updated.");
      return true;
    } catch (error) {
      if (token === revision && currentLanguage() === kind)
        notice(kind + " packages: " + String(error.message || error).slice(0, 300));
      return false;
    } finally {
      busy = false;
      installButton.disabled = currentLanguage() === "flow";
      listButton.disabled = currentLanguage() === "flow";
      if (loadButton) loadButton.disabled = currentLanguage() !== "r" || !rNative();
      if (removeButton) removeButton.disabled = currentLanguage() !== "r" || !rNative();
      if (updateButton) updateButton.disabled = currentLanguage() !== "r" || !rNative();
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
  if (loadButton) loadButton.addEventListener("click", () => {
    const spec = input.value.trim();
    if (!validRName(spec)) {
      notice("Enter a valid R package name (no versions, URLs or paths).");
      return;
    }
    void perform("load", spec);
  });
  if (updateButton) updateButton.addEventListener("click", () => {
    if (currentLanguage() !== "r" || !rNative()) return;
    const spec = input.value.trim();
    if (!validRName(spec)) {
      notice("Enter a valid R package name (no versions, URLs or paths).");
      return;
    }
    if (!confirmUpdate(spec)) {
      notice("R package update cancelled.");
      return;
    }
    void perform("update", spec);
  });
  if (removeButton) removeButton.addEventListener("click", () => {
    if (currentLanguage() !== "r" || !rNative()) return;
    const spec = input.value.trim();
    if (!validRName(spec)) {
      notice("Enter a valid R package name (no versions, URLs or paths).");
      return;
    }
    if (!confirmRemove(spec)) {
      notice("R package removal cancelled.");
      return;
    }
    void perform("remove", spec);
  });
  updateLanguage();
  return {list: () => perform("packages"), clear: () => { revision++; target.replaceChildren(); }, updateLanguage};
}
global.FlowStudioPackages = {create};
})(typeof window !== "undefined" ? window : globalThis);
