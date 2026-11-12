/* FlowStudio debugger (VS Code "Run and Debug" model).
 *
 * One front end for three real back ends:
 *   Flow    LLDB on a source-mapped build      /api/debug/flow/*
 *   Python  the persistent kernel's bdb tracer  /api/debug/python/*
 *   R       top-level expression stepping       /api/debug/r/*
 *
 * Breakpoints live in the editor gutter as Monaco decorations, so they move
 * with edits. F5 starts or continues, F10/F11/Shift+F11 step, Shift+F5 stops,
 * F9 toggles a breakpoint. While paused the editor marks the current line, a
 * floating toolbar holds the controls, and the Debug view shows variables,
 * watch expressions, the call stack, breakpoints and a debug console. */
(function (root) {
"use strict";

const MOUSE_GUTTER_GLYPH = 2;          // monaco.editor.MouseTargetType
const MOUSE_GUTTER_LINE_NUMBERS = 3;
const POLL_MS = 500;

/* ---------- adapters: normalise each back end to one snapshot ---------- */
function snapshot(state, extra) {
  return Object.assign({ state, frames: [], output: "", message: "", line: null }, extra || {});
}
const ADAPTERS = {
  flow: {
    label: "Flow (LLDB)", route: "/api/debug/flow/",
    breakpointsBody: points => JSON.stringify({ breakpoints: points.map(p => p.condition ? { line: p.line, condition: p.condition } : { line: p.line }) }),
    caps: { stepInto: true, stepOut: true, pause: true, evaluate: true, conditions: "C expression, e.g. i >= 3" },
    startBody: (source, points) => JSON.stringify({ source,
      breakpoints: points.map(p => p.condition ? { line: p.line, condition: p.condition } : { line: p.line }) }),
    ops: { into: "step", over: "next", out: "finish", continue: "continue", pause: "pause", stop: "stop", status: "status" },
    parse(body) {
      const frames = (body.stack || []).map(frame => ({ name: frame.function, line: frame.line,
        variables: Object.entries(frame.locals || {}).map(([name, v]) => ({ name, type: v.type, value: v.value })) }));
      return snapshot(normaliseState(body.state), { frames, output: body.output || "", message: body.message || "",
        line: frames.length ? frames[0].line : null, exitCode: body.exit_code, evaluation: body.evaluation });
    }
  },
  python: {
    label: "Python", route: "/api/debug/python/",
    breakpointsBody: points => JSON.stringify(points.map(p => p.condition ? { line: p.line, condition: p.condition.replace(/\s+/g, "") } : p.line)),
    caps: { stepInto: true, stepOut: true, pause: false, evaluate: false, conditions: "numeric local comparison, e.g. i>=3" },
    startBody: (source, points, options) => JSON.stringify({ source,
      breakpoints: points.map(p => p.condition ? { line: p.line, condition: p.condition.replace(/\s+/g, "") } : p.line),
      pause_on_exception: !!options.pauseOnException }),
    ops: { into: "step", over: "next", out: "finish", continue: "continue", cursor: "run-to-line", stop: "stop", status: "status" },
    parse(body) {
      const frames = (body.stack || []).map(frame => ({ name: frame.function === "<module>" ? "<module>" : frame.function,
        line: frame.line,
        variables: Object.entries(frame.locals || {}).map(([name, v]) => ({ name, type: v.type,
          value: v.value !== undefined ? v.value : "<" + v.type + ">" })) }));
      let message = body.message || "";
      if (body.exception && body.exception.type)
        message = body.exception.type + (body.exception.message ? ": " + body.exception.message : "");
      return snapshot(normaliseState(body.state), { frames, output: body.output || "", message,
        line: frames.length ? frames[0].line : null, exception: body.exception || null });
    }
  },
  r: {
    label: "R", route: "/api/debug/r/",
    caps: { stepInto: false, stepOut: false, pause: false, evaluate: true, conditions: "numeric comparison, e.g. counter>=2" },
    startBody: source => source,
    ops: { over: "step", continue: "continue", cursor: "continue", stop: "stop", status: "status" },
    parse(body) {
      const line = typeof body.next_line === "number" ? body.next_line :
        typeof body.failed_line === "number" ? body.failed_line : null;
      const frames = (body.frames || []).map(frame => ({ name: frame.call, line: frame.definition_line,
        variables: (frame.locals || []).map(name => ({ name, type: "", value: "" })) }));
      if (line != null) frames.unshift({ name: "top level", line, variables: [] });
      const state = body.state === "error" ? "error" : normaliseState(body.state);
      return snapshot(state, { frames, output: body.output || "", line,
        message: body.state === "error" ? "R stopped with an error at line " + body.failed_line : "" });
    }
  }
};
function normaliseState(state) {
  if (state === "paused" || state === "running") return state;
  if (state === "error") return "error";
  if (state === "done" || state === "finished") return "done";
  return "idle";
}
/* R continues to the next breakpoint line strictly after the current one. */
function rContinueTargets(points, currentLine) {
  return points.filter(p => currentLine == null || p.line > currentLine)
    .map(p => p.condition ? p.line + "?" + p.condition.replace(/\s+/g, "") : String(p.line)).join(",");
}
function languageOf(doc, select) {
  const id = doc && doc.language;
  if (id === "flow" || id === "python" || id === "r") return id;
  const name = doc && (doc.path || doc.name) || "";
  if (/\.flow$/i.test(name)) return "flow";
  if (/\.py$/i.test(name)) return "python";
  if (/\.r$/i.test(name)) return "r";
  return select && ADAPTERS[select.value] ? select.value : "flow";
}

/* ---------- breakpoints on Monaco models ---------- */
function createBreakpoints(storage) {
  const byModel = new Map();          // model -> Map(decorationId -> {condition, enabled})
  const listeners = new Set();
  function entry(model) {
    if (!byModel.has(model)) byModel.set(model, new Map());
    return byModel.get(model);
  }
  function decorationFor(line, info) {
    return { range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { stickiness: 1, glyphMarginClassName: "dbg-bp" + (info.condition ? " dbg-bp-cond" : "") +
        (info.enabled ? "" : " dbg-bp-off"),
        glyphMarginHoverMessage: { value: info.condition ? "Breakpoint if `" + info.condition + "`" : "Breakpoint" } } };
  }
  function list(model) {
    if (!model) return [];
    const points = [];
    for (const [id, info] of entry(model)) {
      const range = model.getDecorationRange(id);
      if (range) points.push({ id, line: range.startLineNumber, condition: info.condition, enabled: info.enabled });
    }
    return points.sort((a, b) => a.line - b.line);
  }
  function find(model, line) { return list(model).find(p => p.line === line) || null; }
  function set(model, line, info) {
    const current = find(model, line);
    const map = entry(model);
    const old = current ? [current.id] : [];
    if (current) map.delete(current.id);
    const ids = info ? model.deltaDecorations(old, [decorationFor(line, info)]) : model.deltaDecorations(old, []);
    if (info) map.set(ids[0], info);
    changed(model);
  }
  function toggle(model, line) {
    if (find(model, line)) set(model, line, null);
    else set(model, line, { condition: "", enabled: true });
  }
  function update(model, id, patch) {
    const point = list(model).find(p => p.id === id);
    if (!point) return;
    set(model, point.line, Object.assign({ condition: point.condition, enabled: point.enabled }, patch));
  }
  function clear(model) {
    const map = entry(model);
    model.deltaDecorations([...map.keys()], []);
    map.clear();
    changed(model);
  }
  function changed(model) { for (const fn of listeners) fn(model); }
  return { list, toggle, set, update, clear, find, onChange: fn => listeners.add(fn),
    active: model => list(model).filter(p => p.enabled) };
}

/* ---------- the debugger controller and its views ---------- */
function mount(doc, options = {}) {
  const view = doc.getElementById("view-debug");
  const editorApi = options.editor || root.FlowStudioEditor;
  const app = options.app || root.FlowStudioApp;
  const request = options.fetch || (typeof fetch === "function" ? fetch.bind(root) : null);
  if (!view || !editorApi || !editorApi.editor || !app || !request) return null;
  const editor = editorApi.editor;
  const languageSelect = doc.getElementById("language");
  let storage = null;
  try { storage = options.storage || root.localStorage; } catch (_) { storage = null; }
  editor.updateOptions({ glyphMargin: true });
  const breakpoints = createBreakpoints(storage);

  const h = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const ICON = {
    play: '<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>',
    cont: '<path d="M3.5 3.5v9" /><path d="M6.5 3.5v9l6.5-4.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
    over: '<path d="M2.5 9a5.5 5.5 0 0 1 10.6-2"/><path d="M13.5 3.5v3.5H10"/><circle cx="8" cy="12.5" r="1.3" fill="currentColor"/>',
    into: '<path d="M8 2v7.5"/><path d="M5 6.5l3 3 3-3"/><circle cx="8" cy="13" r="1.3" fill="currentColor"/>',
    out: '<path d="M8 10V2.5"/><path d="M5 5.5l3-3 3 3"/><circle cx="8" cy="13" r="1.3" fill="currentColor"/>',
    restart: '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v3h-3"/>',
    stop: '<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    clear: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'
  };
  const svg = name => '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
  const iconButton = (id, title, icon, onClick, className) => {
    const button = h("button", className || "sv-icon");
    button.type = "button";
    if (id) button.id = id;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = svg(icon);
    button.addEventListener("click", onClick);
    return button;
  };

  /* ----- Debug view ----- */
  view.className = "body debug-view";
  view.replaceChildren();
  const launch = h("div", "dbg-launch");
  const startButton = h("button", "dbg-start");
  startButton.type = "button";
  startButton.id = "debugStart";
  startButton.innerHTML = svg("play") + "<span>Start Debugging</span><kbd>F5</kbd>";
  startButton.addEventListener("click", () => void start());
  const target = h("div", "dbg-target");
  target.id = "debugTarget";
  const exceptionLabel = h("label", "dbg-check");
  const exceptionBox = h("input");
  exceptionBox.type = "checkbox";
  exceptionBox.id = "debugPauseOnException";
  exceptionLabel.append(exceptionBox, h("span", "", "Pause on uncaught exceptions"));
  launch.append(startButton, target, exceptionLabel);
  const statusLine = h("div", "dbg-status");
  statusLine.id = "debugStatus";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");

  function section(id, title, actions) {
    const wrap = h("section", "dbg-section");
    wrap.id = id;
    const head = h("button", "dbg-section-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "true");
    head.innerHTML = '<svg class="dbg-chev" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>';
    head.append(h("span", "", title));
    const tools = h("span", "dbg-section-tools");
    for (const action of actions || []) tools.append(action);
    const body = h("div", "dbg-section-body");
    head.addEventListener("click", event => {
      if (tools.contains(event.target)) return;
      const open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
    });
    const row = h("div", "dbg-section-row");
    row.append(head, tools);
    wrap.append(row, body);
    return { wrap, body };
  }
  const variables = section("debugVariables", "Variables");
  const watchAdd = iconButton("debugWatchAdd", "Add expression", "plus", () => addWatch());
  const watch = section("debugWatch", "Watch", [watchAdd]);
  const stack = section("debugCallStack", "Call Stack");
  const bpClear = iconButton("debugBreakpointsClear", "Remove all breakpoints", "clear", () => {
    const model = editor.getModel();
    if (model) breakpoints.clear(model);
  });
  const bps = section("debugBreakpoints", "Breakpoints", [bpClear]);
  const consoleSection = section("debugConsole", "Debug Console");
  const consoleOut = h("pre", "dbg-console-out");
  consoleOut.id = "debugConsoleOutput";
  const consoleIn = h("input", "dbg-console-in");
  consoleIn.id = "debugConsoleInput";
  consoleIn.type = "text";
  consoleIn.spellcheck = false;
  consoleIn.autocomplete = "off";
  consoleIn.placeholder = "Evaluate an expression while paused";
  consoleSection.body.append(consoleOut, consoleIn);
  view.append(launch, statusLine, variables.wrap, watch.wrap, stack.wrap, bps.wrap, consoleSection.wrap);

  /* ----- floating toolbar over the editor ----- */
  const host = doc.getElementById("monacoHost");
  const toolbar = h("div", "dbg-toolbar");
  toolbar.id = "debugToolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Debug");
  toolbar.hidden = true;
  const tb = {
    cont: iconButton("debugContinue", "Continue (F5)", "cont", () => void command("continue"), "dbg-tb"),
    pause: iconButton("debugPause", "Pause (F6)", "pause", () => void command("pause"), "dbg-tb"),
    over: iconButton("debugStepOver", "Step Over (F10)", "over", () => void command("over"), "dbg-tb"),
    into: iconButton("debugStepInto", "Step Into (F11)", "into", () => void command("into"), "dbg-tb"),
    out: iconButton("debugStepOut", "Step Out (Shift+F11)", "out", () => void command("out"), "dbg-tb"),
    restart: iconButton("debugRestart", "Restart (Ctrl+Shift+F5)", "restart", () => void restart(), "dbg-tb"),
    stop: iconButton("debugStop", "Stop (Shift+F5)", "stop", () => void stop(), "dbg-tb dbg-tb-stop")
  };
  const grip = h("span", "dbg-grip");
  toolbar.append(grip, ...Object.values(tb));
  /* The toolbar sits in the breadcrumb row so it never covers code or tabs. */
  const crumbRow = doc.querySelector ? doc.querySelector(".editor-breadcrumb") : null;
  if (crumbRow) crumbRow.append(toolbar);
  else if (host && host.parentElement) host.parentElement.append(toolbar);

  /* ----- state ----- */
  let session = null;      // {language, adapter, docId, model, snap, selected}
  let pollTimer = 0;
  let busy = false;
  let currentDecorations = [];
  let watches = [];
  try { watches = JSON.parse((storage && storage.getItem("flowstudio.debug.watch")) || "[]").filter(w => typeof w === "string").slice(0, 20); }
  catch (_) { watches = []; }
  const watchValues = new Map();

  function activeDoc() { return app.documents && app.documents.active ? app.documents.active() : null; }
  function currentLanguage() { return languageOf(activeDoc(), languageSelect); }
  function status(message, kind) { if (typeof app.status === "function") app.status(message, kind); }
  async function post(route, body) {
    const response = await request(route, { method: "POST", body: body || "",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" } });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    return { ok: response.ok, status: response.status, text, json };
  }

  async function start() {
    if (busy) return;
    if (session && session.snap.state !== "idle" && session.snap.state !== "done" && session.snap.state !== "error") {
      return command("continue");
    }
    const docNow = activeDoc();
    const model = editor.getModel();
    if (!docNow || !model) { status("Open a file to debug.", "error"); return; }
    const language = currentLanguage();
    const adapter = ADAPTERS[language];
    const points = breakpoints.active(model);
    busy = true;
    session = { language, adapter, docId: docNow.id, model, snap: snapshot("running"), selected: 0, output: "" };
    consoleOut.textContent = "";
    render();
    log("Starting " + adapter.label + " debugger" + (points.length ? " with " + points.length +
      (points.length === 1 ? " breakpoint" : " breakpoints") : ", pausing on the first line") + ".\n", "meta");
    try {
      const body = adapter.startBody(model.getValue(), points, { pauseOnException: exceptionBox.checked });
      let reply = await post(adapter.route + "start", body);
      /* A session left by a closed or reloaded page blocks the kernel: end it
       * and start again, as VS Code does when relaunching. */
      if (!reply.ok && reply.json && /already active|Stop the paused/i.test(reply.json.message || "")) {
        await post(adapter.route + "stop", "");
        reply = await post(adapter.route + "start", body);
      }
      if (!reply.json) throw new Error(reply.text || "The debugger did not answer.");
      let snap = adapter.parse(reply.json);
      if (!reply.ok && snap.state === "idle") throw new Error(snap.message || reply.text);
      /* R pauses before the first expression; run on to the first breakpoint. */
      if (language === "r" && snap.state === "paused" && points.length &&
          !points.some(p => p.line === snap.line)) {
        const next = await post(adapter.route + "continue", rContinueTargets(points, snap.line));
        if (next.json) snap = mergeOutput(snap, adapter.parse(next.json));
      }
      await accept(snap);
    } catch (error) {
      session.snap = snapshot("error", { message: error.message || String(error) });
      log((error.message || String(error)) + "\n", "error");
      render();
    } finally {
      busy = false;
      render();
    }
  }
  function mergeOutput(first, second) {
    second.output = [first.output, second.output].filter(Boolean).join("\n");
    return second;
  }
  async function command(name) {
    if (!session || busy) return;
    const { adapter, language } = session;
    const op = adapter.ops[name];
    if (!op) return;
    if (name === "pause" && session.snap.state !== "running") return;
    if (name !== "pause" && session.snap.state !== "paused") return;
    busy = true;
    if (syncPending) await syncBreakpoints();
    if (name !== "pause") { session.snap = Object.assign({}, session.snap, { state: "running" }); render(); }
    try {
      let body = "";
      if (language === "r" && name === "continue") body = rContinueTargets(breakpoints.active(session.model), session.snap.line);
      if (name === "cursor") {
        const position = editor.getPosition();
        if (!position || editor.getModel() !== session.model) throw new Error("Put the cursor in the file being debugged.");
        body = String(position.lineNumber);
      }
      const reply = await post(adapter.route + op, body);
      if (!reply.json) throw new Error(reply.text || "The debugger did not answer.");
      await accept(adapter.parse(reply.json));
      if (!reply.ok && session.snap.message) log(session.snap.message + "\n", "error");
    } catch (error) {
      log((error.message || String(error)) + "\n", "error");
      session.snap = Object.assign({}, session.snap, { state: "paused" });
    } finally {
      busy = false;
      render();
    }
  }
  async function stop() {
    clearTimeout(pollTimer);
    if (!session) return;
    const { adapter } = session;
    try { await post(adapter.route + "stop", ""); } catch (_) { /* best effort */ }
    log("Debugging stopped.\n", "meta");
    session.snap = snapshot("idle");
    render();
  }
  async function restart() {
    if (!session) return start();
    await stop();
    session = null;
    return start();
  }
  async function accept(snap) {
    clearTimeout(pollTimer);
    const before = session.output || "";
    if (session.language === "r") {
      if (snap.output && snap.output !== "(No output)") log(snap.output.replace(/\n?$/, "\n"), "out");
    } else if (snap.output && snap.output !== before) {
      log(snap.output.startsWith(before) ? snap.output.slice(before.length) : snap.output, "out");
      session.output = snap.output;
    }
    session.snap = snap;
    session.selected = 0;
    if (snap.state === "paused") {
      if (session.language === "r") await loadRVariables();
      await refreshWatches();
      revealCurrent();
      status("Paused at line " + snap.line + (snap.message ? ": " + snap.message : "") + ".", "ok");
    } else if (snap.state === "running") {
      status("Running under the debugger...");
      pollTimer = setTimeout(poll, POLL_MS);
    } else if (snap.state === "done") {
      log("Program finished" + (snap.exitCode != null ? " with exit code " + snap.exitCode : "") + ".\n", "meta");
      status("Debugging finished.", "ok");
    } else if (snap.state === "error") {
      if (snap.message) log(snap.message + "\n", "error");
      status("Debugging stopped with an error.", "error");
      revealCurrent();
    }
    render();
  }
  async function poll() {
    if (!session || session.snap.state !== "running" || busy) return;
    try {
      const reply = await post(session.adapter.route + session.adapter.ops.status, "");
      if (reply.json) await accept(session.adapter.parse(reply.json));
    } catch (_) { pollTimer = setTimeout(poll, POLL_MS * 2); }
  }
  async function loadRVariables() {
    try {
      const reply = await post("/api/inspect/r", "");
      if (!reply.json || !session.snap.frames.length) return;
      session.snap.frames[0].variables = (reply.json.variables || []).map(v => ({ name: v.name,
        type: v.type, value: (v.type || "") + " " + (Array.isArray(v.dimensions) ? v.dimensions.join(" × ") :
          v.size != null ? "[" + v.size + "]" : "") }));
    } catch (_) { /* variables are optional */ }
  }

  /* ----- watch and evaluate ----- */
  async function evaluate(expression) {
    if (!session || session.snap.state !== "paused") return { error: "not paused" };
    const frame = session.snap.frames[session.selected];
    if (session.language === "python") {
      const local = frame && frame.variables.find(v => v.name === expression.trim());
      return local ? { value: local.value, type: local.type } : { error: "Python watches show local names" };
    }
    if (session.language === "flow") {
      const reply = await post("/api/debug/flow/evaluate", expression);
      const result = reply.json && reply.json.evaluation;
      return result ? (result.error ? { error: result.error } : { value: result.value, type: result.type })
        : { error: reply.text.slice(0, 200) };
    }
    const reply = await post("/api/debug/r/evaluate", expression);
    const text = reply.json ? String(reply.json.output || "").trim() : reply.text;
    return reply.ok ? { value: text.replace(/^\[1\]\s*/, "") } : { error: text.slice(0, 200) };
  }
  async function refreshWatches() {
    watchValues.clear();
    for (const expression of watches) watchValues.set(expression, await evaluate(expression));
  }
  function addWatch(preset) {
    const expression = preset != null ? preset : root.prompt ? root.prompt("Expression to watch") : "";
    if (!expression || !expression.trim()) return;
    watches = [...new Set([...watches, expression.trim()])].slice(0, 20);
    saveWatches();
    void refreshWatches().then(render);
    render();
  }
  function saveWatches() { try { storage && storage.setItem("flowstudio.debug.watch", JSON.stringify(watches)); } catch (_) {} }
  consoleIn.addEventListener("keydown", async event => {
    if (event.key !== "Enter" || !consoleIn.value.trim()) return;
    event.preventDefault();
    const expression = consoleIn.value.trim();
    consoleIn.value = "";
    log("> " + expression + "\n", "input");
    const result = await evaluate(expression);
    log((result.error ? result.error : result.value + (result.type ? "  (" + result.type + ")" : "")) + "\n",
      result.error ? "error" : "out");
  });

  /* ----- editor decorations ----- */
  function revealCurrent() {
    const snap = session && session.snap;
    if (!snap || snap.line == null) { clearCurrent(); return; }
    if (activeDoc() && activeDoc().id !== session.docId && app.activateDocument) app.activateDocument(session.docId);
    const frame = snap.frames[session.selected];
    const line = frame && frame.line != null ? frame.line : snap.line;
    const model = editor.getModel();
    if (!model || model !== session.model) return;
    const decorations = [];
    if (snap.line != null) decorations.push({ range: { startLineNumber: snap.line, startColumn: 1, endLineNumber: snap.line, endColumn: 1 },
      options: { isWholeLine: true, className: snap.state === "error" ? "dbg-line-error" : "dbg-line-current",
        glyphMarginClassName: "dbg-arrow" } });
    if (session.selected > 0 && line !== snap.line) decorations.push({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { isWholeLine: true, className: "dbg-line-frame" } });
    currentDecorations = model.deltaDecorations(currentDecorations, decorations);
    editor.revealLineInCenterIfOutsideViewport(line);
  }
  function clearCurrent() {
    if (session && session.model && currentDecorations.length) {
      try { currentDecorations = session.model.deltaDecorations(currentDecorations, []); } catch (_) { currentDecorations = []; }
    }
  }
  editor.onMouseDown(event => {
    const type = event.target && event.target.type;
    if (type !== MOUSE_GUTTER_GLYPH && type !== MOUSE_GUTTER_LINE_NUMBERS) return;
    if (type === MOUSE_GUTTER_LINE_NUMBERS && !event.event.altKey) return;
    const line = event.target.position && event.target.position.lineNumber;
    const model = editor.getModel();
    if (line && model) breakpoints.toggle(model, line);
  });
  let hintDecorations = [];
  editor.onMouseMove(event => {
    const model = editor.getModel();
    if (!model) return;
    const line = event.target && event.target.type === MOUSE_GUTTER_GLYPH && event.target.position
      ? event.target.position.lineNumber : null;
    const hint = line && !breakpoints.find(model, line) ? [{ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { glyphMarginClassName: "dbg-bp-hint" } }] : [];
    hintDecorations = model.deltaDecorations(hintDecorations, hint);
  });
  editor.onMouseLeave(() => {
    const model = editor.getModel();
    if (model) hintDecorations = model.deltaDecorations(hintDecorations, []);
  });
  editor.onDidChangeModel(() => { hintDecorations = []; render(); if (session) revealCurrent(); });
  /* Breakpoint edits during a session reach the running debugger at once;
   * R reads them on every Continue instead. */
  let syncTimer = 0;
  let syncPending = false;
  function syncBreakpoints() {
    clearTimeout(syncTimer);
    syncPending = false;
    if (!session || !session.adapter.breakpointsBody) return Promise.resolve();
    if (session.snap.state !== "paused" && session.snap.state !== "running") return Promise.resolve();
    const { adapter, model } = session;
    return post(adapter.route + "breakpoints", adapter.breakpointsBody(breakpoints.active(model)))
      .then(reply => { if (!reply.ok && reply.json && reply.json.message) log(reply.json.message + "\n", "error"); })
      .catch(() => {});
  }
  breakpoints.onChange(model => {
    render();
    if (!session || model !== session.model || !session.adapter.breakpointsBody) return;
    clearTimeout(syncTimer);
    syncPending = true;
    syncTimer = setTimeout(() => void syncBreakpoints(), 120);
  });

  /* ----- keyboard ----- */
  doc.addEventListener("keydown", event => {
    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    let handled = true;
    const active = session && (session.snap.state === "paused" || session.snap.state === "running");
    if (key === "F5" && ctrl && event.shiftKey) void restart();
    else if (key === "F5" && event.shiftKey) { if (active) void stop(); else handled = false; }
    else if (key === "F5" && !ctrl) void start();
    else if (key === "F6" && active) void command("pause");
    else if (key === "F9") toggleAtCursor();
    else if (key === "F10" && ctrl && active) void command("cursor");
    else if (key === "F10" && active) void command("over");
    else if (key === "F11" && event.shiftKey && active) void command("out");
    else if (key === "F11" && active) void command("into");
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }, true);
  function toggleAtCursor() {
    const model = editor.getModel();
    const position = editor.getPosition();
    if (model && position) breakpoints.toggle(model, position.lineNumber);
  }

  /* ----- rendering ----- */
  function log(text, kind) {
    const span = h("span", "dbg-log-" + (kind || "out"), text);
    consoleOut.append(span);
    while (consoleOut.childNodes.length > 400) consoleOut.firstChild.remove();
    consoleOut.scrollTop = consoleOut.scrollHeight;
  }
  function render() {
    const snap = session ? session.snap : snapshot("idle");
    const active = snap.state === "paused" || snap.state === "running";
    const language = active && session ? session.language : currentLanguage();
    const adapter = ADAPTERS[language];
    startButton.disabled = busy && !active;
    startButton.querySelector("span").textContent = active ? "Continue" : "Start Debugging";
    target.textContent = adapter.label + "  " + (activeDoc() ? (activeDoc().name || "") : "");
    exceptionLabel.hidden = language !== "python";
    statusLine.textContent = !session ? "Set breakpoints in the editor gutter, then press F5." :
      snap.state === "paused" ? "Paused at line " + snap.line + (snap.message ? ". " + snap.message : "") :
      snap.state === "running" ? "Running" : snap.state === "done" ? "Finished" :
      snap.state === "error" ? (snap.message || "Stopped with an error").split("\n")[0] : "Not running";
    statusLine.dataset.state = snap.state;
    toolbar.hidden = !active;
    tb.cont.hidden = snap.state === "running";
    tb.pause.hidden = snap.state !== "running";
    tb.pause.disabled = !adapter.caps.pause;
    for (const key of ["over", "into", "out"]) tb[key].disabled = snap.state !== "paused" || busy;
    tb.into.hidden = !adapter.caps.stepInto;
    tb.out.hidden = !adapter.caps.stepOut;
    tb.cont.disabled = snap.state !== "paused" || busy;
    consoleIn.disabled = !(snap.state === "paused" && adapter.caps.evaluate);
    consoleIn.placeholder = adapter.caps.evaluate ? "Evaluate an expression while paused" :
      "Expressions are not evaluated in this debugger";
    if (!active) clearCurrent();
    renderVariables(snap);
    renderWatch(snap);
    renderStack(snap);
    renderBreakpoints(adapter);
  }
  function renderVariables(snap) {
    variables.body.replaceChildren();
    const frame = session && snap.frames[session.selected];
    if (!frame || snap.state !== "paused") {
      variables.body.append(h("div", "dbg-empty", snap.state === "paused" ? "No variables." : "Not paused."));
      return;
    }
    if (!frame.variables.length) variables.body.append(h("div", "dbg-empty", "No variables in this frame."));
    for (const variable of frame.variables) {
      const row = h("div", "dbg-var");
      row.dataset.name = variable.name;
      row.append(h("span", "dbg-var-name", variable.name), h("span", "dbg-var-value", variable.value));
      if (variable.type) row.title = variable.type;
      variables.body.append(row);
    }
  }
  function renderWatch(snap) {
    watch.body.replaceChildren();
    if (!watches.length) { watch.body.append(h("div", "dbg-empty", "No watch expressions.")); return; }
    for (const expression of watches) {
      const row = h("div", "dbg-var");
      row.dataset.expression = expression;
      const result = watchValues.get(expression);
      const value = snap.state !== "paused" ? "not available" : !result ? "..." :
        result.error ? result.error : result.value;
      const valueNode = h("span", "dbg-var-value" + (result && result.error ? " dbg-muted" : ""), value);
      const remove = iconButton(null, "Remove expression", "clear", () => {
        watches = watches.filter(item => item !== expression);
        saveWatches();
        render();
      }, "dbg-row-act");
      row.append(h("span", "dbg-var-name", expression), valueNode, remove);
      watch.body.append(row);
    }
  }
  function renderStack(snap) {
    stack.body.replaceChildren();
    if (!session || snap.state !== "paused" || !snap.frames.length) {
      stack.body.append(h("div", "dbg-empty", snap.state === "running" ? "Running." : "Not paused."));
      return;
    }
    snap.frames.forEach((frame, index) => {
      const row = h("button", "dbg-frame");
      row.type = "button";
      row.setAttribute("aria-current", String(index === session.selected));
      row.append(h("span", "dbg-frame-name", frame.name || "?"),
        h("span", "dbg-frame-line", frame.line != null ? "line " + frame.line : ""));
      row.addEventListener("click", () => {
        session.selected = index;
        revealCurrent();
        render();
      });
      stack.body.append(row);
    });
  }
  function renderBreakpoints(adapter) {
    bps.body.replaceChildren();
    const model = editor.getModel();
    const points = breakpoints.list(model);
    if (!points.length) {
      bps.body.append(h("div", "dbg-empty", "Click the gutter left of a line number, or press F9."));
      return;
    }
    for (const point of points) {
      const row = h("div", "dbg-bp-row");
      row.dataset.line = String(point.line);
      const box = h("input");
      box.type = "checkbox";
      box.checked = point.enabled;
      box.setAttribute("aria-label", "Enable breakpoint on line " + point.line);
      box.addEventListener("change", () => breakpoints.update(model, point.id, { enabled: box.checked }));
      const label = h("button", "dbg-bp-label");
      label.type = "button";
      const text = model.getLineContent(point.line).trim();
      label.append(h("span", "dbg-bp-line", String(point.line)), h("span", "dbg-bp-text", text.slice(0, 60)));
      label.addEventListener("click", () => { editor.revealLineInCenter(point.line); editor.setPosition({ lineNumber: point.line, column: 1 }); editor.focus(); });
      const condition = h("input", "dbg-bp-cond");
      condition.type = "text";
      condition.value = point.condition || "";
      condition.placeholder = "condition";
      condition.title = "Pause only when this holds: " + adapter.caps.conditions;
      condition.setAttribute("aria-label", "Condition for line " + point.line);
      condition.addEventListener("change", () => breakpoints.update(model, point.id, { condition: condition.value.trim() }));
      const remove = iconButton(null, "Remove breakpoint", "clear", () => breakpoints.set(model, point.line, null), "dbg-row-act");
      row.append(box, label, condition, remove);
      bps.body.append(row);
    }
  }
  if (app.documents && typeof doc.addEventListener === "function")
    doc.addEventListener("flowstudio:documents", () => render());
  if (languageSelect) languageSelect.addEventListener("change", () => render());
  render();

  const api = { start, command, stop, restart, evaluate, addWatch, breakpoints,
    state: () => (session ? session.snap : snapshot("idle")), session: () => session };
  return api;
}

const api = { mount, ADAPTERS, rContinueTargets, languageOf, createBreakpoints, normaliseState };
root.FlowStudioDebugger = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof document !== "undefined" && document.getElementById("view-debug")) {
  /* The Monaco bundle loads as a module after classic scripts; wait for it. */
  const start = () => {
    if (!root.FlowStudioEditor) { setTimeout(start, 50); return; }
    try { api.instance = mount(document); } catch (error) { if (root.console) root.console.error(error); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
