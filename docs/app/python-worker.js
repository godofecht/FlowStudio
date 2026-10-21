/* Dedicated Pyodide worker: all Python execution stays in this browser. */
"use strict";
let runtime = null;
let loading = null;
let generation = 0;
async function python() {
  if (runtime) return runtime;
  if (!loading) loading = (async () => {
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");
    return await loadPyodide({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/"});
  })();
  try { runtime = await loading; return runtime; }
  catch (error) { loading = null; throw error; }
}
self.onmessage = async event => {
  const {id, op, code} = event.data || {};
  if (!Number.isSafeInteger(id)) return;
  if (op !== "run" || typeof code !== "string" || new TextEncoder().encode(code).length > 65536) {
    self.postMessage({id, ok:false, output:"Invalid execution request."}); return;
  }
  let stdout = "", stderr = "";
  try {
    const py = await python();
    py.setStdout({batched: text => { stdout += text + "\n"; }});
    py.setStderr({batched: text => { stderr += text + "\n"; }});
    const value = await py.runPythonAsync(code);
    const rendered = value === undefined || value === null ? "" : String(value);
    if (value && typeof value.destroy === "function") value.destroy();
    self.postMessage({id, ok:true, output:(stdout + rendered + (stderr ? "\n" + stderr : "")).slice(0,131072)});
  } catch (error) {
    self.postMessage({id, ok:false, output:(stdout + stderr + String(error)).slice(0,131072)});
  }
};
