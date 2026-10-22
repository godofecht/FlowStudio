/* Dedicated Pyodide worker: all Python execution stays in this browser. */
"use strict";
let runtime = null;
let loading = null;
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
async function handle(event) {
  const {id, op, code} = event.data || {};
  if (!Number.isSafeInteger(id)) return;
  if (!((op === "run" && typeof code === "string" && new TextEncoder().encode(code).length <= 65536) || op === "inspect")) {
    self.postMessage({id, ok:false, output:"Invalid execution request."}); return;
  }
  let stdout = "", stderr = "";
  try {
    const py = await python();
    py.setStdout({batched: text => { stdout = boundedAppend(stdout, text + "\n"); }});
    py.setStderr({batched: text => { stderr = boundedAppend(stderr, text + "\n"); }});
    const value = await py.runPythonAsync(op === "inspect" ? "import json as _fs_json\n_fs_json.dumps([{\u0027name\u0027:k,\u0027type\u0027:type(v).__name__,\u0027preview\u0027:repr(v)[:160],\u0027shape\u0027:None} for k,v in list(globals().items()) if not k.startswith(\u0027_\u0027)][:100])" : code);
    const rendered = value === undefined || value === null ? "" : String(value).slice(0, MAX_OUTPUT);
    if (value && typeof value.destroy === "function") value.destroy();
    if (op === "inspect") self.postMessage({id, ok:true, variables:JSON.parse(rendered)});
    else self.postMessage({id, ok:true, output:(stdout + rendered + (stderr ? "\n" + stderr : "")).slice(0, MAX_OUTPUT)});
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
