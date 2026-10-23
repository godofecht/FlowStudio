/* Dedicated Pyodide worker: all Python execution stays in this browser. */
"use strict";
let runtime = null;
let loading = null;
let plotCaptureLoaded = false;
let dataCaptureLoaded = false;
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
async function prepareDataCapture(py) {
  if (dataCaptureLoaded) return;
  const response = await fetch("./data_capture.py");
  if (!response.ok) throw Error("Table capture helper unavailable.");
  const source = await response.text();
  if (source.length > 16384) throw Error("Table capture helper exceeds size limit.");
  py.FS.writeFile("flowstudio_data_capture.py", source);
  dataCaptureLoaded = true;
}
async function capturePlots(py) {
  try {
    const raw = await py.runPythonAsync("_fs_plot_capture.capture()");
    if (typeof raw !== "string" || raw.length > 4200000)
      return {plots:[], warning:"Plot response exceeded size limit."};
    const decoded = JSON.parse(raw);
    if (!Array.isArray(decoded))
      return {plots:[], warning:"Plot response was not an array."};
    return {plots:decoded, warning:""};
  } catch (error) {
    return {plots:[], warning:String(error).slice(0, 300)};
  }
}
async function handle(event) {
  const {id, op, code} = event.data || {};
  if (!Number.isSafeInteger(id)) return;
  const validInstall = op === "install" && typeof code === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:==[0-9][A-Za-z0-9.!+_-]{0,39})?$/.test(code);
  const validTable = op === "table" && typeof code === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(code);
  if (!((op === "run" && typeof code === "string" && new TextEncoder().encode(code).length <= 65536) ||
    op === "inspect" || op === "packages" || validInstall || validTable)) {
    self.postMessage({id, ok:false, output:"Invalid execution request."}); return;
  }
  let stdout = "", stderr = "", plotWarning = "";
  let py = null;
  try {
    py = await python();
    if (op === "packages") {
      const raw = await py.runPythonAsync("import json as _fs_json\nimport importlib.metadata as _fs_md\n_fs_json.dumps(sorted([{'name':str(d.metadata.get('Name'))[:120],'version':str(d.version)[:80]} for d in _fs_md.distributions() if d.metadata.get('Name')], key=lambda p:p['name'].lower())[:500])");
      if (typeof raw !== "string" || raw.length > MAX_OUTPUT) throw new Error("Package inventory exceeds size limit.");
      const packages = JSON.parse(raw);
      if (!Array.isArray(packages) || packages.length > 500 ||
        !packages.every(item => item && typeof item.name === "string" && typeof item.version === "string"))
        throw new Error("Invalid Python package inventory.");
      self.postMessage({id, ok:true, packages});
      return;
    }
    if (op === "install") {
      await py.loadPackage("micropip");
      await py.runPythonAsync("import micropip as _fs_micropip\nawait _fs_micropip.install(" + JSON.stringify(code) + ")");
      self.postMessage({id, ok:true, output:"Installed " + code});
      return;
    }
    if (op === "table") {
      await prepareDataCapture(py);
      const raw = await py.runPythonAsync("import flowstudio_data_capture as _fs_data_capture\n_fs_data_capture.capture(" +
        JSON.stringify(code) + ", globals())");
      if (typeof raw !== "string" || raw.length > 1048576) throw Error("Table preview exceeds 1 MiB.");
      self.postMessage({id, ok:true, table:JSON.parse(raw)});
      return;
    }
    let plots = [];
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
      const captured = await capturePlots(py);
      plots = captured.plots;
      if (captured.warning) plotWarning = captured.warning;
    }
    if (op === "inspect") self.postMessage({id, ok:true, variables:JSON.parse(rendered)});
    else self.postMessage({id, ok:true, output:(stdout + rendered + (stderr ? "\n" + stderr : "")).slice(0, MAX_OUTPUT), plots, plotWarning});
  } catch (error) {
    let plots = [];
    if (op === "run" && py && plotCaptureLoaded) {
      const captured = await capturePlots(py);
      plots = captured.plots;
      if (captured.warning) plotWarning = captured.warning;
    }
    self.postMessage({id, ok:false,
      output:(stdout + stderr + String(error).slice(0, MAX_OUTPUT)).slice(0, MAX_OUTPUT),
      plots, plotWarning});
  }
};

/* Execution, inspection and package changes share one interpreter: never overlap them. */
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
