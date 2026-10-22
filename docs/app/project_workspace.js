/* Browser-local project editing using explicitly granted directory handles. */
(function (global) {
"use strict";
function create({projectApi, fileSaveApi, source, filename, language, tree,
                 openFolderButton, saveFileButton, newFileButton, status,
                 setFilename, onDraft, picker, confirmChange, promptName}) {
  if (!projectApi || !fileSaveApi) throw new TypeError("Project and save APIs are required.");
  let activeHandle = null;
  let diskBaseline = null;
  let editorBaseline = source.value;
  let approvedCreate = false;
  const dirty = () => source.value !== editorBaseline;
  const confirmSwitch = () => !dirty() || confirmChange("Discard unsaved editor changes?");
  function notifyExternalOpen() {
    activeHandle = null;
    diskBaseline = null;
    editorBaseline = source.value;
    saveFileButton.disabled = true;
  }
  async function openHandle(handle, path) {
    const approved = approvedCreate;
    approvedCreate = false;
    if (!approved && !confirmSwitch()) return false;
    // Read first: failures must not alter the existing editor or active handle.
    const text = await fileSaveApi.readSnapshot(handle);
    if (text.includes("\0")) throw new Error("NUL bytes are not supported.");
    const name = path.slice(path.lastIndexOf("/") + 1);
    const extension = name.split(".").pop().toLowerCase();
    const nextLanguage = extension === "py" ? "python" : extension === "flow" ? "flow" :
      extension === "r" ? "r" : language.value;
    source.value = text;
    language.value = nextLanguage;
    setFilename(name, path);
    activeHandle = handle;
    diskBaseline = text;
    editorBaseline = text;
    saveFileButton.disabled = false;
    onDraft();
    status("Opened " + path);
    return true;
  }
  const project = projectApi.createProjectExplorer({
    tree, status: message => status(message), openHandle, picker
  });
  async function choose() {
    return project.choose();
  }
  async function save() {
    if (!activeHandle) { status("Open a project file before saving to disk."); return false; }
    try {
      const saved = await fileSaveApi.writeIfUnchanged(activeHandle, diskBaseline, source.value);
      diskBaseline = saved;
      editorBaseline = saved;
      onDraft();
      status("Saved " + filename.textContent + " to disk.");
      return true;
    } catch (error) {
      status("Save failed: " + (error.message || String(error)));
      return false;
    }
  }
  async function createFile() {
    if (!project.hasProject()) { status("Open a project folder first."); return false; }
    const name = promptName("New source filename (e.g. analysis.flow)");
    if (name === null) return false;
    if (!projectApi.validFilename(name)) { status("Invalid source filename."); return false; }
    if (!confirmSwitch()) return false;
    approvedCreate = true;
    try { return await project.create(name); }
    catch (error) { status("Cannot create file: " + (error.message || String(error))); return false; }
    finally { approvedCreate = false; }
  }
  openFolderButton.addEventListener("click", () => { void choose(); });
  saveFileButton.addEventListener("click", () => { void save(); });
  newFileButton.addEventListener("click", () => { void createFile(); });
  saveFileButton.disabled = true;
  return {project, choose, save, createFile, openHandle, notifyExternalOpen, dirty,
    hasActiveFile: () => activeHandle !== null};
}
const api = {create};
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProjectWorkspace = api;
})(globalThis);
