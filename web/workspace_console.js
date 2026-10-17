/* Integrated interactive console for the FlowStudio source workspace.
 * Execution stays on the Flow-owned localhost HTTP routes. */
(function (root) {
"use strict";
function mount(doc = document, request = fetch) {
  // Progressive enhancement: keep the large tested editor HTML unchanged.
  // The Flow server injects this script after the editor's inline scripts.
  if (!doc.getElementById("consoleInput")) {
    const output = doc.getElementById("console");
    if (!output || !output.parentElement) throw new Error("Missing console panel");
    const panel = output.parentElement;
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "6px";
    output.style.flex = "1";
    output.style.minHeight = "60px";
    output.style.height = "auto";
    const label = doc.createElement("label");
    label.htmlFor = "consoleInput";
    label.textContent = "Interactive command (selected runtime)";
    const input = doc.createElement("textarea");
    input.id = "consoleInput";
    input.setAttribute("aria-label", "Interactive console command");
    input.spellcheck = false;
    input.placeholder = "Enter to execute · Shift+Enter for newline";
    input.style.cssText = "flex:0 0 70px;min-height:70px;resize:vertical;padding:8px;border:1px solid #455a7e;border-radius:5px";
    const controls = doc.createElement("div");
    controls.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
    const button = doc.createElement("button");
    button.id = "consoleExecute";
    button.type = "button";
    button.textContent = "Execute";
    const hint = doc.createElement("span");
    hint.textContent = "Enter: run · Shift+Enter: newline · ↑/↓: history";
    controls.append(button, hint);
    panel.append(label, input, controls);
  }
  const el = id => doc.getElementById(id);
  const input = el("consoleInput"), output = el("console");
  const button = el("consoleExecute"), language = el("language");
  const result = el("resultStatus"), editorRun = el("run"), editorCell = el("runCell");
  const drafts = {flow:"",r:"",python:""};
  let activeLanguage = language.value;
  function status(message, kind = "") {
    result.textContent = message;
    result.dataset.state = kind;
  }
  function append(message) {
    output.textContent += message;
    if (output.textContent.length > 262144)
      output.textContent = "[Older output truncated]\n" + output.textContent.slice(-250000);
    output.scrollTop = output.scrollHeight;
  }
  function syncLanguage() {
    if (activeLanguage === language.value) return;
    drafts[activeLanguage] = input.value;
    activeLanguage = language.value;
    input.value = drafts[activeLanguage] || "";
  }
  async function submit(name, code) {
    if (editorRun.disabled || editorCell.disabled) {
      status("Wait for editor execution to finish.", "error");
      return false;
    }
    button.disabled = true;
    editorRun.disabled = true;
    editorCell.disabled = true;
    status("Running " + name + " …");
    append("\n> " + name + " [console]\n");
    try {
      const response = await request("/api/run/" + name, {
        method: "POST",
        headers: {"Content-Type":"text/plain; charset=utf-8", "X-FlowStudio-Intent":"run"},
        body: code
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
      status("Execution request failed", "error");
      return false;
    } finally {
      button.disabled = false;
      editorRun.disabled = false;
      editorCell.disabled = false;
    }
  }
  const controller = root.FlowStudioConsole.create(submit, () => language.value,
    message => status(message, "error"));
  input.addEventListener("keydown", event => {
    syncLanguage();
    if (event.isComposing) return;
    // Stop the editor's document-level shortcuts while console has focus.
    if ((event.ctrlKey || event.metaKey) &&
        ["s", "f", "h"].includes(event.key.toLowerCase())) {
      event.stopPropagation();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      void controller.run(input);
      return;
    }
    controller.keydown(event, input);
  });
  input.addEventListener("focus", syncLanguage);
  button.addEventListener("click", () => { syncLanguage(); void controller.run(input); });
  language.addEventListener("change", syncLanguage);
  return controller;
}
root.FlowStudioWorkspaceConsole = Object.freeze({mount});
if (typeof module !== "undefined" && module.exports) module.exports = {mount};
if (typeof document !== "undefined" && document.getElementById("console")) mount(document, fetch);
})(globalThis);
