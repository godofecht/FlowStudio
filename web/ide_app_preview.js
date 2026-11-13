/* Flow app Preview with hot reload.
 *
 * A Flow program that draws with stdlib/gfx.flow is built by the native
 * server into WebAssembly (POST /api/app/build, src/flow_app.c) and runs in
 * a frame in the side panel (web/app_host.html). While hot reload is on, an
 * edit to that document rebuilds it after a short pause and swaps the new
 * build in once it has loaded. A failed build leaves the last good build
 * running and shows the compiler message, with links to the lines.
 *
 * A reload restarts the program: its state starts fresh each time.
 */
(function (root) {
"use strict";

const GFX_IMPORT = /^\s*import\s+["']stdlib\/gfx(?:\.flow)?["']/m;
const GFX_CALL = /\bgfx_open\s*\(/;
const DEBOUNCE_MS = 450;
const POLL_MS = 250;
const SWAP_TIMEOUT_MS = 4000;

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

function mount(doc, options = {}) {
  const el = id => doc.getElementById(id);
  const stage = el("previewStage");
  if (!stage) return null;
  const app = () => options.app || root.FlowStudioApp || null;
  const layout = () => options.layout || root.FlowStudioLayout || null;
  const request = options.fetch || ((...args) => root.fetch(...args));
  const clock = options.clock || (() => Date.now());
  const title = el("previewTitle"), statusNode = el("previewStatus"), dot = el("previewDot");
  const errorBox = el("previewError"), empty = el("previewEmpty");
  const hot = el("previewHot"), restartButton = el("previewRestart"), stopButton = el("previewStop");

  let target = null;          // { id, name } of the document the app comes from
  let builtText = null;       // source of the running build
  let building = false;
  let queued = false;
  let frame = null;           // the live iframe
  let pendingFrame = null;    // a new build loading behind it
  let pendingTimer = 0;
  let debounce = 0;
  let seenText = null;       // last text the poll saw, so a pause is detected
  let attemptText = null;    // source of the last build attempt, good or not
  let size = null;            // { width, height } reported by the app
  let builds = 0;

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
      if (size) l.ensureSize("right", panelWidth());
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
  function settle(next) {
    clearTimeout(pendingTimer);
    if (pendingFrame !== next) return;
    pendingFrame = null;
    if (frame && frame !== next) { post(frame, "stop"); frame.remove(); }
    frame = next;
    frame.classList.remove("pv-loading");
  }
  function mountFrame(build) {
    const next = doc.createElement("iframe");
    next.className = "pv-frame" + (frame ? " pv-loading" : "");
    next.title = (target ? target.name : "Flow app") + " preview";
    next.dataset.build = String(build);
    next.src = "/app-host.html#build=" + encodeURIComponent(build);
    if (pendingFrame) { clearTimeout(pendingTimer); pendingFrame.remove(); }
    pendingFrame = next;
    stage.append(next);
    if (empty) empty.hidden = true;
    if (!frame) settle(next);
    else pendingTimer = setTimeout(() => settle(next), SWAP_TIMEOUT_MS);
  }

  async function build(reason) {
    const text = documentText();
    if (text === null) { stop("The app's document was closed."); return false; }
    if (building) { queued = true; return false; }
    building = true;
    queued = false;
    attemptText = text;
    setState("building", reason === "reload" ? "Rebuilding…" : "Building…");
    const started = clock();
    try {
      const response = await request("/api/app/build", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-FlowStudio-Intent": "run" },
        body: text
      });
      let result = null;
      try { result = await response.json(); } catch (_) { result = null; }
      if (!target) return false;   // stopped while building
      if (!result || typeof result.ok !== "boolean") {
        setState("error", "Build service unavailable (HTTP " + response.status + ")");
        showError("The FlowStudio server did not return a build result.");
        return false;
      }
      if (!result.ok) {
        setState("error", frame ? "Build failed. The last good build is still running." : "Build failed");
        showError(result.log);
        return false;
      }
      builds++;
      builtText = text;
      seenText = seenText === null ? text : seenText;
      clearError();
      mountFrame(result.build);
      const ms = Number.isFinite(result.ms) ? result.ms : clock() - started;
      setState("live", (reason === "reload" ? "Reloaded in " : "Built in ") + seconds(ms));
      if (restartButton) restartButton.disabled = false;
      if (stopButton) stopButton.disabled = false;
      return true;
    } catch (error) {
      setState("error", "Build request failed");
      showError(String(error && error.message || error));
      return false;
    } finally {
      building = false;
      if (queued && target) { queued = false; schedule(); }
    }
  }
  function schedule() {
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
      if (text !== attemptText) void build("reload");
    }, DEBOUNCE_MS);
  }
  /* Edits are noticed by comparing the document text; this keeps the
   * preview independent of which editor (Monaco or the textarea) is active. */
  const poll = setInterval(() => {
    if (!target || !hot || !hot.checked || building) return;
    const text = documentText();
    if (text === null) { stop("The app's document was closed."); return; }
    if (text !== seenText) { seenText = text; if (text !== attemptText) schedule(); }
  }, POLL_MS);

  function start(document_) {
    if (!document_) return false;
    target = { id: document_.id, name: document_.name };
    builtText = null;
    attemptText = null;
    seenText = document_.text;
    size = null;
    if (title) title.textContent = document_.name;
    showPanel();
    void build("start");
    return true;
  }
  function stop(message) {
    clearTimeout(debounce);
    clearTimeout(pendingTimer);
    for (const node of [frame, pendingFrame]) if (node) { post(node, "stop"); node.remove(); }
    frame = pendingFrame = null;
    target = null;
    builtText = null;
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
      const l = layout();
      if (l && l.isVisible("right")) l.ensureSize("right", panelWidth());
    } else if (kind === "loaded" && from === pendingFrame) {
      // Console programs never call gfx_open; swap once the module is ready.
      setTimeout(() => settle(from), 120);
    } else if (kind === "exit" && from === frame) {
      setState("idle", "The app finished.");
    } else if (kind === "error" && from === frame) {
      setState("error", "The app stopped with an error.");
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
    isGraphicsProgram, start, stop, showPanel,
    rebuild: () => build("reload"),
    running: () => Boolean(target),
    target: () => (target ? { ...target } : null),
    builds: () => builds,
    dispose: () => { clearInterval(poll); stop(); }
  });
}

const api = Object.freeze({ mount, isGraphicsProgram, parseErrors, seconds });
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
