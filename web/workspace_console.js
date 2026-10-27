/* Integrated interactive console for the FlowStudio source workspace.
 * Execution stays on the Flow-owned localhost HTTP routes. Console output is
 * kept as plain text (bounds-checked) and rendered as safe terminal markup:
 * script content, truthy HTML or ANSI color noise is never interpreted. */
(function (root) {
"use strict";
const TERMINAL = (typeof module !== "undefined" && module.exports) ?
  require("./terminal_render.js") : (root.FlowStudioTerminal || null);

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
    /* Terminal command row: a runtime prompt beside a borderless input,
     * styled by the page — this is chrome, not a web form. */
    const row = doc.createElement("div");
    row.className = "console-command";
    const label = doc.createElement("label");
    label.id = "consolePrompt";
    label.htmlFor = "consoleInput";
    label.className = "console-prompt";
    label.setAttribute("aria-hidden", "false");
    const input = doc.createElement("textarea");
    input.id = "consoleInput";
    input.setAttribute("aria-label", "Interactive console command");
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = "Enter to execute · Shift+Enter for newline";
    row.append(label, input);
    const controls = doc.createElement("div");
    controls.className = "console-controls";
    const button = doc.createElement("button");
    button.id = "consoleExecute";
    button.type = "button";
    button.textContent = "Run ▸";
    const hint = doc.createElement("span");
    hint.className = "console-hint";
    hint.textContent = "Enter run · Shift+Enter newline · ↑/↓ history";
    controls.append(button, hint);
    panel.append(row, controls);
  }
  const el = id => doc.getElementById(id);
  const input = el("consoleInput"), output = el("console");
  const button = el("consoleExecute"), language = el("language");
  const result = el("resultStatus"), editorRun = el("run"), editorCell = el("runCell");
  const drafts = {flow:"",r:"",python:""};
  let activeLanguage = language.value;
  /* Plain-text terminal buffer; the single source of truth for the view. */
  let buffer = output.textContent || "";
  function paint() {
    // Plain text first (the bounded buffer), then the classed terminal view:
    // on a real DOM the markup write wins; test fakes keep textContent.
    output.textContent = buffer;
    output.innerHTML = TERMINAL ? TERMINAL.render(buffer) : "";
  }
  paint();
  /* Singleton so every console writer (editor runs, installs, traces)
   * feeds the same terminal with one bounded buffer. */
  if (!root.FlowStudioConsoleIO) {
    root.FlowStudioConsoleIO = Object.freeze({
      write(text) { append(text); },
      clear() { buffer = ""; paint(); }
    });
  }
  function status(message, kind = "") {
    result.textContent = message;
    result.dataset.state = kind;
  }
  function append(message) {
    buffer += message;
    if (buffer.length > 262144)
      buffer = "[Older output truncated]\n" + buffer.slice(-250000);
    paint();
  }
  function syncLanguage() {
    if (activeLanguage !== language.value) {
      drafts[activeLanguage] = input.value;
      activeLanguage = language.value;
      input.value = drafts[activeLanguage] || "";
    }
    const prompt = doc.getElementById("consolePrompt");
    if (prompt) prompt.textContent =
      (activeLanguage === "python" ? "python" : activeLanguage) + " ❯ ";
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
  let storage = null;
  try { storage = root.localStorage || null; } catch (_) {}
  const controller = root.FlowStudioConsole.create(submit, () => language.value,
    message => status(message, "error"), {storage});
  if (output.parentElement && doc.createElement) {
    const label = doc.createElement("label"), box = doc.createElement("input");
    label.className = "console-flag";
    box.id = "consoleRememberHistory";
    box.type = "checkbox";
    box.checked = controller.isPersisting();
    box.addEventListener("change", () => {
      if (!controller.setPersistence(box.checked)) box.checked = controller.isPersisting();
    });
    label.append(box, " Remember command history on this device");
    const clear = doc.createElement("button");
    clear.id = "consoleClearHistory";
    clear.className = "console-clear-text";
    clear.type = "button";
    clear.textContent = "Clear selected runtime history";
    clear.addEventListener("click", () => {
      if (controller.clearHistory(language.value)) status("Console history cleared", "ok");
    });
    output.parentElement.append(label, clear);
  }
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
  syncLanguage();   // Paint the runtime prompt for the selected language.
  return controller;
}
root.FlowStudioWorkspaceConsole = Object.freeze({mount});
if (typeof module !== "undefined" && module.exports) module.exports = {mount};
if (typeof document !== "undefined" && document.getElementById("console")) mount(document, fetch);
})(globalThis);
