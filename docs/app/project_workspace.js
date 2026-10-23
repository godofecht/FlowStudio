/* Browser-local project editing using explicitly granted directory handles. */
(function (global) {
"use strict";
function create({projectApi, fileSaveApi, source, filename, language, tree,
                 openFolderButton, saveFileButton, newFileButton, deleteFileButton, status,
                 setFilename, onDraft, picker, confirmChange, promptName}) {
  if (!projectApi || !fileSaveApi) throw new TypeError("Project and save APIs are required.");
  let activeHandle = null;
  let activeParent = null, activeName = null;
  let saving = false, deleting = false;
  let diskBaseline = null;
  let editorBaseline = source.value;
  let approvedCreate = false;
  const dirty = () => source.value !== editorBaseline;
  const confirmSwitch = () => !dirty() || confirmChange("Discard unsaved editor changes?");
  function notifyExternalOpen() {
    activeHandle = null;
    activeParent = null;
    activeName = null;
    if (deleteFileButton) deleteFileButton.disabled = true;
    diskBaseline = null;
    editorBaseline = source.value;
    saveFileButton.disabled = true;
  }
  async function openHandle(handle, path, parent) {
    if (deleting) return false;
    const approved = approvedCreate;
    approvedCreate = false;
    if (!approved && !confirmSwitch()) return false;
    // Read first: failures must not alter the existing editor or active handle.
    const text = await fileSaveApi.readSnapshot(handle);
    if (deleting) return false;
    if (text.includes("\0")) throw new Error("NUL bytes are not supported.");
    const name = path.slice(path.lastIndexOf("/") + 1);
    const extension = name.split(".").pop().toLowerCase();
    const nextLanguage = extension === "py" ? "python" : extension === "flow" ? "flow" :
      extension === "r" ? "r" : language.value;
    source.value = text;
    language.value = nextLanguage;
    setFilename(name, path);
    activeHandle = handle;
    activeParent = parent || null;
    activeName = name;
    if (deleteFileButton) deleteFileButton.disabled = !activeParent;
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
    if (deleting || saving) return false;
    return project.choose();
  }
  async function save() {
    if (saving || deleting) { status("File operation already running."); return false; }
    if (!activeHandle) { status("Open a project file before saving to disk."); return false; }
    saving = true;
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
    } finally { saving = false; }
  }
  async function createFile() {
    if (deleting || saving) { status("File operation already running."); return false; }
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
  async function deleteFile() {
    if (!activeHandle || !activeParent || !activeName) {
      status("Open a project file before deleting."); return false;
    }
    if (saving || deleting) { status("File operation already running."); return false; }
    if (dirty()) { status("Save or discard unsaved changes before deleting."); return false; }
    const handle = activeHandle, parent = activeParent, name = activeName;
    const baseline = diskBaseline;
    deleting = true;
    try {
      if (typeof parent.getFileHandle !== "function" || typeof parent.removeEntry !== "function")
        throw new Error("This browser does not support project file deletion.");
      async function checkCurrent() {
        const current = await parent.getFileHandle(name);
        if (typeof current.isSameEntry === "function" && !(await current.isSameEntry(handle)))
          throw new Error("The file was replaced externally.");
        if ((await fileSaveApi.readSnapshot(current)) !== baseline)
          throw new Error("The file changed on disk. Deletion refused.");
      }
      await checkCurrent();
      if (!confirmChange('Permanently delete "' + name + '" from this project?')) return false;
      if (activeHandle !== handle || dirty()) throw new Error("Editor changed during deletion.");
      await checkCurrent();
      await parent.removeEntry(name);
      activeHandle = null;
      activeParent = null;
      activeName = null;
      diskBaseline = null;
      editorBaseline = "";
      saveFileButton.disabled = true;
      if (deleteFileButton) deleteFileButton.disabled = true;
      const extension = name.includes(".") ? "." + name.split(".").pop() : ".txt";
      setFilename("untitled" + extension, "untitled" + extension);
      onDraft();
      await project.refresh();
      status("Deleted " + name + " from project; editor content retained as an unsaved copy.");
      return true;
    } catch (error) {
      status("Delete failed: " + (error.message || String(error)));
      return false;
    } finally { deleting = false; }
  }
  openFolderButton.addEventListener("click", () => { void choose(); });
  saveFileButton.addEventListener("click", () => { void save(); });
  newFileButton.addEventListener("click", () => { void createFile(); });
  if (deleteFileButton) deleteFileButton.addEventListener("click", () => { void deleteFile(); });
  saveFileButton.disabled = true;
  if (deleteFileButton) deleteFileButton.disabled = true;
  return {project, choose, save, createFile, deleteFile, openHandle, notifyExternalOpen, dirty,
    hasActiveFile: () => activeHandle !== null};
}
const api = {create};
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProjectWorkspace = api;
})(globalThis);
