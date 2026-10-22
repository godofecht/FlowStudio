/* Dedicated Pyodide worker: all Python execution stays in this browser. */
"use strict";
let runtime = null;
let loading = null;
let plotCaptureLoaded = false;
let queued = 0;
let serial = Promise.resolve();
const MAX_QUEUED = 32;
const MAX_OUTPUT = 131072;
function boundedAppend(existing, text) {
  const room = MAX_OUTPUT - existing.length;
  return room > 0 ? existing + String(text).slice(0, room) : existing;
}
async function python() {
  if (runtime) return runtime;
  if (!loading) loading = (async () => {
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");
    return await loadPyodide({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.27.7/full/"});
  })();
  try { runtime = await loading; return runtime; }
  catch (error) { loading = null; throw error; }
}
async function preparePlotCapture(py) {
  if (plotCaptureLoaded) return;
  const response = await fetch("./plot_capture.py");
  if (!response.ok) throw new Error("Plot capture helper unavailable");
  const source = await response.text();
  if (source.length > 16384) throw new Error("Plot capture helper exceeds size limit");
  py.FS.writeFile("flowstudio_plot_capture.py", source);
  plotCaptureLoaded = true;
}
async function handle(event) {
  const {id, op, code} = event.data || {};
  if (!Number.isSafeInteger(id)) return;
  if (!((op === "run" && typeof code === "string" && new TextEncoder().encode(code).length <= 65536) || op === "inspect")) {
    self.postMessage({id, ok:false, output:"Invalid execution request."}); return;
  }
  let stdout = "", stderr = "";
  try {
    const py = await python();
    let plots = [], plotWarning = "";
    if (op === "run") {
      await py.loadPackagesFromImports(code);
      try {
        await preparePlotCapture(py);
        await py.runPythonAsync("import flowstudio_plot_capture as _fs_plot_capture; _fs_plot_capture.prepare()");
      } catch (error) {
        plotWarning = String(error).slice(0, 300);
      }
    }
    py.setStdout({batched: text => { stdout = boundedAppend(stdout, text + "\n"); }});
    py.setStderr({batched: text => { stderr = boundedAppend(stderr, text + "\n"); }});
    const value = await py.runPythonAsync(op === "inspect" ? "import json as _fs_json\n_fs_json.dumps([{\u0027name\u0027:k,\u0027type\u0027:type(v).__name__,\u0027preview\u0027:repr(v)[:160],\u0027shape\u0027:None} for k,v in list(globals().items()) if not k.startswith(\u0027_\u0027)][:100])" : code);
    const rendered = value === undefined || value === null ? "" : String(value).slice(0, MAX_OUTPUT);
    if (value && typeof value.destroy === "function") value.destroy();
    if (op === "run" && plotCaptureLoaded) {
      try {
        const raw = await py.runPythonAsync("_fs_plot_capture.capture()");
        if (typeof raw === "string" && raw.length <= 4200000) {
          const decoded = JSON.parse(raw);
          if (Array.isArray(decoded)) plots = decoded;
        } else plotWarning = "Plot response exceeded size limit.";
      } catch (error) {
        plotWarning = String(error).slice(0, 300);
      }
    }
    if (op === "inspect") self.postMessage({id, ok:true, variables:JSON.parse(rendered)});
    else self.postMessage({id, ok:true, output:(stdout + rendered + (stderr ? "\n" + stderr : "")).slice(0, MAX_OUTPUT), plots, plotWarning});
  } catch (error) {
    self.postMessage({id, ok:false, output:(stdout + stderr + String(error).slice(0, MAX_OUTPUT)).slice(0, MAX_OUTPUT)});
  }
};

/* Inspect and execute operations share one Python interpreter: never overlap them. */
self.onmessage = event => {
  const id = event.data && event.data.id;
  if (queued >= MAX_QUEUED) {
    if (Number.isSafeInteger(id)) self.postMessage({id, ok:false, output:"Python execution queue is full."});
    return;
  }
  queued++;
  serial = serial.then(() => handle(event)).catch(error => {
    if (Number.isSafeInteger(id)) self.postMessage({id, ok:false, output:String(error)});
  }).finally(() => { queued--; });
};
