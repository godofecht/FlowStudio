/* FlowStudio native package manager. Runs real pip / install.packages()
 * through the persistent local Python and R sessions (loopback server).
 * Installs execute on this device with the user's own OS permissions.
 */
(function (global) {
"use strict";
const SPEC = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:==[A-Za-z0-9._!+-]{1,39})?$/;
const R_NAME = /^[A-Za-z][A-Za-z0-9.]{0,79}$/;
const MAX_OUTPUT = 200000;

function validSpec(spec, kind) {
  if (kind === "r") return R_NAME.test(spec) && !spec.includes("..") && !spec.endsWith(".");
  return SPEC.test(spec);
}

/* Code executed by the persistent kernels. Specs are pre-validated, so
 * embedding them as string literals cannot inject code. */
function pythonInstallCode(spec) {
  return "import subprocess,sys\n" +
    "result = subprocess.run([sys.executable, '-m', 'pip', 'install', '--user', '" + spec + "'],\n" +
    "    capture_output=True, text=True, timeout=12)\n" +
    "print(result.stdout[-2000:])\n" +
    "print(result.stderr[-2000:])";
}
function pythonListCode() {
  return "import subprocess,sys\n" +
    "result = subprocess.run([sys.executable, '-m', 'pip', 'list', '--format', 'json'],\n" +
    "    capture_output=True, text=True, timeout=12)\n" +
    "print(result.stdout)";
}
function rInstallCode(name) {
  return 'install.packages("' + name + '", repos = "https://cloud.r-project.org")';
}
function rListCode() {
  return 'ip <- base::installed.packages();\n' +
    'for (i in seq_len(nrow(ip))) cat(ip[i, "Package"], " ", ip[i, "Version"], "\\n", sep = "")';
}

function parsePipInventory(output) {
  if (typeof output !== "string") return null;
  const start = output.indexOf("[");
  if (start < 0) return null;
  const end = output.lastIndexOf("]");
  if (end <= start) return null;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;
    const packages = [];
    for (const item of parsed) {
      if (!item || typeof item.name !== "string" || item.name.length > 100 ||
          typeof item.version !== "string" || item.version.length > 100) return null;
      packages.push({ name: item.name, version: item.version });
    }
    return packages.length > 2000 ? packages.slice(0, 2000) : packages;
  } catch (error) {
    return null;
  }
}

function parseRInventory(output) {
  if (typeof output !== "string") return null;
  const packages = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9.]*) (\S+)$/.exec(line.trim());
    if (match) packages.push({ name: match[1], version: match[2] });
    if (packages.length > 2000) return null;
  }
  return packages.length ? packages : [];
}

function mount(document, options) {
  const {
    target, input, installButton, listButton,
    notice = () => {}, language = () => "python", fetchFn = (typeof fetch === "function" ? fetch : null)
  } = options || {};
  if (!document || !target || !input || !installButton || !listButton)
    throw new TypeError("Packages panel requires target, input, installButton and listButton.");
  if (typeof fetchFn !== "function") throw new TypeError("Packages panel requires a fetch function.");
  let busy = false;
  let revision = 0;

  const post = async (route, code) => {
    const response = await fetchFn(route, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
      body: code
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text: String(text).slice(0, MAX_OUTPUT) };
  };

  function setBusy(state) {
    busy = state;
    installButton.disabled = listButton.disabled = state;
  }

  function render(packages, kind) {
    target.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "muted";
    heading.textContent = packages.length ? "Installed " + (kind === "r" ? "R packages" : "Python packages") +
      " (first " + Math.min(packages.length, 250) + ")" :
      "No installed " + (kind === "r" ? "R packages" : "Python packages") + " reported.";
    target.append(heading);
    const table = document.createElement("table");
    table.setAttribute("aria-label", kind === "r" ? "Installed R packages" : "Installed Python packages");
    const header = document.createElement("tr");
    for (const label of ["Package", "Version"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      header.append(cell);
    }
    table.append(header);
    for (const item of packages.slice(0, 250)) {
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

  async function list(kind) {
    if (kind === "r") return parseRInventory((await post("/api/run/r", rListCode())).text);
    return parsePipInventory((await post("/api/run/python", pythonListCode())).text);
  }

  return Object.freeze({
    updateLanguage() {
      revision++;
      const kind = language();
      target.replaceChildren();
      input.placeholder = kind === "r" ? "ggplot2" : "package==version";
      input.setAttribute("aria-label", kind === "r" ? "R package name" : "Python package spec");
      installButton.textContent = kind === "r" ? "Install R package" : "Install package";
      listButton.textContent = kind === "r" ? "List R packages" : "List packages";
      installButton.disabled = listButton.disabled = busy || kind === "flow";
      notice(kind === "flow" ?
        "Flow ships as a compiled tool; package management applies to the Python and R sessions." :
        "Installs run on this device with your OS permissions; a local 15 s execution budget applies.");
    },
    list: async () => perform("list"),
    install: async () => perform("install"),
    validSpec: (spec, kind) => validSpec(spec, kind || language())
  });

  async function perform(operation) {
    if (busy) return false;
    const kind = language();
    const token = ++revision;
    if (kind !== "r" && kind !== "python") {
      notice("Package management supports the Python and R sessions. Flow packages are not supported here.", "error");
      return false;
    }
    let spec = input.value.trim();
    if (operation === "install") {
      if (!validSpec(spec, kind)) {
        notice(kind === "r" ?
          "Enter a valid R package name (letters, digits and dots)." :
          "Enter a package name, optionally pinned with ==version.", "error");
        return false;
      }
    } else {
      spec = "";
    }
    setBusy(true);
    notice(operation === "install" ?
      "Installing into the local " + kind + " session (this can take up to the local 15 s budget)…" :
      "Reading local " + kind + " packages…");
    try {
      if (operation === "install") {
        const installed = kind === "r" ?
          await post("/api/run/r", rInstallCode(spec)) :
          await post("/api/run/python", pythonInstallCode(spec));
        if (token !== revision) return false;
        if (!installed.ok) throw new Error((installed.text || "Install failed").slice(0, 400));
      }
      if (token !== revision) return false;
      const packages = await list(kind);
      if (token !== revision) return false;
      if (!packages) throw new Error("Could not read the package inventory (install may still have succeeded).");
      render(packages, kind);
      notice(operation === "install" ? "Installed " + spec + " in the local " + kind + " session." :
        "Local " + kind + " package inventory updated.", "ok");
      return true;
    } catch (error) {
      if (token === revision)
        notice(kind + " packages: " + String(error.message || error).slice(0, 400), "error");
      return false;
    } finally {
      if (token === revision) {
        setBusy(false);
        installButton.disabled = listButton.disabled = language() === "flow";
      }
    }
  }
}

const api = { mount, validSpec, parsePipInventory, parseRInventory,
  pythonInstallCode, pythonListCode, rInstallCode, rListCode };
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioPackageManager = api;
})(globalThis);
