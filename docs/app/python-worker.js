/* Dedicated Pyodide worker: all Python execution stays in this browser. */
"use strict";
let runtime = null;
let loading = null;
let plotCaptureLoaded = false;
let dataCaptureLoaded = false;
let environmentCaptureLoaded = false;
let queued = 0;
let serial = Promise.resolve();
const MAX_QUEUED = 32;
const MAX_OUTPUT = 131072;
const TRANSFER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
function validTransferValues(type, values, missing) {
  for (const value of values) {
    if (value === null && missing) continue;
    if (type === "number" &&
        (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))
      return false;
    if (type === "boolean" && typeof value !== "boolean") return false;
    if (type === "string") {
      if (typeof value !== "string" || value.length > 512 || value.includes("\0")) return false;
      try { encodeURIComponent(value); } catch (_) { return false; }
    }
  }
  return true;
}
function validTransferPacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return false;
  if (packet.kind === "table") {
    if (Object.keys(packet).sort().join(",") !== "columns,kind" ||
        !Array.isArray(packet.columns) || packet.columns.length < 1 ||
        packet.columns.length > 16) return false;
    const names = new Set();
    let count = null;
    for (const col of packet.columns) {
      if (!col || typeof col !== "object" || Array.isArray(col) ||
          Object.keys(col).sort().join(",") !== "name,type,values" ||
          typeof col.name !== "string" || !TRANSFER_NAME.test(col.name) || names.has(col.name) ||
          !["number", "boolean", "string"].includes(col.type) ||
          !Array.isArray(col.values) || col.values.length > 128 ||
          (count !== null && count !== col.values.length) ||
          !validTransferValues(col.type, col.values, true)) return false;
      names.add(col.name);
      count = col.values.length;
    }
  } else {
    if (Object.keys(packet).sort().join(",") !== "kind,type,values" ||
        !["scalar", "vector"].includes(packet.kind) ||
        !["number", "boolean", "string"].includes(packet.type) ||
        !Array.isArray(packet.values) || packet.values.length > 256 ||
        (packet.kind === "scalar" && packet.values.length !== 1) ||
        !validTransferValues(packet.type, packet.values, packet.kind === "vector")) return false;
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
async function prepareEnvironmentCapture(py) {
  if (environmentCaptureLoaded) return;
  const response = await fetch("./environment_capture.py");
  if (!response.ok) throw Error("Environment capture helper unavailable.");
  const source = await response.text();
  if (source.length > 16384) throw Error("Environment capture helper exceeds size limit.");
  py.FS.writeFile("flowstudio_environment_capture.py", source);
  environmentCaptureLoaded = true;
}
function validateEnvironmentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      typeof snapshot.truncated !== "boolean" || !Array.isArray(snapshot.variables) ||
      snapshot.variables.length > 128)
    throw Error("Invalid Python environment response.");
  let nodes = 0;
  function check(node, depth) {
    nodes++;
    if (nodes > 256 || !node || typeof node !== "object" || Array.isArray(node) ||
        typeof node.name !== "string" || node.name.length > 160 ||
        typeof node.type !== "string" || node.type.length > 100 ||
        typeof node.preview !== "string" || node.preview.length > 160 ||
        !(node.shape === null || (Array.isArray(node.shape) && node.shape.length <= 2 &&
          node.shape.every(n => Number.isSafeInteger(n) && n >= 0))) ||
        (node.truncated !== undefined && typeof node.truncated !== "boolean") ||
        (node.cycle !== undefined && typeof node.cycle !== "boolean") ||
        (node.children !== undefined && (!Array.isArray(node.children) ||
          node.children.length > 12 || depth >= 2)))
      throw Error("Invalid Python environment node.");
    if (node.children) for (const child of node.children) check(child, depth + 1);
  }
  for (const variable of snapshot.variables) check(variable, 0);
  return snapshot;
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
  const {id, op, code, value: transferValue} = event.data || {};
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
  const validExport = (op === "export" || op === "export-snapshot") &&
    typeof code === "string" && TRANSFER_NAME.test(code);
  const validImport = (op === "import" || op === "import-pandas" || op === "import-numpy") &&
    typeof code === "string" && TRANSFER_NAME.test(code) &&
    validTransferPacket(transferValue) &&
    (op !== "import-pandas" || transferValue.kind === "table") &&
     (op !== "import-numpy" || (transferValue.kind === "vector" &&
       ["number", "boolean", "string"].includes(transferValue.type) && transferValue.values.length > 0 &&
       (transferValue.type === "number" || !transferValue.values.includes(null))));
  if (!((op === "run" && typeof code === "string" && new TextEncoder().encode(code).length <= 65536) ||
    op === "inspect" || op === "packages" || validInstall || validTable || validCheck || validHelp || validComplete || validExport || validImport)) {
    self.postMessage({id, ok:false, output:"Invalid execution request."}); return;
  }
  let stdout = "", stderr = "", plotWarning = "";
  let py = null;
  try {
    py = await python();
    if (op === "export" || op === "export-snapshot") {
      // Only exact builtins, NumPy ndarrays, or pandas DataFrames with approved dtypes are traversed.
      const query = [
        "import json as _fs_transfer_json, math as _fs_transfer_math, re as _fs_transfer_re",
        "_fs_transfer_name = " + JSON.stringify(code),
        "if _fs_transfer_name not in globals(): raise ValueError('Unknown Python variable')",
        "_fs_transfer_obj = globals()[_fs_transfer_name]",
        "import sys as _fs_transfer_sys",
        "_fs_transfer_pd = _fs_transfer_sys.modules.get('pandas')",
        "_fs_transfer_is_df = _fs_transfer_pd is not None and type(_fs_transfer_obj) is _fs_transfer_pd.DataFrame",
        "_fs_transfer_np = _fs_transfer_sys.modules.get('numpy')",
        "_fs_transfer_is_array = _fs_transfer_np is not None and type(_fs_transfer_obj) is _fs_transfer_np.ndarray",
        "_fs_transfer_kind = 'pandas' if _fs_transfer_is_df else 'ndarray' if _fs_transfer_is_array else 'table' if type(_fs_transfer_obj) is dict else 'vector' if type(_fs_transfer_obj) in (list, tuple) else 'scalar'",
        "def _fs_transfer_type(v):",
        "    return 'boolean' if type(v) is bool else 'number' if type(v) in (int, float) else 'string' if type(v) is str else None",
        "def _fs_transfer_check(_fs_transfer_values, _fs_transfer_limit):",
        "    if not _fs_transfer_values or len(_fs_transfer_values) > _fs_transfer_limit: raise ValueError('Python vector is empty or exceeds limit')",
        "    _fs_transfer_present = [_fs_transfer_type(v) for v in _fs_transfer_values if v is not None]",
        "    if not _fs_transfer_present or _fs_transfer_present[0] is None or any(t != _fs_transfer_present[0] for t in _fs_transfer_present): raise ValueError('Only homogeneous plain scalar/list/tuple values can be transferred')",
        "    if any(type(v) is str and (len(v) > 512 or '\\x00' in v) for v in _fs_transfer_values): raise ValueError('Python string exceeds limit or contains NUL')",
        "    if any(type(v) in (int, float) and (not _fs_transfer_math.isfinite(v) or abs(v) > 9007199254740991) for v in _fs_transfer_values): raise ValueError('Python number is not finite or safe')",
        "    return _fs_transfer_present[0]",
        "if _fs_transfer_kind == 'pandas':",
        "    if not 1 <= len(_fs_transfer_obj.columns) <= 16 or not 1 <= len(_fs_transfer_obj) <= 128: raise ValueError('Pandas table requires 1-16 columns and 1-128 rows')",
        "    if type(_fs_transfer_obj.index) is not _fs_transfer_pd.RangeIndex or not _fs_transfer_obj.index.equals(_fs_transfer_pd.RangeIndex(len(_fs_transfer_obj))): raise ValueError('Pandas table requires default RangeIndex')",
        "    _fs_transfer_columns = []",
        "    _fs_transfer_names = set()",
        "    _fs_transfer_np = _fs_transfer_sys.modules.get('numpy')",
        "    for _fs_transfer_index, _fs_transfer_key in enumerate(_fs_transfer_obj.columns):",
        "        if type(_fs_transfer_key) is not str or _fs_transfer_re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,79}', _fs_transfer_key) is None or _fs_transfer_key in _fs_transfer_names: raise ValueError('Invalid or duplicate pandas column name')",
        "        _fs_transfer_names.add(_fs_transfer_key)",
        "        _fs_transfer_column = _fs_transfer_obj.iloc[:, _fs_transfer_index]",
        "        if type(_fs_transfer_column) is not _fs_transfer_pd.Series: raise ValueError('Unsupported pandas column')",
        "        _fs_transfer_dtype = _fs_transfer_column.dtype",
        "        _fs_transfer_builtin_dtype = (_fs_transfer_np is not None and isinstance(_fs_transfer_dtype, _fs_transfer_np.dtype) and type(_fs_transfer_dtype).__module__.startswith('numpy')) or type(_fs_transfer_dtype) in (_fs_transfer_pd.Int64Dtype, _fs_transfer_pd.Float64Dtype, _fs_transfer_pd.BooleanDtype, _fs_transfer_pd.StringDtype)",
        "        if not _fs_transfer_builtin_dtype or str(_fs_transfer_dtype) not in ('int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'float16', 'float32', 'float64', 'bool', 'Int64', 'Float64', 'boolean', 'string', 'object'): raise ValueError('Unsupported pandas column dtype')",
        "        _fs_transfer_values = [None if (v is None or v is _fs_transfer_pd.NA or (type(v) is float and _fs_transfer_math.isnan(v))) else v for v in _fs_transfer_column.tolist()]",
        "        _fs_transfer_type_name = _fs_transfer_check(_fs_transfer_values, 128)",
        "        _fs_transfer_columns.append({'name': _fs_transfer_key, 'type': _fs_transfer_type_name, 'values': _fs_transfer_values})",
        "    _fs_transfer_packet = {'kind': 'table', 'columns': _fs_transfer_columns}",
        "elif _fs_transfer_kind == 'ndarray':",
        "    if _fs_transfer_obj.ndim != 1 or not 1 <= _fs_transfer_obj.size <= 256: raise ValueError('NumPy vector requires 1-256 elements and exactly one dimension')",
        "    if str(_fs_transfer_obj.dtype) not in ('int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'float16', 'float32', 'float64', 'bool') and not (_fs_transfer_obj.dtype.kind == 'U' and 0 < _fs_transfer_obj.dtype.itemsize <= 2048): raise ValueError('Unsupported NumPy vector dtype')",
        "    _fs_transfer_values = _fs_transfer_obj.tolist()",
        "    _fs_transfer_values = [None if type(v) is float and _fs_transfer_math.isnan(v) else v for v in _fs_transfer_values]",
        "    _fs_transfer_type_name = _fs_transfer_check(_fs_transfer_values, 256)",
        "    _fs_transfer_packet = {'kind': 'vector', 'type': _fs_transfer_type_name, 'values': _fs_transfer_values}",
        "elif _fs_transfer_kind == 'table':",
        "    if not 1 <= len(_fs_transfer_obj) <= 16: raise ValueError('Python table requires 1-16 columns')",
        "    _fs_transfer_columns = []",
        "    _fs_transfer_rows = None",
        "    for _fs_transfer_key, _fs_transfer_column in _fs_transfer_obj.items():",
        "        if type(_fs_transfer_key) is not str or _fs_transfer_re.fullmatch('[A-Za-z][A-Za-z0-9_]{0,79}', _fs_transfer_key) is None: raise ValueError('Invalid Python table column name')",
        "        if type(_fs_transfer_column) not in (list, tuple): raise ValueError('Python table columns must be plain lists or tuples')",
        "        if len(_fs_transfer_column) > 128: raise ValueError(\'Python table exceeds row limit\')",
        "        _fs_transfer_values = list(_fs_transfer_column)",
        "        if _fs_transfer_rows is not None and len(_fs_transfer_values) != _fs_transfer_rows: raise ValueError('Python table columns have unequal lengths')",
        "        _fs_transfer_rows = len(_fs_transfer_values)",
        "        _fs_transfer_type_name = _fs_transfer_check(_fs_transfer_values, 128)",
        "        _fs_transfer_columns.append({'name': _fs_transfer_key, 'type': _fs_transfer_type_name, 'values': _fs_transfer_values})",
        "    _fs_transfer_packet = {'kind': 'table', 'columns': _fs_transfer_columns}",
        "else:",
        "    if _fs_transfer_kind == 'vector' and len(_fs_transfer_obj) > 256: raise ValueError(\'Python vector exceeds limit\')",
        "    _fs_transfer_values = list(_fs_transfer_obj) if _fs_transfer_kind == 'vector' else [_fs_transfer_obj]",
        "    _fs_transfer_type_name = _fs_transfer_check(_fs_transfer_values, 256)",
        "    _fs_transfer_packet = {'kind': _fs_transfer_kind, 'type': _fs_transfer_type_name, 'values': _fs_transfer_values}",
        "_fs_transfer_json.dumps(_fs_transfer_packet, allow_nan=False)",
      ].join("\n");
      const raw = await py.runPythonAsync(query);
      if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 32768)
        throw Error("Invalid Python transfer response.");
      const packet = JSON.parse(raw);
      if (!validTransferPacket(packet)) throw Error("Invalid Python transfer payload.");
      // Session export alone needs the original pandas identity. Keep the
      // ordinary Python/R transfer packet and its response unchanged.
      if (op === "export-snapshot") {
        const origin = await py.runPythonAsync("_fs_transfer_kind");
        if (origin === "pandas" && packet.kind !== "table")
          throw Error("Invalid pandas session snapshot.");
        self.postMessage(origin === "pandas" ?
          {id, ok:true, value:packet, origin:"pandas"} : {id, ok:true, value:packet});
      } else self.postMessage({id, ok:true, value:packet});
      return;
    }
    if (op === "import-numpy") {
      // Explicit R vector -> ndarray conversion. Keep missing numeric values as NaN;
      // reject missing logical/string values before loading NumPy to avoid silent coercion.
      await py.loadPackage("numpy");
      const query = [
        "import json as _fs_transfer_json, numpy as _fs_transfer_np",
        "_fs_transfer_packet = _fs_transfer_json.loads(" + JSON.stringify(JSON.stringify(transferValue)) + ")",
        "_fs_transfer_dtype = {'number': _fs_transfer_np.float64, 'boolean': _fs_transfer_np.bool_, 'string': _fs_transfer_np.str_}[_fs_transfer_packet['type']]",
        "_fs_transfer_array = _fs_transfer_np.asarray(_fs_transfer_packet['values'], dtype=_fs_transfer_dtype)",
        "if type(_fs_transfer_array) is not _fs_transfer_np.ndarray or _fs_transfer_array.ndim != 1: raise ValueError('Invalid NumPy transfer result')",
        "globals()[" + JSON.stringify(code) + "] = _fs_transfer_array",
        "'ok'"
      ].join("\n");
      const acknowledgement = await py.runPythonAsync(query);
      if (acknowledgement !== "ok") throw Error("NumPy transfer assignment did not acknowledge success.");
      self.postMessage({id, ok:true});
      return;
    }
    if (op === "import-pandas") {
      // Opt-in: fetch the real Pyodide pandas package and construct typed columns
      // before assigning the destination. Failed conversions leave it untouched.
      await py.loadPackage("pandas");
      const query = [
        "import json as _fs_transfer_json, pandas as _fs_transfer_pd",
        "_fs_transfer_packet = _fs_transfer_json.loads(" + JSON.stringify(JSON.stringify(transferValue)) + ")",
        "_fs_transfer_columns = {}",
        "for _fs_transfer_column in _fs_transfer_packet['columns']:",
        "    _fs_transfer_dtype = {'number': 'Float64', 'boolean': 'boolean', 'string': 'string'}[_fs_transfer_column['type']]",
        "    _fs_transfer_columns[_fs_transfer_column['name']] = _fs_transfer_pd.Series(_fs_transfer_column['values'], dtype=_fs_transfer_dtype)",
        "_fs_transfer_frame = _fs_transfer_pd.DataFrame(_fs_transfer_columns)",
        "globals()[" + JSON.stringify(code) + "] = _fs_transfer_frame",
        "'ok'"
      ].join("\n");
      const acknowledgement = await py.runPythonAsync(query);
      if (acknowledgement !== "ok") throw Error("Pandas transfer assignment did not acknowledge success.");
      self.postMessage({id, ok:true});
      return;
    }
    if (op === "import") {
      // A JSON literal is parsed inside the existing Python globals; never eval() user text.
      const query = [
        "import json as _fs_transfer_json",
        "_fs_transfer_packet = _fs_transfer_json.loads(" + JSON.stringify(JSON.stringify(transferValue)) + ")",
        "globals()[" + JSON.stringify(code) + "] = {c['name']: c['values'] for c in _fs_transfer_packet['columns']} if _fs_transfer_packet['kind'] == 'table' else (_fs_transfer_packet['values'] if _fs_transfer_packet['kind'] == 'vector' else _fs_transfer_packet['values'][0])",
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
    if (op === "inspect") {
      await prepareEnvironmentCapture(py);
      const raw = await py.runPythonAsync("import json as _fs_json, flowstudio_environment_capture as _fs_environment_capture\n_fs_json.dumps(_fs_environment_capture.capture(globals()), ensure_ascii=True, separators=(',', ':'))");
      if (typeof raw !== "string" || raw.length > 65536)
        throw Error("Python environment response exceeds 64 KiB.");
      const snapshot = validateEnvironmentSnapshot(JSON.parse(raw));
      self.postMessage({id, ok:true, variables:snapshot.variables, truncated:snapshot.truncated});
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
    const value = await py.runPythonAsync(code);
    const rendered = value === undefined || value === null ? "" : String(value).slice(0, MAX_OUTPUT);
    if (value && typeof value.destroy === "function") value.destroy();
    if (op === "run" && plotCaptureLoaded) {
      const captured = await capturePlots(py);
      plots = captured.plots;
      if (captured.warning) plotWarning = captured.warning;
    }
    self.postMessage({id, ok:true, output:(stdout + rendered + (stderr ? "\n" + stderr : "")).slice(0, MAX_OUTPUT), plots, plotWarning});
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
