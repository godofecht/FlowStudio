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
const TRANSFER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
function validTransferPacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet) ||
      Object.keys(packet).sort().join(",") !== "kind,type,values" ||
      !["scalar", "vector"].includes(packet.kind) ||
      !["number", "boolean", "string"].includes(packet.type) ||
      !Array.isArray(packet.values) || packet.values.length > 256 ||
      (packet.kind === "scalar" && packet.values.length !== 1))
    return false;
  for (const value of packet.values) {
    if (packet.type === "number" &&
        (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))
      return false;
    if (packet.type === "boolean" && typeof value !== "boolean") return false;
    if (packet.type === "string") {
      if (typeof value !== "string" || value.length > 512 || value.includes("\0")) return false;
      try { encodeURIComponent(value); } catch (_) { return false; }
    }
  }
  return new TextEncoder().encode(JSON.stringify(packet)).length <= 32768;
}
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
  const {id, op, code, value} = event.data || {};
  if (!Number.isSafeInteger(id)) return;
  const validInstall = op === "install" && typeof code === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:==[0-9][A-Za-z0-9.!+_-]{0,39})?$/.test(code);
  const validTable = op === "table" && typeof code === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(code);
  const validCheck = op === "check" && typeof code === "string" &&
    code.length > 0 && new TextEncoder().encode(code).length <= 65536;
  const validHelp = op === "help" && typeof code === "string" && code.length <= 120 &&
    /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){0,3}$/.test(code);
  const validComplete = op === "complete" && typeof code === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(code);
  const validExport = op === "export" && typeof code === "string" && TRANSFER_NAME.test(code);
  const validImport = op === "import" && typeof code === "string" && TRANSFER_NAME.test(code) &&
    validTransferPacket(value);
  if (!((op === "run" && typeof code === "string" && new TextEncoder().encode(code).length <= 65536) ||
    op === "inspect" || op === "packages" || validInstall || validTable || validCheck || validHelp || validComplete || validExport || validImport)) {
    self.postMessage({id, ok:false, output:"Invalid execution request."}); return;
  }
  let stdout = "", stderr = "", plotWarning = "";
  let py = null;
  try {
    py = await python();
    if (op === "export") {
      // Only exact Python builtins are traversed; no user iterators, descriptors or repr().
      const query = [
        "import json as _fs_transfer_json, math as _fs_transfer_math",
        "_fs_transfer_name = " + JSON.stringify(code),
        "if _fs_transfer_name not in globals(): raise ValueError('Unknown Python variable')",
        "_fs_transfer_obj = globals()[_fs_transfer_name]",
        "_fs_transfer_kind = 'vector' if type(_fs_transfer_obj) in (list, tuple) else 'scalar'",
        "_fs_transfer_values = list(_fs_transfer_obj) if _fs_transfer_kind == 'vector' else [_fs_transfer_obj]",
        "if not _fs_transfer_values or len(_fs_transfer_values) > 256: raise ValueError('Python vector is empty or exceeds limit')",
        "def _fs_transfer_type(v):",
        "    return 'boolean' if type(v) is bool else 'number' if type(v) in (int, float) else 'string' if type(v) is str else None",
        "_fs_transfer_type_name = _fs_transfer_type(_fs_transfer_values[0])",
        "if _fs_transfer_type_name is None or any(_fs_transfer_type(v) != _fs_transfer_type_name for v in _fs_transfer_values): raise ValueError('Only homogeneous plain scalar/list/tuple values can be transferred')",
        "if any(type(v) is str and (len(v) > 512 or '\\x00' in v) for v in _fs_transfer_values): raise ValueError('Python string exceeds limit or contains NUL')",
        "if any(type(v) in (int, float) and (not _fs_transfer_math.isfinite(v) or abs(v) > 9007199254740991) for v in _fs_transfer_values): raise ValueError('Python number is not finite or safe')",
        "_fs_transfer_json.dumps({'kind': _fs_transfer_kind, 'type': _fs_transfer_type_name, 'values': _fs_transfer_values}, allow_nan=False)"
      ].join("\n");
      const raw = await py.runPythonAsync(query);
      if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 32768)
        throw Error("Invalid Python transfer response.");
      const packet = JSON.parse(raw);
      if (!validTransferPacket(packet)) throw Error("Invalid Python transfer payload.");
      self.postMessage({id, ok:true, value:packet});
      return;
    }
    if (op === "import") {
      // A JSON literal is parsed inside the existing Python globals; never eval() user text.
      const query = [
        "import json as _fs_transfer_json",
        "_fs_transfer_packet = _fs_transfer_json.loads(" + JSON.stringify(JSON.stringify(value)) + ")",
        "globals()[" + JSON.stringify(code) + "] = _fs_transfer_packet['values'] if _fs_transfer_packet['kind'] == 'vector' else _fs_transfer_packet['values'][0]",
        "'ok'"
      ].join("\n");
      const acknowledgement = await py.runPythonAsync(query);
      if (acknowledgement !== "ok") throw Error("Python transfer assignment did not acknowledge success.");
      self.postMessage({id, ok:true});
      return;
    }
    if (op === "check") {
      // ast.parse validates without executing user source or importing its dependencies.
      const query = [
        "import ast as _fs_ast, json as _fs_json",
        "_fs_source = " + JSON.stringify(code),
        "try:",
        "    _fs_ast.parse(_fs_source)",
        "    _fs_check = {'ok': True, 'diagnostics': []}",
        "except SyntaxError as _fs_error:",
        "    _fs_check = {'ok': False, 'diagnostics': [{'message': str(_fs_error.msg)[:300], 'line': _fs_error.lineno or 1, 'column': _fs_error.offset or 1}]}",
        "_fs_json.dumps(_fs_check)"
      ].join("\n");
      const raw = await py.runPythonAsync(query);
      if (typeof raw !== "string" || raw.length > 4096) throw Error("Invalid syntax diagnostic response.");
      const result = JSON.parse(raw);
      if (!result || typeof result.ok !== "boolean" || !Array.isArray(result.diagnostics) ||
          result.diagnostics.length > 1 || result.diagnostics.some(d =>
            !d || typeof d.message !== "string" || d.message.length > 300 ||
            !Number.isSafeInteger(d.line) || d.line < 1 ||
            !Number.isSafeInteger(d.column) || d.column < 1))
        throw Error("Invalid syntax diagnostic response.");
      self.postMessage({id, ok:result.ok, diagnostics:result.diagnostics});
      return;
    }
    if (op === "complete") {
      // Enumerate only names, never evaluate user source, descriptors or object methods.
      const query = [
        "import builtins as _fs_completion_builtins, json as _fs_completion_json",
        "_fs_completion_prefix = " + JSON.stringify(code),
        "_fs_completion_names = sorted(name for name in set(globals()).union(vars(_fs_completion_builtins)) if type(name) is str and len(name) <= 80 and name.isascii() and name.isidentifier() and name.startswith(_fs_completion_prefix) and not name.startswith('_fs_'))[:64]",
        "_fs_completion_json.dumps(_fs_completion_names)"
      ].join("\n");
      const raw = await py.runPythonAsync(query);
      if (typeof raw !== "string" || raw.length > 8192)
        throw Error("Invalid Python completion response.");
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || items.length > 64 ||
          !items.every(name => typeof name === "string" &&
            /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(name) && name.startsWith(code)))
        throw Error("Invalid Python completion response.");
      self.postMessage({id, ok:true, items});
      return;
    }
    if (op === "help") {
      // Resolve only already-loaded globals and builtins. No eval or module import by topic.
      const query = [
        "import builtins as _fs_help_builtins, inspect as _fs_help_inspect, json as _fs_help_json",
        "_fs_help_parts = " + JSON.stringify(code.split(".")),
        "_fs_help_obj = globals().get(_fs_help_parts[0], _fs_help_builtins.__dict__.get(_fs_help_parts[0]))",
        "try:",
        "    if _fs_help_obj is None: raise AttributeError('Unknown name')",
        "    for _fs_help_attr in _fs_help_parts[1:]:",
        "        _fs_help_obj = _fs_help_inspect.getattr_static(_fs_help_obj, _fs_help_attr)",
        "    _fs_help_doc = _fs_help_inspect.getdoc(_fs_help_obj) or ''",
        "    _fs_help_result = {'ok': True, 'name': " + JSON.stringify(code) + ", 'doc': _fs_help_doc[:12000]}",
        "except (AttributeError, TypeError, ValueError) as _fs_help_error:",
        "    _fs_help_result = {'ok': False, 'output': str(_fs_help_error)[:300]}",
        "_fs_help_json.dumps(_fs_help_result)"
      ].join("\n");
      const raw = await py.runPythonAsync(query);
      if (typeof raw !== "string" || raw.length > 18000) throw Error("Invalid Python help response.");
      const result = JSON.parse(raw);
      if (!result || typeof result.ok !== "boolean" ||
          (result.ok && (result.name !== code || typeof result.doc !== "string" || result.doc.length > 12000)) ||
          (!result.ok && (typeof result.output !== "string" || result.output.length > 300)))
        throw Error("Invalid Python help response.");
      self.postMessage({id, ...result});
      return;
    }
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
