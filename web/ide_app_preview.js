/* Flow app Preview with hot reload.
 *
 * A Flow program that draws with stdlib/gfx.flow is built by the native
 * server into WebAssembly (POST /api/app/start, src/flow_app.c) and runs in
 * a frame in the side panel (web/app_host.html). The build runs in the
 * background on the server; the Preview follows it through
 * GET /flowapp/<build>/status and shows each stage with the time so far.
 *
 * While hot reload is on, an edit rebuilds after a short pause and a save
 * rebuilds at once. The new build is swapped in once it has drawn, so the
 * Preview never goes blank. A failed build leaves the last good build
 * running and shows the compiler message, with links to the lines.
 *
 * The width the person gives the side panel is kept per project and is not
 * changed by a rebuild. A reload restarts the program: its state starts
 * fresh each time.
 */
(function (root) {
"use strict";

const GFX_IMPORT = /^\s*import\s+["']stdlib\/gfx(?:\.flow)?["']/m;
const GFX_CALL = /\bgfx_open\s*\(/;
const DEBOUNCE_MS = 450;
const POLL_MS = 250;
const STATUS_MS = 120;
const TICK_MS = 100;
const SWAP_TIMEOUT_MS = 4000;
const SIZE_KEY = "flowstudio.preview.panel.v1";
const SIZE_ENTRIES = 40;

const STAGES = Object.freeze([
  { id: "check", label: "Checking Flow" },
  { id: "wasm", label: "Building WebAssembly" },
  { id: "load", label: "Starting the app" }
]);
const COLD_NOTE = "The first build sets up the WebAssembly toolchain. Later builds are quick.";

function isGraphicsProgram(source) {
  return typeof source === "string" && (GFX_IMPORT.test(source) || GFX_CALL.test(source));
}

/* "app.flow:12:5: error: message" lines from the strict checker or emcc. */
function parseErrors(log) {
  const errors = [];
  if (typeof log !== "string") return errors;
  const pattern = /(?:^|\/)app\.flow:(\d+):(\d+):\s*(?:error:\s*)?(.*)$/gm;
  let match;
  while ((match = pattern.exec(log)) && errors.length < 20)
    errors.push({ line: Number(match[1]), column: Number(match[2]), message: match[3].trim() });
  return errors;
}

function seconds(ms) {
  return (Math.max(0, ms) / 1000).toFixed(ms < 10000 ? 1 : 0) + " s";
}

function stageLabel(id) {
  const stage = STAGES.find(item => item.id === id);
  return stage ? stage.label : "Building";
}

function mount(doc, options = {}) {
  const el = id => doc.getElementById(id);
  const stage = el("previewStage");
  if (!stage) return null;
  const app = () => options.app || root.FlowStudioApp || null;
  const layout = () => options.layout || root.FlowStudioLayout || null;
  const projects = () => options.projects || root.FlowStudioProjects || null;
  const request = options.fetch || ((...args) => root.fetch(...args));
  const clock = options.clock || (() => Date.now());
  let storage = options.storage;
  if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }
  const title = el("previewTitle"), statusNode = el("previewStatus"), dot = el("previewDot");
  const errorBox = el("previewError"), empty = el("previewEmpty");
  const hot = el("previewHot"), restartButton = el("previewRestart"), stopButton = el("previewStop");

  let target = null;          // { id, name } of the document the app comes from
  let builtText = null;       // source of the running build
  let building = false;
  let queued = false;
  let queuedNow = false;      // the queued build came from a save: no pause
  let frame = null;           // the live iframe
  let pendingFrame = null;    // a new build loading behind it
  let pendingTimer = 0;
  let debounce = 0;
  let seenText = null;       // last text the poll saw, so a pause is detected
  let attemptText = null;    // source of the last build attempt, good or not
  let size = null;            // { width, height } reported by the app
  let builds = 0;
  let generation = 0;         // bumps on start and stop, so stale builds are ignored

  /* ---------- progress ---------- */
  let progress = null;        // { started, stage, cold, reason }
  let ticker = 0;
  let card = null;
  function makeCard() {
    if (card) return card;
    card = doc.createElement("div");
    card.className = "pv-progress";
    card.id = "previewProgress";
    card.setAttribute("role", "status");
    card.hidden = true;
    const heading = doc.createElement("p");
    heading.className = "pv-progress-title";
    const list = doc.createElement("ol");
    list.className = "pv-steps";
    for (const item of STAGES) {
      const row = doc.createElement("li");
      row.dataset.stage = item.id;
      row.textContent = item.label;
      list.append(row);
    }
    const time = doc.createElement("p");
    time.className = "pv-progress-time";
    const note = doc.createElement("p");
    note.className = "pv-progress-note";
    note.hidden = true;
    card.append(heading, list, time, note);
    card.parts = { heading, list, time, note };
    stage.append(card);
    return card;
  }
  function renderProgress() {
    if (!progress) return;
    const elapsed = seconds(clock() - progress.started);
    const label = stageLabel(progress.stage);
    const verb = progress.reason === "start" ? "" : progress.reason === "save" ? "Saved. " : "Rebuilding. ";
    setState("building", verb + label + "  " + elapsed);
    if (frame) { if (card) card.hidden = true; return; }
    const c = makeCard();
    c.hidden = false;
    c.dataset.stage = progress.stage;
    c.parts.heading.textContent = "Building " + (target ? target.name : "the app");
    const at = STAGES.findIndex(item => item.id === progress.stage);
    for (const row of c.parts.list.children) {
      const index = STAGES.findIndex(item => item.id === row.dataset.stage);
      row.dataset.state = index < at ? "done" : index === at ? "active" : "waiting";
    }
    c.parts.time.textContent = label + "  " + elapsed;
    c.parts.note.textContent = COLD_NOTE;
    c.parts.note.hidden = !progress.cold;
    if (empty) empty.hidden = true;
  }
  function beginProgress(reason) {
    progress = { started: clock(), stage: "check", cold: false, reason };
    clearInterval(ticker);
    ticker = setInterval(renderProgress, TICK_MS);
    renderProgress();
  }
  function stageProgress(id, cold) {
    if (!progress) return;
    progress.stage = STAGES.some(item => item.id === id) ? id : progress.stage;
    if (cold) progress.cold = true;
    renderProgress();
  }
  function endProgress() {
    const took = progress ? clock() - progress.started : 0;
    progress = null;
    clearInterval(ticker);
    ticker = 0;
    if (card) card.hidden = true;
    return took;
  }

  /* ---------- side panel width, per project ---------- */
  let userSized = false;      // the person sized the panel for this project
  let autoSized = false;      // the preview grew the panel once for this run
  function projectKey() {
    const p = projects();
    const current = p && typeof p.current === "function" ? p.current() : null;
    if (current && current.name) return "project:" + current.name;
    return target ? "doc:" + target.name : null;
  }
  function readSizes() {
    if (!storage) return {};
    try {
      const raw = storage.getItem(SIZE_KEY);
      const parsed = raw && raw.length < 8192 ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) { return {}; }
  }
  function savedWidth() {
    const key = projectKey();
    const value = key ? readSizes()[key] : null;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  function rememberWidth() {
    const l = layout();
    const key = projectKey();
    if (!l || !key || typeof l.layout !== "function" || !l.isVisible("right")) return;
    const width = l.layout().right;
    if (!Number.isFinite(width)) return;
    userSized = true;
    if (!storage) return;
    try {
      const sizes = readSizes();
      delete sizes[key];
      sizes[key] = width;
      const keys = Object.keys(sizes);
      for (const old of keys.slice(0, Math.max(0, keys.length - SIZE_ENTRIES))) delete sizes[old];
      storage.setItem(SIZE_KEY, JSON.stringify(sizes));
    } catch (_) { /* preferences are optional */ }
  }
  function restoreWidth() {
    const l = layout();
    const width = savedWidth();
    userSized = width !== null;
    if (l && width !== null && typeof l.setPanel === "function") l.setPanel("right", width);
  }
  /* Grows the panel to fit the app once per run, and only when the person
   * has not chosen a width for this project. A rebuild never resizes it. */
  function fitPanel() {
    const l = layout();
    if (!l || !size || userSized || autoSized || !l.isVisible("right")) return;
    autoSized = true;
    l.ensureSize("right", panelWidth());
  }
  const splitter = doc.querySelector ? doc.querySelector('[data-splitter][data-panel="right"]') : null;
  if (splitter && typeof doc.addEventListener === "function") {
    let dragging = false;
    splitter.addEventListener("pointerdown", () => { dragging = true; });
    doc.addEventListener("pointerup", () => { if (dragging) { dragging = false; rememberWidth(); } });
    splitter.addEventListener("keydown", event => {
      if (/^Arrow/.test(event.key || "")) setTimeout(rememberWidth, 0);
    });
    splitter.addEventListener("dblclick", () => setTimeout(rememberWidth, 0));
  }

  function setState(state, text) {
    if (dot) dot.dataset.state = state;
    if (statusNode) statusNode.textContent = text || "";
  }
  function documentText() {
    const a = app();
    if (!a || !target) return null;
    const document_ = a.documents.find(target.id);
    return document_ ? document_.text : null;
  }
  /* The canvas scales down, so the panel asks for at most 42% of the window
   * and leaves the editor most of the width. */
  function panelWidth() {
    const cap = Math.round((root.innerWidth || 1440) * 0.42);
    return Math.min(cap, (size ? size.width : 480) + 34);
  }
  let openedPanel = false;    // the preview opened the side panel itself
  function showPanel() {
    const l = layout();
    if (l) {
      if (!l.isVisible("right")) openedPanel = true;
      l.show("right");
      fitPanel();
    }
    const tab = el("rpTab-preview");
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  }
  function showError(log) {
    const errors = parseErrors(log);
    errorBox.replaceChildren();
    const text = (log || "The build failed without a message.").trim();
    if (errors.length) {
      for (const error of errors) {
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "pv-error-row";
        row.textContent = "Line " + error.line + ":" + error.column + "  " + error.message;
        row.addEventListener("click", () => {
          const a = app();
          if (a && target) {
            a.activateDocument(target.id);
            if (typeof a.revealPosition === "function") a.revealPosition(error.line, error.column);
          }
        });
        errorBox.append(row);
      }
    } else errorBox.textContent = text.slice(0, 4000);
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.hidden = true;
    errorBox.replaceChildren();
  }
  function post(target_, command) {
    try { target_.contentWindow.postMessage({ source: "flowstudio-ide", command }, root.location.origin); }
    catch (_) { /* frame is gone */ }
  }
  /* Shows next and retires the frame it replaces. Keyboard focus that was
   * in the old app moves to the new one; focus anywhere else is left. */
  function settle(next) {
    clearTimeout(pendingTimer);
    if (pendingFrame !== next) return;
    pendingFrame = null;
    const hadFocus = Boolean(frame && doc.activeElement === frame);
    if (frame && frame !== next) { post(frame, "stop"); frame.remove(); }
    frame = next;
    frame.classList.remove("pv-loading");
    if (hadFocus) {
      if (typeof frame.focus === "function") frame.focus();
      post(frame, "focus");
    }
    if (progress && progress.stage === "load") {
      const { reason, prebuilt } = progress;
      const took = endProgress();
      if (prebuilt && reason === "start") setState("live", "Ready. It was built when the file opened.");
      else setState("live", (reason === "start" ? "Built in " : "Reloaded in ") + seconds(took));
    }
  }
  function mountFrame(build) {
    const next = doc.createElement("iframe");
    next.className = "pv-frame pv-loading";
    next.title = (target ? target.name : "Flow app") + " preview";
    next.dataset.build = String(build);
    next.src = "/app-host.html#build=" + encodeURIComponent(build);
    if (pendingFrame) { clearTimeout(pendingTimer); pendingFrame.remove(); }
    pendingFrame = next;
    stage.append(next);
    if (empty) empty.hidden = true;
    pendingTimer = setTimeout(() => settle(next), SWAP_TIMEOUT_MS);
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function readJson(response) {
    try { return await response.json(); } catch (_) { return null; }
  }
  async function post_(url, text) {
    return request(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
      body: text
    });
  }

  async function build(reason) {
    const text = documentText();
    if (text === null) { stop("The app's document was closed."); return false; }
    if (building) { queued = true; if (reason === "save") queuedNow = true; return false; }
    building = true;
    queued = queuedNow = false;
    attemptText = text;
    const mine = generation;
    beginProgress(reason);
    try {
      let response = await post_("/api/app/start", text);
      /* A server from before background builds builds in the request. */
      if (response.status === 404) response = await post_("/api/app/build", text);
      let result = await readJson(response);
      /* Opening the file already built this source in the background. */
      if (progress && result && result.state === "done") progress.prebuilt = true;
      while (result && typeof result.ok !== "boolean" && result.build && mine === generation) {
        stageProgress(result.state, result.cold === true);
        await wait(STATUS_MS);
        if (mine !== generation) break;
        result = await readJson(await request("/flowapp/" + encodeURIComponent(result.build) + "/status"));
      }
      if (mine !== generation || !target) return false;   // stopped or restarted meanwhile
      if (!result || typeof result.ok !== "boolean") {
        endProgress();
        setState("error", "Build service unavailable (HTTP " + response.status + ")");
        showError("The FlowStudio server did not return a build result.");
        return false;
      }
      if (result.cold) stageProgress(progress && progress.stage, true);
      if (!result.ok) {
        endProgress();
        setState("error", frame ? "Build failed. The last good build is still running." : "Build failed");
        showError(result.log);
        return false;
      }
      builds++;
      builtText = text;
      seenText = seenText === null ? text : seenText;
      clearError();
      stageProgress("load");
      mountFrame(result.build);
      if (restartButton) restartButton.disabled = false;
      if (stopButton) stopButton.disabled = false;
      return true;
    } catch (error) {
      endProgress();
      setState("error", "Build request failed");
      showError(String(error && error.message || error));
      return false;
    } finally {
      if (mine === generation) building = false;
      if (mine === generation && queued && target) { const now = queuedNow; queued = queuedNow = false; schedule(now ? 0 : DEBOUNCE_MS); }
    }
  }
  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!target || !hot || !hot.checked) return;
      const text = documentText();
      if (text === null) return;
      /* Undoing a broken edit returns to the running build: nothing to do. */
      if (text === builtText && frame) {
        attemptText = text;
        clearError();
        setState("live", "Back to the running build");
        return;
      }
      if (text !== attemptText || delay === 0) void build(delay === 0 ? "save" : "reload");
    }, delay);
  }
  /* Edits are noticed by comparing the document text; this keeps the
   * preview independent of which editor (Monaco or the textarea) is active. */
  const poll = setInterval(() => {
    if (!target || !hot || !hot.checked || building) return;
    const text = documentText();
    if (text === null) { stop("The app's document was closed."); return; }
    if (text !== seenText) { seenText = text; if (text !== attemptText) schedule(); }
  }, POLL_MS);

  /* Saving rebuilds at once. Saving a graphics program while no app runs
   * starts it, so a save after reopening the IDE shows the app again. */
  function saved(id) {
    const a = app();
    const document_ = a && a.documents ? a.documents.find(id) : null;
    if (!document_ || !hot || !hot.checked) return;
    if (target && target.id === id) {
      seenText = document_.text;
      if (document_.text === builtText && frame && !building) {
        clearTimeout(debounce);
        attemptText = document_.text;
        clearError();
        if (!progress) setState("live", "Saved. The app is up to date.");
        return;
      }
      if (building) { queued = queuedNow = true; return; }
      schedule(0);
      return;
    }
    if (!target && isGraphicsProgram(document_.text)) start(document_);
  }

  /* Opening a graphics program starts its build in the background. Run
   * then picks up that build (the server matches the source), and the
   * WebAssembly toolchain is ready before it is needed. */
  let warmedId = null;
  function prepare() {
    const a = app();
    if (target || !a || !a.documents || typeof a.documents.active !== "function") return;
    const active = a.documents.active();
    if (!active || active.id === warmedId || !isGraphicsProgram(active.text)) return;
    warmedId = active.id;
    Promise.resolve()
      .then(() => post_("/api/app/start", active.text))
      .catch(() => { /* the build runs again on Run */ });
  }
  if (typeof doc.addEventListener === "function") {
    doc.addEventListener("flowstudio:saved", event => saved(event && event.detail && event.detail.id));
    doc.addEventListener("flowstudio:documents", prepare);
  }

  function start(document_) {
    if (!document_) return false;
    generation++;
    target = { id: document_.id, name: document_.name };
    builtText = null;
    attemptText = null;
    seenText = document_.text;
    size = null;
    autoSized = false;
    building = false;
    queued = queuedNow = false;
    if (title) title.textContent = document_.name;
    restoreWidth();
    showPanel();
    void build("start");
    return true;
  }
  function stop(message) {
    generation++;
    clearTimeout(debounce);
    clearTimeout(pendingTimer);
    endProgress();
    for (const node of [frame, pendingFrame]) if (node) { post(node, "stop"); node.remove(); }
    frame = pendingFrame = null;
    target = null;
    builtText = null;
    warmedId = null;
    if (empty) empty.hidden = false;
    if (title) title.textContent = "No app running";
    setState("idle", message || "");
    clearError();
    if (restartButton) restartButton.disabled = true;
    if (stopButton) stopButton.disabled = true;
    /* Give the width back when the preview had taken it for this app. */
    const l = layout();
    if (openedPanel && l && l.isVisible("right")) {
      const tab = el("rpTab-preview");
      if (!tab || tab.getAttribute("aria-selected") === "true") l.hide("right");
    }
    openedPanel = false;
  }

  const onMessage = options.onMessage || (fn => { if (root.addEventListener) root.addEventListener("message", fn); });
  onMessage(event => {
    const origin = options.origin || (root.location && root.location.origin);
    if (event.origin !== origin || !event.data || event.data.source !== "flowstudio-app") return;
    const from = [frame, pendingFrame].find(node => node && node.contentWindow === event.source);
    if (!from) return;
    const { event: kind, detail } = event.data;
    if (kind === "start" && detail) {
      size = { width: detail.width, height: detail.height };
      if (from === pendingFrame) settle(from);
      if (title && target) title.textContent = target.name + "  " + detail.width + "x" + detail.height;
      fitPanel();
    } else if (kind === "loaded" && from === pendingFrame) {
      // Console programs never call gfx_open; swap once the module is ready.
      setTimeout(() => settle(from), 120);
    } else if (kind === "exit" && from === frame) {
      setState("idle", "The app finished.");
    } else if (kind === "error") {
      if (from === pendingFrame) settle(from);
      if (from === frame) setState("error", "The app stopped with an error.");
    } else if ((kind === "stdout" || kind === "stderr") && options.onOutput) {
      options.onOutput(kind, String(detail));
    }
  });
  if (restartButton) restartButton.addEventListener("click", () => { builtText = attemptText = null; void build("reload"); });
  if (stopButton) stopButton.addEventListener("click", () => stop("Stopped."));
  if (hot) hot.addEventListener("change", () => { if (hot.checked) schedule(); });
  const newApp = el("previewNewApp");
  if (newApp) newApp.addEventListener("click", () => {
    if (root.FlowStudioProjects) root.FlowStudioProjects.newProject("flow-app");
  });

  return Object.freeze({
    isGraphicsProgram, start, stop, showPanel, saved,
    rebuild: () => build("reload"),
    running: () => Boolean(target),
    target: () => (target ? { ...target } : null),
    builds: () => builds,
    dispose: () => { clearInterval(poll); stop(); }
  });
}

const api = Object.freeze({ mount, isGraphicsProgram, parseErrors, seconds, STAGES, COLD_NOTE });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioAppPreviewModule = api;
if (typeof document !== "undefined" && document.getElementById("previewStage")) {
  try {
    const preview = mount(document, {});
    root.FlowStudioAppPreview = preview;
  } catch (error) {
    if (root.console) root.console.error("FlowStudio preview failed to mount: " + (error && error.message));
  }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
