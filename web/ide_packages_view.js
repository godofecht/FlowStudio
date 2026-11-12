/* FlowStudio Packages view. One list per runtime (Python and R), filtered as
 * you type; when the typed name is not installed the first row offers to
 * install it, the way VS Code's extension search does. R rows show whether
 * the package is attached and offer load, update and remove (remove only for
 * the FlowStudio user library). Python rows offer uninstall. Everything runs
 * through the existing intent-gated session routes on this device. */
(function (root) {
"use strict";

const MAX_ROWS = 400;

function pythonUninstallCode(name) {
  return "import subprocess,sys\n" +
    "result = subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', '" + name + "'],\n" +
    "    capture_output=True, text=True, timeout=12)\n" +
    "print(result.stdout[-2000:])\nprint(result.stderr[-2000:])\n" +
    "if result.returncode:\n    raise RuntimeError('pip uninstall failed')";
}
const PY_VERSION_CODE = "import sys; print('\\u001ePYVER ' + sys.version.split()[0])";

/* Rows for a query: installed matches ranked prefix-first, plus an install
 * offer when nothing installed has exactly that name. */
function filterPackages(packages, query) {
  const needle = String(query || "").trim().toLowerCase();
  const bare = needle.replace(/==.*$/, "");
  if (!needle) return { rows: packages.slice(0, MAX_ROWS), offer: null };
  const rows = packages
    .filter(item => item.name.toLowerCase().includes(bare))
    .sort((a, b) => (b.name.toLowerCase().startsWith(bare) - a.name.toLowerCase().startsWith(bare)) ||
      a.name.localeCompare(b.name))
    .slice(0, MAX_ROWS);
  const exact = packages.some(item => item.name.toLowerCase() === bare);
  return { rows, offer: exact && !needle.includes("==") ? null : String(query).trim() };
}

function mount(doc, options = {}) {
  const view = doc.getElementById("view-packages");
  const manager = options.manager || root.FlowStudioPackageManager;
  const request = options.fetch || (typeof fetch === "function" ? fetch.bind(root) : null);
  if (!view || !manager || !request) return null;
  let storage = null;
  try { storage = options.storage || root.localStorage; } catch (_) { storage = null; }
  const h = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  view.className = "body packages-view";
  view.replaceChildren();
  const bar = h("div", "pk-bar");
  const seg = h("div", "pk-seg");
  seg.setAttribute("role", "tablist");
  seg.setAttribute("aria-label", "Runtime");
  const kinds = {};
  for (const [key, label] of [["python", "Python"], ["r", "R"]]) {
    const button = h("button", "pk-seg-btn", label);
    button.type = "button";
    button.id = "packagesKind-" + key;
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => select(key));
    kinds[key] = button;
    seg.append(button);
  }
  const refresh = h("button", "sv-icon");
  refresh.type = "button";
  refresh.id = "packagesRefresh";
  refresh.title = "Reload the installed list";
  refresh.setAttribute("aria-label", "Reload the installed list");
  refresh.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.2v3h-3"/></svg>';
  refresh.addEventListener("click", () => void load(kind, true));
  bar.append(seg, refresh);
  const field = h("div", "search-field pk-field");
  const input = h("input");
  input.id = "packageQuery";
  input.type = "search";
  input.maxLength = 96;
  input.autocomplete = "off";
  input.spellcheck = false;
  field.append(input);
  const summary = h("div", "pk-summary");
  summary.id = "packageSummary";
  summary.setAttribute("aria-live", "polite");
  const list = h("div", "pk-list");
  list.id = "packageRows";
  list.setAttribute("role", "list");
  const log = h("pre", "pk-log");
  log.id = "packageLog";
  log.hidden = true;
  view.append(bar, field, summary, list, log);

  let kind = "python";
  const cache = { python: null, r: null };
  const versions = { python: "", r: "" };
  let busy = "";
  let token = 0;

  async function post(route, body) {
    const response = await request(route, { method: "POST", body,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" } });
    return { ok: response.ok, status: response.status, text: (await response.text()).slice(0, 200000) };
  }
  function select(next) {
    kind = next;
    for (const [key, button] of Object.entries(kinds)) button.setAttribute("aria-selected", String(key === kind));
    input.placeholder = kind === "r" ? "Search or install an R package" : "Search or install, e.g. numpy or numpy==2.1.0";
    try { storage && storage.setItem("flowstudio.packages.kind", kind); } catch (_) {}
    log.hidden = true;
    render();
    if (!cache[kind]) void load(kind, false);
  }
  async function load(which, explicit) {
    const mine = ++token;
    summary.textContent = "Reading installed " + (which === "r" ? "R" : "Python") + " packages...";
    try {
      let packages;
      if (which === "r") {
        const reply = await post("/api/packages/r", "");
        if (!reply.ok) throw new Error(reply.text || "R is unavailable.");
        packages = JSON.parse(reply.text).packages || [];
        if (!versions.r) {
          const ver = await post("/api/run/r", 'cat("\\036RVER ", as.character(getRversion()), "\\n", sep = "")');
          const match = /\u001eRVER (\S+)/.exec(ver.text);
          versions.r = match ? match[1] : "";
        }
      } else {
        const reply = await post("/api/run/python", manager.pythonListCode());
        packages = manager.parsePipInventory(reply.text);
        if (!packages) throw new Error(reply.ok ? "pip did not return a package list." : reply.text.slice(-300));
        if (!versions.python) {
          const ver = await post("/api/run/python", PY_VERSION_CODE);
          const match = /\u001ePYVER (\S+)/.exec(ver.text);
          versions.python = match ? match[1] : "";
        }
      }
      if (mine !== token && !explicit) return;
      cache[which] = packages;
      if (which === kind) render();
    } catch (error) {
      if (which === kind) {
        summary.textContent = (which === "r" ? "R" : "Python") + ": " + String(error.message || error).slice(0, 300);
        list.replaceChildren();
      }
    }
  }
  function render() {
    const packages = cache[kind];
    list.replaceChildren();
    if (!packages) return;
    const { rows, offer } = filterPackages(packages, input.value);
    const runtime = kind === "r" ? "R" : "Python";
    summary.textContent = runtime + (versions[kind] ? " " + versions[kind] : "") + ", " +
      packages.length.toLocaleString("en-US") + " installed" +
      (input.value.trim() ? ", " + rows.length + " shown" : "");
    if (offer) {
      const valid = manager.validSpec(offer, kind);
      const row = h("div", "pk-row pk-offer");
      row.setAttribute("role", "listitem");
      const label = h("span", "pk-name", valid ? "Install " + offer : offer);
      const hint = h("span", "pk-version", valid ? (kind === "r" ? "from CRAN" : "with pip --user")
        : (kind === "r" ? "not a valid R package name" : "not a valid pip spec"));
      row.append(label, hint);
      if (valid) {
        const actions = h("span", "pk-actions");
        actions.append(action("Install", "packageInstall", () => install(offer), true));
        row.append(actions);
      }
      list.append(row);
    }
    for (const item of rows) {
      const row = h("div", "pk-row");
      row.setAttribute("role", "listitem");
      row.dataset.name = item.name;
      if (kind === "r") {
        const check = h("input", "pk-attach");
        check.type = "checkbox";
        check.checked = !!item.attached;
        check.title = item.attached ? "Attached to the R session" : "Load with library()";
        check.disabled = !!item.attached || !!busy;
        check.setAttribute("aria-label", "Load " + item.name);
        check.addEventListener("change", () => void rAction("load", item.name));
        row.append(check);
      }
      row.append(h("span", "pk-name", item.name), h("span", "pk-version", item.version));
      const actions = h("span", "pk-actions");
      if (kind === "r") {
        if (!item.base) actions.append(action("Update", null, () => rAction("update", item.name)));
        if (item.user) actions.append(action("Remove", null, () => rAction("remove", item.name)));
      } else if (!/^(pip|setuptools|wheel)$/i.test(item.name)) {
        actions.append(action("Uninstall", null, () => uninstallPython(item.name)));
      }
      row.append(actions);
      list.append(row);
    }
    if (!rows.length && !offer) list.append(h("div", "dv-empty", "No installed packages match."));
  }
  function action(label, id, run, primary) {
    const button = h("button", "pk-act" + (primary ? " primary" : ""), label);
    button.type = "button";
    if (id) button.id = id;
    button.disabled = !!busy;
    button.addEventListener("click", () => void run());
    return button;
  }
  async function perform(label, run) {
    if (busy) return;
    busy = label;
    render();
    summary.textContent = label + "...";
    log.hidden = true;
    try {
      const reply = await run();
      log.textContent = (reply.text || "").trim().slice(-4000);
      log.hidden = !log.textContent;
      if (!reply.ok) throw new Error((reply.text || "failed").trim().split("\n").slice(-1)[0].slice(0, 300));
      status(label + " done.", "ok");
    } catch (error) {
      status(label + ": " + (error.message || String(error)), "error");
    } finally {
      busy = "";
      cache[kind] = null;
      await load(kind, true);
    }
  }
  function install(spec) {
    if (kind === "r") return perform("Installing " + spec, () => post("/api/packages/r/install", spec));
    return perform("Installing " + spec, () => post("/api/run/python", manager.pythonInstallCode(spec)));
  }
  function rAction(what, name) {
    const verb = { load: "Loading", update: "Updating", remove: "Removing" }[what];
    if (what === "remove" && typeof root.confirm === "function" && !root.confirm("Remove the R package " + name + "?")) return;
    return perform(verb + " " + name, () => post("/api/packages/r/" + what, name));
  }
  function uninstallPython(name) {
    if (!manager.validSpec(name, "python")) return;
    if (typeof root.confirm === "function" && !root.confirm("Uninstall the Python package " + name + "?")) return;
    return perform("Uninstalling " + name, () => post("/api/run/python", pythonUninstallCode(name)));
  }
  function status(message, state) {
    const app = root.FlowStudioApp;
    if (app && typeof app.status === "function") app.status(message, state);
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const { offer } = filterPackages(cache[kind] || [], input.value);
    if (offer && manager.validSpec(offer, kind)) void install(offer);
  });
  const tab = doc.getElementById("tab-packages");
  if (tab) tab.addEventListener("click", () => {
    const language = doc.getElementById("language");
    const preferred = language && (language.value === "r" || language.value === "python") ? language.value : null;
    if (preferred && preferred !== kind && !cache[preferred]) select(preferred);
    else if (!cache[kind]) void load(kind, false);
  });
  let initial = "python";
  try { initial = (storage && storage.getItem("flowstudio.packages.kind")) || "python"; } catch (_) {}
  kind = initial === "r" ? "r" : "python";
  for (const [key, button] of Object.entries(kinds)) button.setAttribute("aria-selected", String(key === kind));
  input.placeholder = kind === "r" ? "Search or install an R package" : "Search or install, e.g. numpy or numpy==2.1.0";
  return Object.freeze({ select, load, install, render, kind: () => kind, packages: () => cache[kind] });
}

const api = { mount, filterPackages, pythonUninstallCode };
root.FlowStudioPackagesView = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.getElementById("view-packages")) {
  const start = () => { try { api.instance = mount(document); } catch (_) { /* optional */ } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
