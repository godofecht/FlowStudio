/* Flow dependencies in the Packages view.
 *
 * A Flow project is a folder with a flow.toml. This module lists that
 * file's dependencies and runs the Flow package manager on it through
 * POST /api/packages/flow (src/flow_packages.py): flow init, flow add,
 * flow sync, and remove. Nothing runs until the user names a folder and
 * presses a button; the command output is shown under the list.
 *
 * The browser cannot read a disk path from a project it opened, so the
 * folder is typed once and remembered in this browser.
 */
(function (root) {
"use strict";

const ROUTE = "/api/packages/flow";
const FOLDER_KEY = "flowstudio.packages.flowFolder";

/* What `flow add` will be asked to do with a typed spec, or null. */
function classify(spec) {
  const text = String(spec || "").trim();
  if (!text || text.length > 300 || /[\n\r\0]/.test(text)) return null;
  if (/^(?:\/|\.\.?\/|~)/.test(text)) return { kind: "path", text };
  if (/^(?:https:\/\/|git@)[A-Za-z0-9._~:/@%+-]{3,300}$/.test(text)) return { kind: "git", text };
  if (/^[A-Za-z_][A-Za-z0-9_.-]{0,63}(?:@[0-9A-Za-z.*^~<>=+-]{1,40})?$/.test(text)) return { kind: "registry", text };
  return null;
}

function body(operation, folder, argument) {
  return [operation, folder, argument || ""].join("\n");
}

function createClient(request) {
  return async function call(operation, folder, argument) {
    const response = await request(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
      body: body(operation, folder, argument)
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    if (!data || typeof data !== "object") data = { ok: false, output: text.slice(0, 4000) };
    if (!response.ok) data.ok = false;
    return data;
  };
}

/* Draws the Flow side of the Packages view into the shared elements. */
function create(doc, parts, options = {}) {
  const call = options.call || createClient(options.fetch || ((url, init) => root.fetch(url, init)));
  let storage = null;
  try { storage = options.storage || root.localStorage; } catch (_) { storage = null; }
  const h = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const { summary, list, log, input } = parts;
  let state = null;     // last reply for the folder
  let busy = "";

  const box = h("div", "pk-folder");
  const folder = h("input");
  folder.id = "flowPackagesFolder";
  folder.type = "text";
  folder.autocomplete = "off";
  folder.spellcheck = false;
  folder.maxLength = 1024;
  folder.placeholder = "Project folder, e.g. /Users/me/projects/demo";
  folder.setAttribute("aria-label", "Flow project folder");
  try { folder.value = (storage && storage.getItem(FOLDER_KEY)) || ""; } catch (_) {}
  const open = h("button", "pk-act primary", "Open");
  open.type = "button";
  open.id = "flowPackagesOpen";
  open.addEventListener("click", () => void load(true));
  folder.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); void load(true); }
  });
  box.append(folder, open);
  box.hidden = true;

  function status(message, kind) {
    const app = root.FlowStudioApp;
    if (app && typeof app.status === "function") app.status(message, kind);
  }
  function showLog(text) {
    log.textContent = String(text || "").trim().slice(-6000);
    log.hidden = !log.textContent;
  }
  async function load(remember) {
    const path = folder.value.trim();
    if (remember) {
      try { storage && storage.setItem(FOLDER_KEY, path); } catch (_) {}
    }
    if (!path) {
      state = null;
      render();
      return null;
    }
    summary.textContent = "Reading flow.toml...";
    const reply = await call("list", path);
    state = reply.project ? reply : null;
    if (!reply.ok) showLog(reply.output);
    else log.hidden = true;
    render(reply.ok ? "" : reply.output);
    return reply;
  }
  async function perform(label, operation, argument) {
    if (busy || !state) return null;
    busy = label;
    render();
    summary.textContent = label + "...";
    let reply;
    try {
      reply = await call(operation, state.project, argument);
    } catch (error) {
      reply = { ok: false, output: String(error && error.message || error) };
    }
    busy = "";
    showLog(reply.output);
    if (reply.project) state = reply;
    status(label + (reply.ok ? " done." : " failed."), reply.ok ? "ok" : "error");
    render();
    return reply;
  }
  function action(label, id, run, primary) {
    const button = h("button", "pk-act" + (primary ? " primary" : ""), label);
    button.type = "button";
    if (id) button.id = id;
    button.disabled = !!busy;
    button.addEventListener("click", () => void run());
    return button;
  }
  function render(problem) {
    list.replaceChildren();
    input.disabled = !state || !state.manifest || !!busy;
    if (!folder.value.trim()) {
      summary.textContent = "Type the folder of a Flow project and press Open.";
      return;
    }
    if (!state) {
      summary.textContent = problem ? String(problem).split("\n").slice(-1)[0].slice(0, 300) : "Press Open to read the project.";
      return;
    }
    if (!state.manifest) {
      summary.textContent = "No flow.toml in this folder.";
      const row = h("div", "pk-row pk-offer");
      row.setAttribute("role", "listitem");
      const actions = h("span", "pk-actions");
      actions.append(action("Create flow.toml", "flowPackagesInit", () => perform("Running flow init", "init"), true));
      row.append(h("span", "pk-name", "flow init"), h("span", "pk-version", "new project here"), actions);
      list.append(row);
      return;
    }
    const deps = Array.isArray(state.dependencies) ? state.dependencies : [];
    const query = input.value.trim();
    const needle = query.toLowerCase();
    const shown = needle ? deps.filter(dep => dep.name.toLowerCase().includes(needle)) : deps;
    summary.textContent = (state.name ? state.name + ", " : "") + deps.length + " Flow " +
      (deps.length === 1 ? "dependency" : "dependencies") + (needle ? ", " + shown.length + " shown" : "");
    const spec = classify(query);
    if (query && !deps.some(dep => dep.name === query)) {
      const row = h("div", "pk-row pk-offer");
      row.setAttribute("role", "listitem");
      row.append(h("span", "pk-name", spec ? "Add " + query : query),
        h("span", "pk-version", spec ? { path: "local folder", git: "git repository", registry: "Flow registry" }[spec.kind] :
          "not a package name, git URL or folder"));
      if (spec) {
        const actions = h("span", "pk-actions");
        actions.append(action("Add", "flowPackagesAdd", () => add(query), true));
        row.append(actions);
      }
      list.append(row);
    }
    for (const dep of shown) {
      const row = h("div", "pk-row");
      row.setAttribute("role", "listitem");
      row.dataset.name = dep.name;
      const detail = dep.source + " " + dep.spec + (dep.locked ? " (" + dep.locked + ")" : "") +
        (dep.installed ? "" : ", not installed") + (dep.dev ? ", dev" : "");
      const version = h("span", "pk-version", detail);
      version.title = detail;
      const actions = h("span", "pk-actions");
      actions.append(action("Remove", null, () => removeDep(dep.name)));
      row.append(h("span", "pk-name", dep.name), version, actions);
      list.append(row);
    }
    const tools = h("div", "pk-row pk-tools");
    tools.append(h("span", "pk-name", state.project), action("Sync", "flowPackagesSync", () => perform("Running flow sync", "sync")));
    tools.lastChild.title = "flow sync: install what flow.toml lists";
    list.append(tools);
    if (!shown.length && !query) list.insertBefore(h("div", "dv-empty", "No dependencies yet. Type a name, git URL or folder above."), tools);
  }
  async function add(spec) {
    if (!classify(spec)) return null;
    const reply = await perform("Adding " + spec, "add", spec);
    if (reply && reply.ok) { input.value = ""; render(); }
    return reply;
  }
  function removeDep(name) {
    if (typeof root.confirm === "function" && !root.confirm("Remove the Flow dependency " + name + "?")) return null;
    return perform("Removing " + name, "remove", name);
  }
  return Object.freeze({
    element: box,
    placeholder: "Filter, or add: name, name@1.2, git URL or ./folder",
    render,
    load,
    add,
    remove: removeDep,
    /* Enter in the search field adds what was typed. */
    enter() {
      const query = input.value.trim();
      if (state && state.manifest && classify(query) && !(state.dependencies || []).some(dep => dep.name === query))
        void add(query);
    },
    show() {
      box.hidden = false;
      if (state || !folder.value.trim()) render();
      else void load(false);
    },
    hide() { box.hidden = true; },
    state: () => state
  });
}

const api = Object.freeze({ ROUTE, FOLDER_KEY, classify, body, createClient, create });
root.FlowStudioFlowPackages = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
