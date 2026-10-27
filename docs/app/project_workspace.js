/* Browser-local project editing using explicitly granted directory handles. */
(function (global) {
"use strict";
function create({projectApi, fileSaveApi, source, filename, language, tree,
                 openFolderButton, saveFileButton, reloadFileButton, saveAsButton, newFileButton, newFolderButton, deleteFileButton, renameFileButton, status,
                 setFilename, onDraft, picker, saveAsPicker, saveAsApi, projectRenameApi, confirmChange, promptName}) {
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
    if (renameFileButton) renameFileButton.disabled = true;
    diskBaseline = null;
    editorBaseline = source.value;
    saveFileButton.disabled = true;
    if (reloadFileButton) reloadFileButton.disabled = true;
  }
  async function openHandle(handle, path, parent) {
    if (deleting || saving) return false;
    const approved = approvedCreate;
    approvedCreate = false;
    if (!approved && !confirmSwitch()) return false;
    // Read first: failures must not alter the existing editor or active handle.
    const text = await fileSaveApi.readSnapshot(handle);
    if (deleting || saving) return false;
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
    if (renameFileButton) renameFileButton.disabled = !activeParent;
    diskBaseline = text;
    editorBaseline = text;
    saveFileButton.disabled = false;
    if (reloadFileButton) reloadFileButton.disabled = false;
    onDraft();
    status("Opened " + path);
    return true;
  }
  const project = projectApi.createProjectExplorer({
    tree, status: message => status(message), openHandle, picker
  });
  async function choose() {
    if (deleting || saving) return false;
    const opened = await project.choose();
    if (opened) notifyExternalOpen();
    return opened;
  }
  /* File handles can outlive the path they were opened through. Check the
   * current directory entry before and after writing a project source file. */
  async function verifiedProjectEntry(handle, parent, name) {
    if (!parent) return handle; // Save As may point outside the project.
    if (!name || typeof parent.getFileHandle !== "function")
      throw new Error("Cannot verify the project file location.");
    const current = await parent.getFileHandle(name);
    const same = typeof current.isSameEntry === "function"
      ? await current.isSameEntry(handle)
      : typeof handle.isSameEntry === "function"
        ? await handle.isSameEntry(current) : false;
    if (!same) throw new Error("Project file was replaced or cannot be verified.");
    return current;
  }
  async function save() {
    if (saving || deleting) { status("File operation already running."); return false; }
    if (!activeHandle) { status("Open a project file before saving to disk."); return false; }
    const handle = activeHandle, parent = activeParent, name = activeName;
    const baseline = diskBaseline, contents = source.value;
    saving = true;
    try {
      const current = await verifiedProjectEntry(handle, parent, name);
      const saved = await fileSaveApi.writeIfUnchanged(current, baseline, contents);
      // Do not claim success or advance the baseline if another process
      // replaced or modified the file while the write was in flight.
      const after = await verifiedProjectEntry(handle, parent, name);
      if (await fileSaveApi.readSnapshot(after) !== saved)
        throw new Error("File changed during save; verify disk contents before retrying.");
      diskBaseline = saved;
      editorBaseline = saved;
      onDraft();
      status(source.value === saved
        ? "Saved " + filename.textContent + " to disk."
        : "Saved " + filename.textContent + "; newer editor changes remain unsaved.");
      return true;
    } catch (error) {
      status("Save failed: " + (error.message || String(error)));
      return false;
    } finally { saving = false; }
  }
  async function reloadFile() {
    if (saving || deleting) { status("File operation already running."); return false; }
    if (!activeHandle) { status("Open a project file before reloading from disk."); return false; }
    if (dirty() && !confirmChange("Discard unsaved editor changes and reload from disk?"))
      return false;
    const handle = activeHandle, parent = activeParent, name = activeName;
    const previousSource = source.value;
    saving = true; // Serialize reload with project switching and all disk mutations.
    try {
      let current = handle;
      async function checkIdentity() {
        if (!parent || !name) return;
        if (typeof parent.getFileHandle !== "function")
          throw new Error("Cannot verify the project file location.");
        const found = await parent.getFileHandle(name);
        const same = typeof found.isSameEntry === "function"
          ? await found.isSameEntry(handle)
          : typeof handle.isSameEntry === "function"
            ? await handle.isSameEntry(found) : false;
        if (!same) throw new Error("Project file was replaced or cannot be verified.");
        current = found;
      }
      await checkIdentity();
      const disk = await fileSaveApi.readSnapshot(current);
      await checkIdentity();
      if (await fileSaveApi.readSnapshot(current) !== disk)
        throw new Error("File changed during reload; retry.");
      if (activeHandle !== handle || source.value !== previousSource)
        throw new Error("Editor changed during reload; source retained.");
      if (disk === diskBaseline && disk === previousSource) {
        status("Source already matches disk.");
        return true;
      }
      source.value = disk;
      diskBaseline = disk;
      editorBaseline = disk;
      // The filename callback also invalidates notebook outputs from old source.
      if (disk !== previousSource) setFilename(name || handle.name, filename.textContent);
      onDraft();
      status("Reloaded " + filename.textContent + " from disk.");
      return true;
    } catch (error) {
      status("Reload failed: " + (error.message || String(error)));
      return false;
    } finally { saving = false; }
  }
  async function saveAs() {
    if (saving || deleting) { status("File operation already running."); return false; }
    saving = true;
    try {
      if (!saveAsApi || typeof saveAsApi.save !== "function")
        throw new Error("Save As controller unavailable.");
      const result = await saveAsApi.save({
        picker: saveAsPicker, fileSaveApi, validFilename: projectApi.validFilename,
        filename: activeName || filename.textContent.split("/").pop() || "untitled.flow",
        source: () => source.value, activeHandle, activeBaseline: diskBaseline,
        confirmOverwrite: confirmChange
      });
      if (!result) return false;
      activeHandle = result.handle;
      // The selected file may be outside the opened project; do not grant
      // project delete access without a verified parent directory handle.
      activeParent = null;
      activeName = result.name;
      diskBaseline = result.source;
      editorBaseline = result.source;
      const extension = result.name.split(".").pop().toLowerCase();
      if (extension === "py") language.value = "python";
      else if (extension === "flow") language.value = "flow";
      else if (extension === "r") language.value = "r";
      setFilename(result.name, result.name);
      saveFileButton.disabled = false;
      if (reloadFileButton) reloadFileButton.disabled = false;
      if (deleteFileButton) deleteFileButton.disabled = true;
      if (renameFileButton) renameFileButton.disabled = true;
      onDraft();
      status("Saved as " + result.name + " on disk.");
      return true;
    } catch (error) {
      if (error?.name !== "AbortError")
        status("Save As failed: " + (error.message || String(error)));
      return false;
    } finally { saving = false; }
  }
  async function createFile() {
    if (deleting || saving) { status("File operation already running."); return false; }
    if (!project.hasProject()) { status("Open a project folder first."); return false; }
    const name = promptName("New source path (e.g. src/analysis.flow)");
    if (name === null) return false;
    if (!(typeof projectApi.validSourcePath === "function" ? projectApi.validSourcePath(name) : projectApi.validFilename(name))) { status("Invalid project source path."); return false; }
    if (!confirmSwitch()) return false;
    approvedCreate = true;
    try { return await project.create(name); }
    catch (error) { status("Cannot create file: " + (error.message || String(error))); return false; }
    finally { approvedCreate = false; }
  }
  async function createFolder() {
    if (deleting || saving) { status("File operation already running."); return false; }
    if (!project.hasProject()) { status("Open a project folder first."); return false; }
    const path = promptName("New folder path (e.g. src or src/analysis)");
    if (path === null) return false;
    if (typeof projectApi.validFolderPath !== "function" ||
        !projectApi.validFolderPath(path)) {
      status("Invalid project folder path."); return false;
    }
    deleting = true; // Folder creation is serialized with saves and project switches.
    try { return await project.createFolder(path); }
    catch (error) {
      status("Cannot create folder: " + (error.message || String(error)));
      return false;
    } finally { deleting = false; }
  }
  async function deleteFile() {
    if (!activeHandle || !activeParent || !activeName) {
      status("Open a project file before deleting."); return false;
    }
    if (saving || deleting) { status("File operation already running."); return false; }
    if (dirty()) { status("Save or discard unsaved changes before deleting."); return false; }
    const handle = activeHandle, parent = activeParent, name = activeName;
    const baseline = diskBaseline, initialSource = source.value;
    deleting = true;
    try {
      if (typeof parent.getFileHandle !== "function" || typeof parent.removeEntry !== "function")
        throw new Error("This browser does not support project file deletion.");
      async function checkCurrent() {
        // Share the same fail-closed identity gate as project saves/reloads.
        // Matching bytes are not evidence that a replaced file is the same file.
        const current = await verifiedProjectEntry(handle, parent, name);
        if ((await fileSaveApi.readSnapshot(current)) !== baseline)
          throw new Error("The file changed on disk. Deletion refused.");
      }
      await checkCurrent();
      if (!confirmChange('Permanently delete "' + name + '" from this project?')) return false;
      if (activeHandle !== handle || source.value !== initialSource || dirty())
        throw new Error("Editor changed during deletion.");
      await checkCurrent();
      // A user can type while the final filesystem read is pending.
      if (activeHandle !== handle || source.value !== initialSource || dirty())
        throw new Error("Editor changed during deletion.");
      await parent.removeEntry(name);
      activeHandle = null;
      activeParent = null;
      activeName = null;
      diskBaseline = null;
      editorBaseline = "";
      saveFileButton.disabled = true;
      if (reloadFileButton) reloadFileButton.disabled = true;
      if (deleteFileButton) deleteFileButton.disabled = true;
      if (renameFileButton) renameFileButton.disabled = true;
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
  async function renameFile() {
    if (!activeHandle || !activeParent || !activeName) {
      status("Open a project file before renaming."); return false;
    }
    if (saving || deleting) { status("File operation already running."); return false; }
    if (dirty()) { status("Save or discard unsaved changes before renaming."); return false; }
    if (!projectRenameApi || typeof projectRenameApi.rename !== "function") {
      status("Project rename controller unavailable."); return false;
    }
    const nextName = promptName("New source filename", activeName);
    if (nextName === null) return false;
    if (!projectApi.validFilename(nextName) || nextName === activeName) {
      status("Choose a different supported source filename."); return false;
    }
    const handle = activeHandle, parent = activeParent, name = activeName;
    const baseline = diskBaseline;
    deleting = true; // Serialize rename with save, open, delete, and project switches.
    try {
      const result = await projectRenameApi.rename({
        parent, handle, name, nextName, baseline, fileSaveApi,
        validFilename: projectApi.validFilename, confirmRename: confirmChange
      });
      if (!result) return false;
      activeHandle = result.handle;
      activeName = result.name;
      diskBaseline = result.source;
      editorBaseline = result.source;
      const oldPath = filename.textContent;
      const prefix = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
      setFilename(result.name, prefix + result.name);
      onDraft();
      try { await project.refresh(); }
      catch (error) { status("Renamed file, but explorer refresh failed: " + (error.message || String(error))); return true; }
      status("Renamed " + name + " to " + result.name + ".");
      return true;
    } catch (error) {
      status("Rename failed: " + (error.message || String(error)));
      return false;
    } finally { deleting = false; }
  }
  openFolderButton.addEventListener("click", () => { void choose(); });
  saveFileButton.addEventListener("click", () => { void save(); });
  if (reloadFileButton) reloadFileButton.addEventListener("click", () => { void reloadFile(); });
  if (saveAsButton) saveAsButton.addEventListener("click", () => { void saveAs(); });
  newFileButton.addEventListener("click", () => { void createFile(); });
  if (newFolderButton) newFolderButton.addEventListener("click", () => { void createFolder(); });
  if (deleteFileButton) deleteFileButton.addEventListener("click", () => { void deleteFile(); });
  if (renameFileButton) renameFileButton.addEventListener("click", () => { void renameFile(); });
  saveFileButton.disabled = true;
  if (reloadFileButton) reloadFileButton.disabled = true;
  if (deleteFileButton) deleteFileButton.disabled = true;
  if (renameFileButton) renameFileButton.disabled = true;
  async function isOpenHandle(handle) {
    if (!activeHandle) return false;
    if (activeHandle === handle) return true;
    if (typeof activeHandle.isSameEntry === "function")
      return !!(await activeHandle.isSameEntry(handle));
    if (typeof handle.isSameEntry === "function")
      return !!(await handle.isSameEntry(activeHandle));
    // When identity cannot be established, reject replacement rather than
    // risk overwriting a file currently held in the editor.
    throw new Error("Cannot verify whether the project file is open in the editor.");
  }
  return {project, choose, save, reloadFile, saveAs, createFile, createFolder, deleteFile, renameFile, openHandle, notifyExternalOpen, dirty,
    isOpenHandle, hasActiveFile: () => activeHandle !== null};
}
const api = {create};
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioProjectWorkspace = api;
})(globalThis);
