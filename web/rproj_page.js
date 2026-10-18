/* Project settings editor. The browser owns all filesystem permissions. */
(function (root) {
"use strict";
function mount(doc = document, environment = root) {
  const get = id => doc.getElementById(id);
  const open = get("openProject"), fallback = get("fallbackProject");
  const form = get("settings"), fields = get("fields"), save = get("saveProject");
  const reset = get("resetChanges"), name = get("fileName"), status = get("status");
  let handle = null, original = "", filename = "";
  const api = environment.FlowStudioRproj;
  const fileSave = environment.FlowStudioFileSave;
  function report(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }
  function draw(source) {
    const settings = api.read(source);
    fields.replaceChildren();
    for (const [key, kind] of Object.entries(api.OPTIONS)) {
      const label = doc.createElement("label");
      const text = doc.createElement("span");
      text.textContent = key;
      const input = doc.createElement(Array.isArray(kind) ? "select" : "input");
      input.name = key;
      if (Array.isArray(kind)) {
        const values = settings[key] && !kind.includes(settings[key]) ?
          [settings[key], ...kind] : kind;
        for (const value of values) {
          const option = doc.createElement("option");
          option.value = value;
          option.textContent = value;
          input.append(option);
        }
      } else {
        input.type = kind === "indent" ? "number" : "text";
        if (kind === "indent") { input.min = "1"; input.max = "16"; input.step = "1"; }
        input.maxLength = 80;
      }
      input.value = settings[key] || (Array.isArray(kind) ? kind[0] : "");
      input.dataset.original = input.value;
      label.append(text, input);
      fields.append(label);
    }
    fields.disabled = false;
    save.disabled = false;
    reset.disabled = false;
  }
  async function load(file, selectedHandle = null) {
    if (!file || !/\.rproj$/i.test(file.name)) throw new Error("Choose a .Rproj file");
    if (file.size > api.MAX_BYTES) throw new Error("Project file exceeds 256 KiB");
    const text = await file.text();
    api.parse(text);
    draw(text);
    handle = selectedHandle;
    original = text;
    filename = file.name;
    name.textContent = filename + (handle ? " (direct save)" : " (download to save)");
    report("Loaded project configuration");
  }
  open.addEventListener("click", async () => {
    try {
      if (typeof environment.showOpenFilePicker === "function") {
        const selected = await environment.showOpenFilePicker({multiple:false,types:[{
          description:"RStudio project",accept:{"text/plain":[".Rproj",".rproj"]}
        }]});
        if (selected && selected.length) await load(await selected[0].getFile(), selected[0]);
      } else fallback.click();
    } catch (error) {
      if (error.name !== "AbortError") report(error.message || String(error), true);
    }
  });
  fallback.addEventListener("change", async () => {
    try { if (fallback.files[0]) await load(fallback.files[0]); }
    catch (error) { report(error.message || String(error), true); }
    finally { fallback.value = ""; }
  });
  reset.addEventListener("click", () => {
    try { draw(original); report("Restored original values (not written)"); }
    catch (error) { report(error.message || String(error), true); }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!filename) return;
    const changes = {};
    for (const input of fields.querySelectorAll("select,input")) {
      if (input.value !== input.dataset.original) changes[input.name] = input.value;
    }
    try {
      const updated = api.update(original, changes);
      if (handle) {
        await fileSave.writeIfUnchanged(handle, original, updated);
      } else {
        const url = URL.createObjectURL(new Blob([updated], {type:"text/plain;charset=utf-8"}));
        try {
          const link = doc.createElement("a");
          link.href = url;
          link.download = filename;
          link.click();
        } finally { URL.revokeObjectURL(url); }
      }
      original = updated;
      draw(updated);
      report(handle ? "Saved project settings" : "Downloaded updated project settings");
    } catch (error) { report(error.message || String(error), true); }
  });
  return {load};
}
root.FlowStudioRprojPage = Object.freeze({mount});
if (typeof module !== "undefined" && module.exports) module.exports = {mount};
if (typeof document !== "undefined" && document.getElementById("openProject")) mount(document, root);
})(globalThis);
