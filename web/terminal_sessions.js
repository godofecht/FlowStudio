/* FlowStudio terminal sessions: state for the dock's runtime tabs.
 *
 * A session is one scrollback for one runtime. All sessions of a runtime share
 * the same underlying interpreter process on the native server (Flow compiles
 * per run; Python and R keep their single persistent kernel), and the UI says
 * so instead of pretending to have parallel sandboxes. Entries are the single
 * source of truth for the transcript; the plain text buffer is derived from
 * them, and rendering happens in workspace_console.js.
 *
 * Runtime states are honest: "idle" means no evidence yet ("unknown-at start"),
 * "running" is during a request, "ready" after a successful submission,
 * "error" after a failed submission, "disconnected" after a transport failure.
 * Nothing is reported connected or available before the server provably
 * answered for that runtime.
 */
(function (root) {
"use strict";
const RUNTIMES = Object.freeze(["flow", "python", "r"]);
const MAX_ENTRIES = 2000;        // dom+memory bound per session
const STATE_LABELS = Object.freeze({
  idle: "No commands yet in this session",
  running: "Executing…",
  ready: "Last submission succeeded",
  error: "Last submission failed",
  disconnected: "Server unreachable; output shown below may be stale"
});

function nowIso(date) {
  const t = date || new Date();
  const pad = n => String(n).padStart(2, "0");
  return pad(t.getHours()) + ":" + pad(t.getMinutes()) + ":" + pad(t.getSeconds());
}

function formatDuration(ms) {
  if (typeof ms !== "number" || ms < 0) return "?";
  return ms >= 60000 ? (ms / 60000).toFixed(1) + " min" :
    ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms";
}

function create(options = {}) {
  const runtimeOf = options.runtime || (() => "flow");
  const clock = options.clock || (() => new Date());
  const listeners = new Set();
  let nextId = 1;
  let activeSession = null;
  const sessions = new Map();

  function notify() { for (const fn of listeners) fn(); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function makeSession(runtime, ordinal) {
    const session = {
      id: nextId++,
      runtime,
      ordinal,
      state: "idle",
      entries: [],
      unread: false,
      draft: "",
      running: false,
      lastCommandTs: null,
      lastDurationMs: null,
      lastStatusText: ""
    };
    sessions.set(session.id, session);
    return session;
  }

  // One base session per runtime is created eagerly so all tabs exist from
  // the start; extra scrollbacks are created only by explicit user action.
  const base = new Map();
  for (const runtime of RUNTIMES) base.set(runtime, makeSession(runtime, 1));
  activeSession = base.get(runtimeOf().toLowerCase()) || base.get("flow");

  function listOf(runtime) {
    return [...sessions.values()].filter(s => s.runtime === runtime);
  }

  function setActive(id) {
    const session = sessions.get(id);
    if (!session || session === activeSession) return false;
    activeSession = session;
    session.unread = false;
    notify();
    return true;
  }

  function activateRuntime(runtime) {
    const list = listOf(runtime);
    return list.length ? setActive(list[list.length - 1].id) : false;
  }

  function createFor(runtime) {
    const ordinal = listOf(runtime).length + 1;
    const session = makeSession(runtime, ordinal);
    session.entries.push({ kind: "meta", text:
      "Session " + ordinal + " opened for " + runtime +
      " (" + (runtime === "flow" ?
        "Flow compiles each program separately" :
        "shares the persistent " + runtime + " interpreter with earlier sessions") + ").",
      ts: nowIso(clock()) });
    notify();
    return session;
  }

  function findSession(runtime) {
    const list = listOf(runtime);
    return list.length ? list[list.length - 1] : null;
  }

  function push(session, entry) {
    session.entries.push(entry);
    while (session.entries.length > MAX_ENTRIES) session.entries.shift();
    return session;
  }

  function entriesWithFigures(extra) {
    return Array.isArray(extra && extra.figures) ? extra.figures : [];
  }

  function pushTo(session, text, kind, extra) {
    const figures = entriesWithFigures(extra);
    const entry = Object.assign({ kind, text: text || "", ts: nowIso(clock()) }, extra);
    push(session, entry);
    if (session !== activeSession && kind !== "meta") session.unread = true;
    notify();
    return session;
  }

  /* Route free text to the newest session of `runtime`; a null runtime is an
   * unattributed writer (examples panel) and goes to the active session. An
   * entry may carry only figures (empty text); those are still appended so
   * captured plots never get dropped. */
  function append(runtime, text, kind = "out", extra = {}) {
    const hasFigures = entriesWithFigures(extra).length > 0;
    if (typeof text !== "string" || !text) {
      if (!hasFigures || runtime && !RUNTIMES.includes(runtime)) return null;
    }
    const session = runtime && RUNTIMES.includes(runtime) ?
      (findSession(runtime) || createFor(runtime)) : activeSession;
    return pushTo(session, text && typeof text === "string" ? text : "", kind, extra);
  }

  function beginRun(runtime) {
    let session = runtime && RUNTIMES.includes(runtime) ? findSession(runtime) : null;
    if (!session) session = createFor(runtime);
    session.running = true;
    session.state = "running";
    session.lastCommandTs = clock();
    push(session, { kind: "cmd", text: "> " + (session.pendingCode || ""),
      ts: nowIso(session.lastCommandTs) });
    notify();
    return session;
  }

  function recordCommand(session, code) { session.pendingCode = code; }
  function clearCommand(session) { delete session.pendingCode; }

  function endRun(session, outcome, durationMs) {
    session.running = false;
    session.pendingCode = null;
    session.lastDurationMs = durationMs;
    if (outcome === "ok") {
      session.state = "ready";
      session.lastStatusText =
        "exit ok · " + formatDuration(durationMs) + " · " + nowIso();
      push(session, { kind: "meta", text: "↳ ok · " + formatDuration(durationMs), ts: nowIso() });
    } else if (outcome === "disconnected") {
      session.state = "disconnected";
      session.lastStatusText = "request failed";
      push(session, { kind: "meta", text: "↳ request failed", ts: nowIso() });
    } else {
      session.state = "error";
      session.lastStatusText = "execution failed · " + formatDuration(durationMs);
      push(session, { kind: "meta", text:
        "↳ failed · " + formatDuration(durationMs), ts: nowIso() });
    }
    if (session !== activeSession) session.unread = true;
    notify();
    return session;
  }

  function clearVisible(session) {
    session.entries = [];
    session.lastDurationMs = null;
    session.lastStatusText = "";
    notify();
  }

  function plainText(session) {
    return session.entries.map(entry => entry.text).join("");
  }

  const api = Object.freeze({
    RUNTIMES, MAX_ENTRIES,
    onChange, notify,
    all: () => [...sessions.values()],
    get: id => sessions.get(id) || null,
    active: () => activeSession,
    setActive, activateRuntime, createFor, listOf, findSession,
    append, beginRun, endRun, recordCommand, clearCommand,
    clearVisible, plainText, nowIso, formatDuration, STATE_LABELS
  });
  return api;
}

const moduleApi = Object.freeze({ create, RUNTIMES, MAX_ENTRIES,
  STATE_LABELS, nowIso, formatDuration });
root.FlowStudioTerminalSessions = moduleApi;
if (typeof module !== "undefined" && module.exports) module.exports = moduleApi;
})(globalThis);
