/* Browser-side persistent R/Python environment panel.
 * All inspection and reset operations use the Flow-owned loopback endpoints.
 */
(function (root) {
  "use strict";

  function mount(doc = document, fetcher = fetch) {
    const runtime = doc.getElementById("runtimeInfo");
    const language = doc.getElementById("language");
    const api = root.FlowStudioEnvironment;
    if (!runtime || !language || !api || !runtime.parentElement) return null;

    const panel = runtime.parentElement;
    const controls = doc.createElement("div");
    const refreshButton = doc.createElement("button");
    const resetButton = doc.createElement("button");
    const message = doc.createElement("p");
    const values = doc.createElement("div");
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh variables";
    resetButton.type = "button";
    resetButton.textContent = "Reset interpreter";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    values.setAttribute("aria-label", "Runtime environment variables");
    controls.append(refreshButton, resetButton);
    panel.append(controls, message, values);

    let revision = 0;
    let busy = false;
    function selected() { return language.value === "python" || language.value === "r"; }
    function sync() {
      const enabled = selected();
      refreshButton.disabled = busy || !enabled;
      resetButton.disabled = busy || !enabled;
      runtime.textContent = enabled
        ? "Selected runtime: " + language.value + ". Persistent local interpreter."
        : "Selected runtime: Flow. Each execution is independent.";
      if (!enabled) {
        values.replaceChildren();
        message.textContent = "Flow variable inspection is not implemented.";
      }
    }

    async function refresh(name = language.value) {
      const token = ++revision;
      if (name !== language.value || !selected()) { busy = false; sync(); return false; }
      busy = true;
      sync();
      message.textContent = "Inspecting " + name + " …";
      try {
        const variables = await api.inspect(name, fetcher);
        if (token !== revision || language.value !== name) return false;
        const count = api.render(values, {variables}, doc);
        message.textContent = count + " variables";
        return true;
      } catch (error) {
        if (token === revision && language.value === name) {
          values.replaceChildren();
          message.textContent = String(error.message || error);
        }
        return false;
      } finally {
        if (token === revision) { busy = false; sync(); }
      }
    }

    async function reset() {
      const name = language.value;
      if (!selected() || busy) return false;
      const token = ++revision;
      busy = true;
      sync();
      message.textContent = "Resetting " + name + " …";
      try {
        await api.reset(name, fetcher);
        if (token !== revision || language.value !== name) return false;
        busy = false;
        return await refresh(name);
      } catch (error) {
        if (token === revision && language.value === name) {
          message.textContent = String(error.message || error);
        }
        return false;
      } finally {
        if (token === revision && language.value === name) {
          busy = false;
          sync();
        }
      }
    }

    function afterExecution(executedLanguage) {
      if (executedLanguage !== language.value || !selected()) return Promise.resolve(false);
      return refresh(executedLanguage);
    }

    refreshButton.addEventListener("click", () => { void refresh(); });
    resetButton.addEventListener("click", () => { void reset(); });
    language.addEventListener("change", () => {
      ++revision;
      busy = false;
      sync();
      if (selected()) void refresh();
    });
    sync();
    if (selected()) void refresh();
    return Object.freeze({refresh, reset, afterExecution});
  }

  const api = Object.freeze({mount});
  root.FlowStudioWorkspaceEnvironment = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined" && document.getElementById("runtimeInfo")) {
    const controller = mount(document, fetch);
    if (controller) root.FlowStudioWorkspaceEnvironment = controller;
  }
})(globalThis);
