/* FlowStudio's standalone interactive console. Requests use the Flow-owned router. */
(function (root) {
"use strict";
function mount(doc = document, request = fetch) {
  const el = id => doc.getElementById(id);
  const input = el("consoleInput"), output = el("consoleOutput");
  const language = el("consoleLanguage"), button = el("consoleRun");
  const state = el("consoleStatus");
  const drafts = {flow:"",r:"",python:""};
  let lastLanguage = language.value;
  function status(message, kind = "") {
    state.textContent = message;
    state.dataset.state = kind;
  }
  function append(message) {
    output.textContent += message;
    if (output.textContent.length > 262144)
      output.textContent = "[Older output truncated]\n" + output.textContent.slice(-250000);
    output.scrollTop = output.scrollHeight;
  }
  async function submit(name, code) {
    button.disabled = true;
    status("Running " + name + " …");
    append("\n> " + name + "\n");
    try {
      const response = await request("/api/run/" + name, {
        method:"POST",
        headers:{"Content-Type":"text/plain; charset=utf-8","X-FlowStudio-Intent":"run"},
        body:code
      });
      append((await response.text()) + "\n");
      status(response.ok ? "Finished" :
        response.status === 422 ? "Execution failed" :
        response.status === 503 ? "Interpreter unavailable" :
        response.status === 504 ? "Execution timed out" :
        "HTTP error " + response.status, response.ok ? "ok" : "error");
      return true;
    } catch (error) {
      append(String(error) + "\n");
      status("Request failed", "error");
      return false;
    } finally {
      button.disabled = false;
    }
  }
  // History storage is opt-in and scoped to this browser, matching the main IDE.
  let storage = null;
  try { storage = root.localStorage || null; } catch (_) {}
  const consoleController = root.FlowStudioConsole.create(submit, () => language.value,
    message => status(message, "error"), {storage});
  const controls = button.parentElement;
  if (controls && doc.createElement && !el("consoleRememberHistory")) {
    const label = doc.createElement("label");
    const remember = doc.createElement("input");
    remember.id = "consoleRememberHistory";
    remember.type = "checkbox";
    remember.checked = consoleController.isPersisting();
    remember.addEventListener("change", () => {
      if (!consoleController.setPersistence(remember.checked))
        remember.checked = consoleController.isPersisting();
    });
    label.append(remember, " Remember command history on this device");
    const clear = doc.createElement("button");
    clear.id = "consoleClearHistory";
    clear.type = "button";
    clear.textContent = "Clear selected runtime history";
    clear.addEventListener("click", () => {
      if (consoleController.clearHistory(language.value))
        status("Console history cleared", "ok");
    });
    controls.append(label, clear);
  }
  input.addEventListener("keydown", event => consoleController.keydown(event, input));
  button.addEventListener("click", () => { void consoleController.run(input); });
  el("consoleClear").addEventListener("click", () => { output.textContent = ""; });
  language.addEventListener("change", () => {
    drafts[lastLanguage] = input.value;
    lastLanguage = language.value;
    input.value = drafts[lastLanguage];
  });
  return consoleController;
}
root.FlowStudioConsolePage = Object.freeze({mount});
if (typeof module !== "undefined" && module.exports) module.exports = {mount};
})(globalThis);
