/* Flow language server client for the Monaco workspace.
 * Talks to `flow lsp` through the native bridge (src/lsp_bridge.c):
 * POST /api/lsp/request carries one JSON-RPC message, POST /api/lsp/events
 * drains server notifications such as publishDiagnostics.
 *
 * When the server answers initialize, this client registers completion,
 * hover, definition, references, highlights, rename, formatting, symbols,
 * code actions and diagnostics for language "flow", and the older lexical
 * Flow helpers step aside for every model it syncs (see handles()). When the
 * server is missing (503) nothing is registered and the older helpers stay.
 *
 * Documents are named file:///flowstudio/<path>, where <path> is the editor
 * path (project folder name first) or untitled/<id>/<name>. The bridge mirrors
 * every opened document into a private folder under those names, so imports
 * between project files resolve. The project's other .flow files are opened
 * in the background (see syncProject) so the server can read them too.
 */
(function (global) {
"use strict";
const REQUEST_ROUTE = "/api/lsp/request";
const START_ROUTE = "/api/lsp/start";
const EVENTS_ROUTE = "/api/lsp/events";
const OWNER = "flow-lsp";
const URI_ROOT = "file:///flowstudio/";
// The native server accepts request bodies up to 128 KiB. Larger buffers stay
// with the older helpers.
const MAX_TEXT = 120000;
const CHANGE_DELAY_MS = 250;
// flow lsp analyses a changed document after 200 ms without input. Requests
// whose answer depends on that analysis wait this long after the last change.
const SETTLE_MS = 260;
const POLL_AFTER_MS = [300, 800, 2000];
// Other open documents are sent again this long after an edit, so their
// imports and diagnostics follow it.
const DEPENDENTS_DELAY_MS = 700;
const SYNC_DELAY_MS = 800;
const PROJECT_LIMITS = Object.freeze({ files: 400, depth: 8 });
const SKIP_DIRS = new Set(["node_modules", "build", "target", "dist", "flow_packages", "__pycache__"]);
/* While the first `flow lsp` builds the server, ask again this often. */
const START_RETRY_MS = 2000;
const COMPLETION_KINDS = [null, "Text", "Method", "Function", "Constructor", "Field",
  "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum",
  "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember",
  "Constant", "Struct", "Event", "Operator", "TypeParameter"];
const ACTIONS = Object.freeze({
  definition: "editor.action.revealDefinition",
  references: "editor.action.goToReferences",
  rename: "editor.action.rename",
  format: "editor.action.formatDocument"
});

/* Percent-encoding as flow lsp writes paths in URIs (Path.as_uri): every
 * byte outside A-Z a-z 0-9 _ . ~ - is escaped, so the URIs it returns for
 * imported files equal the ones made here. */
function encodeSegment(name) {
  return encodeURIComponent(name).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function uriForPath(path) {
  return URI_ROOT + String(path).split("/").filter(Boolean).map(encodeSegment).join("/");
}

/* Every .flow file under a folder handle as [{ rel, handle }], sorted. */
async function listFlowFiles(folder, limits = PROJECT_LIMITS) {
  const files = [];
  const queue = [{ handle: folder, rel: "", depth: 0 }];
  while (queue.length && files.length < limits.files) {
    const { handle, rel, depth } = queue.shift();
    try {
      for await (const [name, child] of handle.entries()) {
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        const path = rel ? rel + "/" + name : name;
        if (child.kind === "directory") {
          if (depth + 1 < limits.depth) queue.push({ handle: child, rel: path, depth: depth + 1 });
        } else if (child.kind === "file" && name.endsWith(".flow")) {
          files.push({ rel: path, handle: child });
          if (files.length >= limits.files) break;
        }
      }
    } catch (_) { /* an unreadable folder is skipped */ }
  }
  return files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/* LSP markup in its several shapes -> Monaco markdown strings. */
function markdownOf(contents) {
  if (contents == null) return [];
  if (Array.isArray(contents)) return contents.flatMap(markdownOf);
  if (typeof contents === "string") return contents ? [{ value: contents }] : [];
  if (typeof contents.value !== "string" || !contents.value) return [];
  if (typeof contents.language === "string")
    return [{ value: "```" + contents.language + "\n" + contents.value + "\n```" }];
  return [{ value: contents.value }];
}

function toRange(range) {
  if (!range || !range.start || !range.end) return null;
  return {
    startLineNumber: range.start.line + 1, startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1, endColumn: range.end.character + 1
  };
}

function fromRange(range) {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
  };
}

function fromPosition(position) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function create(options) {
  const monaco = options.monaco;
  const editor = options.editor;
  const app = options.app;
  const fetchFn = options.fetch || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
  const timers = options.scheduler || global;
  const now = options.now || (() => Date.now());
  const documentIdFor = options.documentIdFor || (() => null);
  if (!monaco || !monaco.languages || !monaco.editor || !app || !fetchFn)
    throw new Error("Missing Flow language server client dependencies.");

  let state = "idle";                 // idle, starting, ready, unavailable
  let capabilities = {};
  let nextId = 1;
  let generation = null;
  let chain = Promise.resolve();      // keeps bridge traffic in send order
  const synced = new Map();           // model -> sync entry
  // Project .flow files with no editor model, opened on the server from disk:
  // uri -> { uri, path, handle, text, modified, size, version, view, lastText, seen }
  const background = new Map();
  const providers = [];
  const watchers = [];
  let pollTimers = [];
  let project = null;                 // folder name the background files belong to
  let contentEpoch = 0;               // counts text the server has not seen in every document
  let dependentsTimer = null;
  let syncTimer = null;
  let syncing = null;
  let syncAgain = false;

  function workspace() {
    const source = options.workspace || global.FlowStudioWorkspaceExplorer;
    return source && typeof source.root === "function" && typeof source.rootName === "function" ? source : null;
  }

  /* A document's text went to the server. Other documents may import it,
   * so they are behind until they are analysed again. */
  function noteSent(entry, text) {
    const changed = entry.lastText !== text;
    if (changed) { contentEpoch++; entry.lastText = text; }
    entry.seen = contentEpoch;
    return changed;
  }

  /* A Flow script without main() is what the console session runs. The
   * server only analyses code inside functions, so it gets a rearranged
   * copy: declarations stay on their lines, the top-level statements move
   * into a generated main() after the session's current variables, and
   * every position is mapped between the two (FlowStudioFlowSession.scriptView). */
  function sessionView(text) {
    const session = options.session || global.FlowStudioFlowSession;
    if (!session || typeof session.scriptView !== "function") return null;
    const client = session.client;
    return session.scriptView(text, client && typeof client.variables === "function" ? client.variables() : null);
  }
  function serverText(model, entry) {
    const text = model.getValue();
    entry.view = sessionView(text);
    return entry.view ? entry.view.text : text;
  }
  function viewOf(model) {
    const entry = model ? synced.get(model) : null;
    return entry ? entry.view || null : null;
  }
  /* A view moves lines (the session arrangement) and, on lines holding a
   * Python or R block, columns too (toVirtualPosition, toRealPosition). */
  function pointToServer(view, point) {
    if (!view) return point;
    if (typeof view.toVirtualPosition === "function") return view.toVirtualPosition(point.line, point.character);
    return { line: view.toVirtual(point.line), character: point.character };
  }
  function pointFromServer(view, point) {
    if (typeof view.toRealPosition === "function") return view.toRealPosition(point.line, point.character);
    const line = view.toReal(point.line);
    return line === null ? null : { line, character: point.character };
  }
  function toServer(model, position) {
    return pointToServer(viewOf(model), fromPosition(position));
  }
  function rangeToServer(model, range) {
    const lsp = fromRange(range);
    const view = viewOf(model);
    return { start: pointToServer(view, lsp.start), end: pointToServer(view, lsp.end) };
  }
  /* A server range in editor coordinates, or null inside generated lines. */
  function fromServer(model, range) {
    return fromServerView(viewOf(model), range);
  }
  function fromServerView(view, range) {
    if (!range || !range.start || !range.end) return null;
    if (!view) return toRange(range);
    const start = pointFromServer(view, range.start), end = pointFromServer(view, range.end);
    if (start === null || end === null) return null;
    return toRange({ start, end });
  }

  function post(route, body) {
    const run = () => fetchFn(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-FlowStudio-Intent": "run" },
      body
    }).then(async response => ({ status: response.status, text: await response.text() }));
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  async function request(method, params) {
    if (state !== "ready" && method !== "initialize") return null;
    const id = nextId++;
    let reply;
    try {
      reply = await post(REQUEST_ROUTE, JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    } catch (_) {
      return null;
    }
    schedulePoll(60);
    if (reply.status === 503 && method !== "initialize") { stop(); return null; }
    if (reply.status !== 200) return null;
    let message;
    try { message = JSON.parse(reply.text); } catch (_) { return null; }
    if (message && message.error) {
      const error = new Error(String(message.error.message || "Language server error"));
      error.code = message.error.code;
      throw error;
    }
    return message ? message.result : null;
  }

  async function notify(method, params) {
    if (state !== "ready") return;
    try {
      const reply = await post(REQUEST_ROUTE, JSON.stringify({ jsonrpc: "2.0", method, params }));
      if (reply.status === 503) stop();
    } catch (_) { /* the next poll or request reports the problem */ }
  }

  function uriFor(model) {
    const id = documentIdFor(model);
    const doc = id && app.documents && typeof app.documents.find === "function"
      ? app.documents.find(id) : null;
    if (doc && doc.path) return uriForPath(doc.path);
    if (doc) return uriForPath("untitled/" + doc.id + "/" + doc.name);
    return uriForPath("untitled/model-" + model.id + ".flow");
  }

  function isFlow(model) {
    return !!model && !(typeof model.isDisposed === "function" && model.isDisposed()) &&
      model.getLanguageId() === "flow";
  }

  function handles(model) {
    return state === "ready" && isFlow(model) && synced.has(model);
  }

  function open(model) {
    if (state !== "ready" || synced.has(model) || !isFlow(model)) return;
    const text = model.getValue();
    if (text.length > MAX_TEXT) return;
    const entry = { uri: uriFor(model), version: 1, timer: null, changedAt: 0,
      diagnostics: [], subscriptions: [], view: null, lastText: null, seen: 0, refreshedAt: 0 };
    synced.set(model, entry);
    entry.subscriptions.push(model.onDidChangeContent(() => scheduleChange(model)));
    entry.subscriptions.push(model.onWillDispose(() => close(model)));
    // The buffer now speaks for this file; the server replaces the disk copy.
    const shadowed = background.get(entry.uri);
    if (shadowed) { background.delete(entry.uri); entry.version = shadowed.version + 1; }
    const sent = serverText(model, entry);
    if (noteSent(entry, sent)) scheduleDependents();
    void notify("textDocument/didOpen", { textDocument: { uri: entry.uri, languageId: "flow",
      version: entry.version, text: sent } });
    schedulePolls();
  }

  function close(model) {
    const entry = synced.get(model);
    if (!entry) return;
    synced.delete(model);
    if (entry.timer !== null) timers.clearTimeout(entry.timer);
    for (const subscription of entry.subscriptions) subscription.dispose();
    void notify("textDocument/didClose", { textDocument: { uri: entry.uri } });
    if (!(typeof model.isDisposed === "function" && model.isDisposed()))
      monaco.editor.setModelMarkers(model, OWNER, []);
    // A project file goes back to its saved text on disk.
    if (project && entry.uri.startsWith(uriForPath(project) + "/")) scheduleSync(0);
  }

  function scheduleChange(model) {
    const entry = synced.get(model);
    if (!entry) return;
    if (model.getValueLength() > MAX_TEXT) { close(model); return; }
    if (entry.timer !== null) timers.clearTimeout(entry.timer);
    entry.timer = timers.setTimeout(() => { entry.timer = null; flushChange(model); }, CHANGE_DELAY_MS);
  }

  function flushChange(model) {
    const entry = synced.get(model);
    if (!entry) return Promise.resolve();
    if (entry.timer !== null) { timers.clearTimeout(entry.timer); entry.timer = null; }
    entry.version++;
    entry.changedAt = now();
    const uri = uriFor(model);
    const text = serverText(model, entry);
    if (noteSent(entry, text)) scheduleDependents();
    let sent;
    if (uri !== entry.uri) {
      // The document was renamed or saved under a new path. A file still at
      // the old path comes back with the next project sync.
      void notify("textDocument/didClose", { textDocument: { uri: entry.uri } });
      void notify("flowstudio/forget", { uri: entry.uri });
      if (project) scheduleSync(SYNC_DELAY_MS);
      entry.uri = uri;
      sent = notify("textDocument/didOpen", { textDocument: { uri, languageId: "flow",
        version: entry.version, text } });
    } else {
      sent = notify("textDocument/didChange", { textDocument: { uri, version: entry.version },
        contentChanges: [{ text }] });
    }
    schedulePolls();
    return sent;
  }

  /* Bring the server up to date with the model before asking about it. */
  async function prepare(model, settle) {
    const entry = synced.get(model);
    if (!entry) return null;
    if (entry.timer !== null) await flushChange(model);
    // Another file changed since this one was analysed: its imports may
    // read differently now, so send it again and wait for the analysis.
    if (entry.seen < contentEpoch) { await flushChange(model); settle = true; }
    // Sent again for that reason a moment ago: the analysis is still due.
    if (entry.refreshedAt + SETTLE_MS > now()) settle = true;
    if (settle) {
      const wait = entry.changedAt + SETTLE_MS - now();
      if (wait > 0) await new Promise(resolve => timers.setTimeout(resolve, wait));
    }
    return synced.get(model) || null;
  }

  function reopenAll() {
    for (const [model, entry] of synced) {
      entry.version++;
      entry.uri = uriFor(model);
      void notify("textDocument/didOpen", { textDocument: { uri: entry.uri, languageId: "flow",
        version: entry.version, text: serverText(model, entry) } });
    }
    for (const entry of background.values()) {
      entry.version++;
      void notify("textDocument/didOpen", { textDocument: { uri: entry.uri, languageId: "flow",
        version: entry.version, text: backgroundText(entry) } });
    }
    schedulePolls();
  }

  function modelForUri(uri) {
    for (const [model, entry] of synced) if (entry.uri === uri) return model;
    return null;
  }

  /* ---- Project files without an editor ---- */

  function backgroundText(entry) {
    entry.view = sessionView(entry.text);
    return entry.view ? entry.view.text : entry.text;
  }

  /* Send every open document that is behind again, so diagnostics that
   * depend on an edited import come back. */
  function scheduleDependents() {
    if (dependentsTimer !== null) timers.clearTimeout(dependentsTimer);
    dependentsTimer = timers.setTimeout(() => { dependentsTimer = null; refreshBehind(); }, DEPENDENTS_DELAY_MS);
  }

  function refreshBehind() {
    for (const [model, entry] of synced)
      if (entry.seen < contentEpoch && entry.timer === null) {
        entry.refreshedAt = now();
        void flushChange(model);
      }
  }

  function scheduleSync(delay) {
    if (state !== "ready") return;
    if (syncTimer !== null) timers.clearTimeout(syncTimer);
    syncTimer = timers.setTimeout(() => { syncTimer = null; void syncProject(); }, delay);
  }

  function dropBackground(uri) {
    background.delete(uri);
    contentEpoch++;                   // files importing it read differently now
    void notify("textDocument/didClose", { textDocument: { uri } });
    void notify("flowstudio/forget", { uri });
  }

  async function readProject(name, folder) {
    const files = await listFlowFiles(folder);
    const present = new Set();
    let sent = 0;
    for (const file of files) {
      if (state !== "ready" || project !== name) return sent;
      const path = name + "/" + file.rel;
      const uri = uriForPath(path);
      present.add(uri);
      if (modelForUri(uri)) continue;
      let blob;
      try { blob = await file.handle.getFile(); } catch (_) { continue; }
      const old = background.get(uri);
      if (old && old.modified === blob.lastModified && old.size === blob.size) { old.handle = file.handle; continue; }
      if (blob.size > MAX_TEXT) { if (old) dropBackground(uri); continue; }
      const text = await blob.text();
      if (state !== "ready" || project !== name || modelForUri(uri)) continue;
      const entry = old || { uri, version: 0, view: null, lastText: null, seen: 0 };
      Object.assign(entry, { path, handle: file.handle, text, modified: blob.lastModified, size: blob.size });
      entry.version++;
      background.set(uri, entry);
      const body = backgroundText(entry);
      if (!noteSent(entry, body) && old) continue;
      sent++;
      if (old) void notify("textDocument/didChange", { textDocument: { uri, version: entry.version },
        contentChanges: [{ text: body }] });
      else void notify("textDocument/didOpen", { textDocument: { uri, languageId: "flow",
        version: entry.version, text: body } });
    }
    for (const uri of [...background.keys()]) if (!present.has(uri)) { dropBackground(uri); sent++; }
    return sent;
  }

  /* Open the project's .flow files on the server, so imports and go to
   * definition reach files that have no tab. Files with a tab are sent by
   * their buffer instead. A new project folder replaces the previous one. */
  function syncProject() {
    if (state !== "ready") return Promise.resolve(0);
    if (syncing) { syncAgain = true; return syncing; }
    syncing = (async () => {
      const source = workspace();
      const folder = source ? source.root() : null;
      const name = folder ? source.rootName() : null;
      if (project && project !== name) {
        for (const uri of [...background.keys()]) {
          background.delete(uri);
          void notify("textDocument/didClose", { textDocument: { uri } });
        }
        void notify("flowstudio/forget", { uri: uriForPath(project) + "/" });
        project = null;
      }
      if (!folder || !name) return 0;
      project = name;
      const sent = await readProject(name, folder);
      if (sent) { refreshBehind(); schedulePolls(); }
      await chain;                      // every notification has reached the bridge
      return sent;
    })().catch(() => 0).finally(() => {
      syncing = null;
      if (syncAgain) { syncAgain = false; scheduleSync(0); }
    });
    return syncing;
  }

  function monacoUri(uri) {
    return monaco.Uri && typeof monaco.Uri.parse === "function" ? monaco.Uri.parse(uri) : uri;
  }

  function backgroundFor(resource) {
    const wanted = String(resource);
    for (const entry of background.values())
      if (entry.uri === wanted || String(monacoUri(entry.uri)) === wanted) return entry;
    return null;
  }

  function reveal(view, selection) {
    if (selection && selection.startLineNumber) {
      view.setSelection(selection);
      view.revealRangeInCenterIfOutsideViewport(selection);
    } else if (selection && selection.lineNumber) {
      view.setPosition(selection);
      view.revealPositionInCenterIfOutsideViewport(selection);
    }
  }

  function severityOf(value) {
    const severity = monaco.MarkerSeverity;
    return value === 1 ? severity.Error : value === 2 ? severity.Warning :
      value === 3 ? severity.Info : severity.Hint;
  }

  function markerOf(model, diagnostic) {
    const range = fromServer(model, diagnostic.range);
    if (!range) return null;
    const lines = model.getLineCount();
    range.startLineNumber = Math.min(Math.max(1, range.startLineNumber), lines);
    range.endLineNumber = Math.min(Math.max(range.startLineNumber, range.endLineNumber), lines);
    if (range.endLineNumber === range.startLineNumber && range.endColumn <= range.startColumn)
      range.endColumn = range.startColumn + 1;
    return Object.assign(range, {
      severity: severityOf(diagnostic.severity),
      message: String(diagnostic.message || ""),
      source: diagnostic.source ? String(diagnostic.source) : undefined,
      code: diagnostic.code != null ? String(diagnostic.code) : undefined
    });
  }

  function applyDiagnostics(params) {
    if (!params || typeof params.uri !== "string" || !Array.isArray(params.diagnostics)) return;
    const model = modelForUri(params.uri);
    if (!model) return;
    const entry = synced.get(model);
    entry.diagnostics = params.diagnostics.slice(0, 256);
    monaco.editor.setModelMarkers(model, OWNER,
      entry.diagnostics.map(diagnostic => markerOf(model, diagnostic)).filter(Boolean));
  }

  async function pollEvents() {
    if (state !== "ready") return 0;
    let reply;
    try { reply = await post(EVENTS_ROUTE, ""); } catch (_) { return 0; }
    if (reply.status === 503) { stop(); return 0; }
    if (reply.status !== 200) return 0;
    let events;
    try { events = JSON.parse(reply.text); } catch (_) { return 0; }
    if (!Array.isArray(events)) return 0;
    for (const event of events) {
      if (!event || typeof event.method !== "string") continue;
      if (event.method === "textDocument/publishDiagnostics") applyDiagnostics(event.params);
      else if (event.method === "flowstudio/serverStarted") {
        const next = event.params && event.params.generation;
        // A fresh server process knows none of our documents.
        if (generation !== null && next !== generation) reopenAll();
        generation = next;
      }
    }
    return events.length;
  }

  function schedulePoll(delay) {
    const timer = timers.setTimeout(() => {
      pollTimers = pollTimers.filter(item => item !== timer);
      void pollEvents();
    }, delay);
    pollTimers.push(timer);
  }

  function schedulePolls() {
    for (const timer of pollTimers) timers.clearTimeout(timer);
    pollTimers = [];
    for (const delay of POLL_AFTER_MS) schedulePoll(delay);
  }

  /* ---- Monaco providers ---- */

  /* Server locations as Monaco locations. With withProjectFiles, a project
   * file that has no tab is kept too: the editor opener below opens it.
   * Other targets (the standard library) have no buffer and are left out. */
  function locationsOf(result, withProjectFiles) {
    const list = result == null ? [] : Array.isArray(result) ? result : [result];
    const out = [];
    for (const item of list) {
      const uri = item && (item.targetUri || item.uri);
      const span = item && (item.targetSelectionRange || item.targetRange || item.range);
      const target = typeof uri === "string" ? modelForUri(uri) : null;
      if (target) {
        const range = fromServer(target, span);
        if (range) out.push({ uri: target.uri, range });
        continue;
      }
      const file = withProjectFiles && typeof uri === "string" ? background.get(uri) : null;
      const range = file ? fromServerView(file.view, span) : null;
      if (range) out.push({ uri: monacoUri(file.uri), range });
    }
    return out;
  }

  function workspaceEditOf(edit) {
    const edits = [];
    const add = (uri, textEdits) => {
      const target = modelForUri(uri);
      if (!target || !Array.isArray(textEdits)) return;
      for (const textEdit of textEdits) {
        const range = fromServer(target, textEdit.range);
        if (range) edits.push({ resource: target.uri, textEdit: { range, text: String(textEdit.newText) },
          versionId: undefined });
      }
    };
    if (edit && edit.changes) for (const uri of Object.keys(edit.changes)) add(uri, edit.changes[uri]);
    if (edit && Array.isArray(edit.documentChanges))
      for (const change of edit.documentChanges)
        if (change && change.textDocument) add(change.textDocument.uri, change.edits);
    return { edits };
  }

  function textEditsOf(result) {
    if (!Array.isArray(result)) return [];
    return result.map(edit => ({ range: toRange(edit.range), text: String(edit.newText) }))
      .filter(edit => edit.range);
  }

  function completionItem(model, item, fallbackRange) {
    const kinds = monaco.languages.CompletionItemKind;
    const name = COMPLETION_KINDS[item.kind] || "Text";
    const edit = item.textEdit;
    const range = edit ? fromServer(model, edit.range || edit.replace) : null;
    const documentation = markdownOf(item.documentation)[0];
    return {
      label: String(item.label),
      kind: kinds[name] !== undefined ? kinds[name] : kinds.Text,
      detail: item.detail ? String(item.detail) : undefined,
      documentation,
      insertText: String(edit ? edit.newText : item.insertText != null ? item.insertText : item.label),
      insertTextRules: item.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
      sortText: item.sortText, filterText: item.filterText,
      range: range || fallbackRange
    };
  }

  function register() {
    const languages = monaco.languages;
    const completion = capabilities.completionProvider || {};
    providers.push(languages.registerCompletionItemProvider("flow", {
      triggerCharacters: Array.isArray(completion.triggerCharacters) ? completion.triggerCharacters : [],
      async provideCompletionItems(model, position, context) {
        if (!handles(model)) return null;
        const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        if (/\\[A-Za-z0-9]*$/.test(before)) return null;   // math commands, see completion.js
        const entry = await prepare(model, false);
        if (!entry) return null;
        const result = await request("textDocument/completion", {
          textDocument: { uri: entry.uri }, position: toServer(model, position),
          context: { triggerKind: (context && context.triggerKind || 0) + 1,
            triggerCharacter: context ? context.triggerCharacter : undefined }
        }).catch(() => null);
        const items = Array.isArray(result) ? result : result && Array.isArray(result.items) ? result.items : [];
        const word = model.getWordUntilPosition(position);
        const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn, endColumn: position.column };
        return { suggestions: items.slice(0, 500).map(item => completionItem(model, item, fallback)),
          incomplete: !!(result && result.isIncomplete) };
      }
    }));
    providers.push(languages.registerHoverProvider("flow", {
      async provideHover(model, position) {
        const found = await hoverAt(model, position);
        return found && { contents: found.contents, range: found.range };
      }
    }));
    providers.push(languages.registerDefinitionProvider("flow", {
      async provideDefinition(model, position) {
        if (!handles(model)) return null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        return locationsOf(await request("textDocument/definition", {
          textDocument: { uri: entry.uri }, position: toServer(model, position) }).catch(() => null), true);
      }
    }));
    providers.push(languages.registerReferenceProvider("flow", {
      async provideReferences(model, position, context) {
        if (!handles(model)) return null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        return locationsOf(await request("textDocument/references", {
          textDocument: { uri: entry.uri }, position: toServer(model, position),
          context: { includeDeclaration: !context || context.includeDeclaration !== false }
        }).catch(() => null));
      }
    }));
    providers.push(languages.registerDocumentHighlightProvider("flow", {
      async provideDocumentHighlights(model, position) {
        if (!handles(model)) return null;
        const entry = await prepare(model, false);
        if (!entry) return null;
        const result = await request("textDocument/documentHighlight", {
          textDocument: { uri: entry.uri }, position: toServer(model, position) }).catch(() => null);
        if (!Array.isArray(result)) return null;
        return result.map(item => ({ range: fromServer(model, item.range),
          kind: item.kind === 3 ? 2 : item.kind === 2 ? 1 : 0 })).filter(item => item.range);
      }
    }));
    providers.push(languages.registerRenameProvider("flow", {
      async provideRenameEdits(model, position, newName) {
        if (!handles(model)) return null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        try {
          const result = await request("textDocument/rename", { textDocument: { uri: entry.uri },
            position: toServer(model, position), newName });
          return workspaceEditOf(result);
        } catch (error) {
          return { edits: [], rejectReason: error.message };
        }
      },
      async resolveRenameLocation(model, position) {
        const word = model.getWordAtPosition(position);
        const range = word ? { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn, endColumn: word.endColumn } : null;
        if (!handles(model)) return range ? { range, text: word.word } : null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        let result = null;
        try {
          result = await request("textDocument/prepareRename", { textDocument: { uri: entry.uri },
            position: toServer(model, position) });
        } catch (error) {
          return { range: range || undefined, text: word ? word.word : "", rejectReason: error.message };
        }
        if (!result) return { range: range || undefined, text: word ? word.word : "",
          rejectReason: "This name cannot be renamed." };
        const mapped = fromServer(model, result.start ? result : result.range);
        if (!mapped) return { range: range || undefined, text: word ? word.word : "",
          rejectReason: "This name cannot be renamed." };
        if (result.start) return { range: mapped, text: model.getValueInRange(mapped) };
        if (result.range) return { range: mapped,
          text: typeof result.placeholder === "string" ? result.placeholder : model.getValueInRange(mapped) };
        return range ? { range, text: word.word } : null;
      }
    }));
    providers.push(languages.registerDocumentFormattingEditProvider("flow", {
      async provideDocumentFormattingEdits(model, formatting) {
        if (!handles(model) || viewOf(model)) return null;
        const entry = await prepare(model, false);
        if (!entry) return null;
        return textEditsOf(await request("textDocument/formatting", { textDocument: { uri: entry.uri },
          options: { tabSize: formatting.tabSize, insertSpaces: formatting.insertSpaces } }).catch(() => null));
      }
    }));
    providers.push(languages.registerDocumentRangeFormattingEditProvider("flow", {
      async provideDocumentRangeFormattingEdits(model, range, formatting) {
        if (!handles(model) || viewOf(model)) return null;
        const entry = await prepare(model, false);
        if (!entry) return null;
        return textEditsOf(await request("textDocument/rangeFormatting", { textDocument: { uri: entry.uri },
          range: fromRange(range),
          options: { tabSize: formatting.tabSize, insertSpaces: formatting.insertSpaces } }).catch(() => null));
      }
    }));
    providers.push(languages.registerDocumentSymbolProvider("flow", {
      async provideDocumentSymbols(model) {
        if (!handles(model)) return null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        const result = await request("textDocument/documentSymbol", {
          textDocument: { uri: entry.uri } }).catch(() => null);
        // Symbols inside the generated main() of a script are lifted to the top.
        const symbol = item => {
          const children = Array.isArray(item.children) ? item.children.flatMap(symbol) : [];
          const range = fromServer(model, item.range || (item.location && item.location.range));
          if (!range) return children;
          return [{ name: String(item.name), detail: item.detail ? String(item.detail) : "",
            kind: Math.max(0, (item.kind || 1) - 1), tags: [], range,
            selectionRange: fromServer(model, item.selectionRange) || range, children }];
        };
        return Array.isArray(result) ? result.flatMap(symbol) : [];
      }
    }));
    providers.push(languages.registerCodeActionProvider("flow", {
      async provideCodeActions(model, range, context) {
        if (!handles(model)) return null;
        const entry = await prepare(model, false);
        if (!entry) return null;
        // Send back the server's own diagnostics, which carry fix data.
        const markers = (context && context.markers || []).filter(marker => marker.owner === OWNER);
        const diagnostics = entry.diagnostics.filter(diagnostic => {
          const r = fromServer(model, diagnostic.range);
          return r && markers.some(marker => marker.startLineNumber === r.startLineNumber &&
            marker.startColumn === r.startColumn && marker.message === String(diagnostic.message));
        });
        const result = await request("textDocument/codeAction", { textDocument: { uri: entry.uri },
          range: rangeToServer(model, range), context: { diagnostics } }).catch(() => null);
        const actions = (Array.isArray(result) ? result : [])
          .filter(action => action && action.edit)
          .map(action => ({ title: String(action.title), kind: action.kind || "quickfix",
            isPreferred: !!action.isPreferred, diagnostics: markers,
            edit: workspaceEditOf(action.edit) }));
        return { actions, dispose() {} };
      }
    }));
    if (typeof monaco.editor.registerEditorOpener === "function")
      providers.push(monaco.editor.registerEditorOpener({
        openCodeEditor(source, resource, selection) {
          let target = null;
          for (const model of synced.keys()) if (String(model.uri) === String(resource)) target = model;
          const view = editor || source;
          if (!target) {
            // A project file without a tab: open it from the project folder.
            const file = backgroundFor(resource);
            if (!file || !file.handle || typeof app.openEditorHandle !== "function") return false;
            return Promise.resolve(app.openEditorHandle(file.handle, file.path)).then(opened => {
              if (!opened) return false;
              reveal(view, selection);
              return true;
            }, () => false);
          }
          const id = documentIdFor(target);
          if (!id || typeof app.activateDocument !== "function" || !app.activateDocument(id)) return false;
          reveal(view, selection);
          return true;
        }
      }));
  }

  /* The server's hover at a position: Monaco markdown strings and a range.
   * The Help pane (web/ide_flow_help.js) shows the same text for F1. */
  async function hoverAt(model, position) {
    if (state !== "ready" || !handles(model)) return null;
    const entry = await prepare(model, false);
    if (!entry) return null;
    const result = await request("textDocument/hover", {
      textDocument: { uri: entry.uri }, position: toServer(model, position) }).catch(() => null);
    const contents = result ? markdownOf(result.contents) : [];
    if (!contents.length) return null;
    return { contents, range: fromServer(model, result.range) || undefined };
  }

  function watchModels() {
    const later = model => timers.setTimeout(() => open(model), 0);
    watchers.push(monaco.editor.onDidCreateModel(later));
    watchers.push(monaco.editor.onDidChangeModelLanguage(event => {
      if (isFlow(event.model)) open(event.model);
      else close(event.model);
    }));
    for (const model of monaco.editor.getModels()) open(model);
  }

  /* New session variables change the generated copy of every script. */
  function followSession() {
    const session = options.session || global.FlowStudioFlowSession;
    if (!session || !session.client || typeof session.client.onChange !== "function") return;
    watchers.push({ dispose: session.client.onChange(() => {
      for (const [model, entry] of synced) if (entry.view) scheduleChange(model);
    }) });
  }

  async function start() {
    if (state !== "idle") return state === "ready";
    state = "starting";
    let result = null;
    try {
      // Ask first: a missing `flow lsp` answers 200 here, so the console
      // stays clean and the older helpers carry on. A first start that is
      // still building the server answers "starting"; ask again until the
      // bridge says yes or gives up.
      let available = false;
      for (;;) {
        const probe = await post(START_ROUTE, "");
        available = probe.status !== 404;
        let answer = null;
        if (probe.status === 200) { try { answer = JSON.parse(probe.text); } catch (_) { answer = null; } }
        if (answer && answer.starting === true) {
          await new Promise(resolve => timers.setTimeout(resolve, START_RETRY_MS));
          continue;
        }
        if (probe.status === 200) available = !!answer && answer.available === true;
        break;
      }
      if (!available) { state = "unavailable"; return false; }
      result = await request("initialize", { processId: null, rootUri: null, capabilities: {} });
    } catch (_) { result = null; }
    if (!result || !result.capabilities) { state = "unavailable"; return false; }
    capabilities = result.capabilities;
    state = "ready";
    register();
    watchModels();
    followSession();
    followProject();
    return true;
  }

  /* Tabs open and close when the project folder changes, and files are
   * saved, so the documents event is the cue to look at the folder again. */
  function followProject() {
    const target = options.events !== undefined ? options.events
      : typeof global.document !== "undefined" ? global.document : null;
    if (target && typeof target.addEventListener === "function") {
      const listener = () => scheduleSync(SYNC_DELAY_MS);
      target.addEventListener("flowstudio:documents", listener);
      watchers.push({ dispose: () => target.removeEventListener("flowstudio:documents", listener) });
    }
    scheduleSync(0);
  }

  /* The server went away for good: hand everything back to the older helpers. */
  function stop() {
    if (state !== "ready") return;
    state = "unavailable";
    for (const disposable of providers.splice(0)) disposable.dispose();
    for (const disposable of watchers.splice(0)) disposable.dispose();
    for (const timer of pollTimers) timers.clearTimeout(timer);
    pollTimers = [];
    for (const timer of [dependentsTimer, syncTimer]) if (timer !== null) timers.clearTimeout(timer);
    dependentsTimer = syncTimer = null;
    background.clear();
    project = null;
    for (const [model, entry] of synced) {
      if (entry.timer !== null) timers.clearTimeout(entry.timer);
      for (const subscription of entry.subscriptions) subscription.dispose();
      if (!(typeof model.isDisposed === "function" && model.isDisposed()))
        monaco.editor.setModelMarkers(model, OWNER, []);
    }
    synced.clear();
  }

  /* Run an editor action through the server. False when this model is not ours. */
  function run(action) {
    const id = ACTIONS[action];
    const model = editor && editor.getModel();
    if (!id || !handles(model)) return false;
    editor.focus();
    const command = editor.getAction(id);
    if (command) void command.run();
    else editor.trigger("flowstudio", id, null);
    return true;
  }

  /* True when the server already marks this line with a warning or error. */
  function coversLine(model, line) {
    if (!handles(model)) return false;
    return monaco.editor.getModelMarkers({ owner: OWNER, resource: model.uri })
      .some(marker => marker.severity >= monaco.MarkerSeverity.Warning &&
        marker.startLineNumber <= line && marker.endLineNumber >= line);
  }

  return Object.freeze({
    start, stop, handles, run, coversLine, pollEvents, uriFor, syncProject,
    hover: (model, position) => hoverAt(model, position),
    projectFiles: () => [...background.keys()],
    flush: model => flushChange(model),
    state: () => state,
    capabilities: () => capabilities
  });
}

/* Keyboard bindings that send Flow to the server and other buffers to the
 * lexical commands in index.html. */
function bindKeys(monaco, editor, app) {
  const { KeyMod, KeyCode } = monaco;
  const command = name => () => {
    const handler = app.commands && app.commands[name];
    if (typeof handler === "function") handler();
  };
  editor.addCommand(KeyCode.F12, command("goToDefinition"));
  editor.addCommand(KeyMod.Shift | KeyCode.F12, command("findReferences"));
  editor.addCommand(KeyCode.F2, command("renameSymbol"));
  editor.addCommand(KeyMod.Shift | KeyMod.Alt | KeyCode.KeyF, command("formatDocument"));
}

const api = Object.freeze({ create, bindKeys, uriForPath, listFlowFiles, markdownOf, OWNER });
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioFlowLspClient = api;
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  const host = global.FlowStudioEditor;
  if (!host || !host.editor || !global.FlowStudioMonaco || !global.FlowStudioApp) return;
  const client = create({ monaco: global.FlowStudioMonaco, editor: host.editor,
    app: global.FlowStudioApp, documentIdFor: host.documentIdFor });
  global.FlowStudioFlowLsp = client;
  bindKeys(global.FlowStudioMonaco, host.editor, global.FlowStudioApp);
  void client.start();
});
})(globalThis);
