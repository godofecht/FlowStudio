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
 */
(function (global) {
"use strict";
const REQUEST_ROUTE = "/api/lsp/request";
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

function uriForPath(path) {
  return URI_ROOT + String(path).split("/").filter(Boolean).map(encodeURIComponent).join("/");
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
  const providers = [];
  const watchers = [];
  let pollTimers = [];

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
      diagnostics: [], subscriptions: [] };
    synced.set(model, entry);
    entry.subscriptions.push(model.onDidChangeContent(() => scheduleChange(model)));
    entry.subscriptions.push(model.onWillDispose(() => close(model)));
    void notify("textDocument/didOpen", { textDocument: { uri: entry.uri, languageId: "flow",
      version: entry.version, text } });
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
    const text = model.getValue();
    let sent;
    if (uri !== entry.uri) {
      // The document was renamed or saved under a new path.
      void notify("textDocument/didClose", { textDocument: { uri: entry.uri } });
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
        version: entry.version, text: model.getValue() } });
    }
    schedulePolls();
  }

  function modelForUri(uri) {
    for (const [model, entry] of synced) if (entry.uri === uri) return model;
    return null;
  }

  function severityOf(value) {
    const severity = monaco.MarkerSeverity;
    return value === 1 ? severity.Error : value === 2 ? severity.Warning :
      value === 3 ? severity.Info : severity.Hint;
  }

  function markerOf(model, diagnostic) {
    const range = toRange(diagnostic.range);
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

  function locationsOf(result) {
    const list = result == null ? [] : Array.isArray(result) ? result : [result];
    const out = [];
    for (const item of list) {
      const uri = item && (item.targetUri || item.uri);
      const range = toRange(item && (item.targetSelectionRange || item.targetRange || item.range));
      const target = typeof uri === "string" ? modelForUri(uri) : null;
      // Targets outside the open documents (files on disk, the standard
      // library) have no buffer to show, so they are left out.
      if (target && range) out.push({ uri: target.uri, range });
    }
    return out;
  }

  function workspaceEditOf(edit) {
    const edits = [];
    const add = (uri, textEdits) => {
      const target = modelForUri(uri);
      if (!target || !Array.isArray(textEdits)) return;
      for (const textEdit of textEdits) {
        const range = toRange(textEdit.range);
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

  function completionItem(item, fallbackRange) {
    const kinds = monaco.languages.CompletionItemKind;
    const name = COMPLETION_KINDS[item.kind] || "Text";
    const edit = item.textEdit;
    const range = edit ? toRange(edit.range || edit.replace) : null;
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
          textDocument: { uri: entry.uri }, position: fromPosition(position),
          context: { triggerKind: (context && context.triggerKind || 0) + 1,
            triggerCharacter: context ? context.triggerCharacter : undefined }
        }).catch(() => null);
        const items = Array.isArray(result) ? result : result && Array.isArray(result.items) ? result.items : [];
        const word = model.getWordUntilPosition(position);
        const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn, endColumn: position.column };
        return { suggestions: items.slice(0, 500).map(item => completionItem(item, fallback)),
          incomplete: !!(result && result.isIncomplete) };
      }
    }));
    providers.push(languages.registerHoverProvider("flow", {
      async provideHover(model, position) {
        if (!handles(model)) return null;
        const entry = await prepare(model, false);
        if (!entry) return null;
        const result = await request("textDocument/hover", {
          textDocument: { uri: entry.uri }, position: fromPosition(position) }).catch(() => null);
        const contents = result ? markdownOf(result.contents) : [];
        if (!contents.length) return null;
        return { contents, range: toRange(result.range) || undefined };
      }
    }));
    providers.push(languages.registerDefinitionProvider("flow", {
      async provideDefinition(model, position) {
        if (!handles(model)) return null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        return locationsOf(await request("textDocument/definition", {
          textDocument: { uri: entry.uri }, position: fromPosition(position) }).catch(() => null));
      }
    }));
    providers.push(languages.registerReferenceProvider("flow", {
      async provideReferences(model, position, context) {
        if (!handles(model)) return null;
        const entry = await prepare(model, true);
        if (!entry) return null;
        return locationsOf(await request("textDocument/references", {
          textDocument: { uri: entry.uri }, position: fromPosition(position),
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
          textDocument: { uri: entry.uri }, position: fromPosition(position) }).catch(() => null);
        if (!Array.isArray(result)) return null;
        return result.map(item => ({ range: toRange(item.range),
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
            position: fromPosition(position), newName });
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
            position: fromPosition(position) });
        } catch (error) {
          return { range: range || undefined, text: word ? word.word : "", rejectReason: error.message };
        }
        if (!result) return { range: range || undefined, text: word ? word.word : "",
          rejectReason: "This name cannot be renamed." };
        if (result.start) return { range: toRange(result), text: model.getValueInRange(toRange(result)) };
        if (result.range) return { range: toRange(result.range),
          text: typeof result.placeholder === "string" ? result.placeholder : model.getValueInRange(toRange(result.range)) };
        return range ? { range, text: word.word } : null;
      }
    }));
    providers.push(languages.registerDocumentFormattingEditProvider("flow", {
      async provideDocumentFormattingEdits(model, formatting) {
        if (!handles(model)) return null;
        const entry = await prepare(model, false);
        if (!entry) return null;
        return textEditsOf(await request("textDocument/formatting", { textDocument: { uri: entry.uri },
          options: { tabSize: formatting.tabSize, insertSpaces: formatting.insertSpaces } }).catch(() => null));
      }
    }));
    providers.push(languages.registerDocumentRangeFormattingEditProvider("flow", {
      async provideDocumentRangeFormattingEdits(model, range, formatting) {
        if (!handles(model)) return null;
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
        const symbol = item => {
          const range = toRange(item.range || (item.location && item.location.range));
          if (!range) return null;
          return { name: String(item.name), detail: item.detail ? String(item.detail) : "",
            kind: Math.max(0, (item.kind || 1) - 1), tags: [], range,
            selectionRange: toRange(item.selectionRange) || range,
            children: Array.isArray(item.children) ? item.children.map(symbol).filter(Boolean) : [] };
        };
        return Array.isArray(result) ? result.map(symbol).filter(Boolean) : [];
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
          const r = toRange(diagnostic.range);
          return r && markers.some(marker => marker.startLineNumber === r.startLineNumber &&
            marker.startColumn === r.startColumn && marker.message === String(diagnostic.message));
        });
        const result = await request("textDocument/codeAction", { textDocument: { uri: entry.uri },
          range: fromRange(range), context: { diagnostics } }).catch(() => null);
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
          const id = target ? documentIdFor(target) : null;
          if (!id || typeof app.activateDocument !== "function" || !app.activateDocument(id)) return false;
          const view = editor || source;
          if (selection && selection.startLineNumber) {
            view.setSelection(selection);
            view.revealRangeInCenterIfOutsideViewport(selection);
          } else if (selection && selection.lineNumber) {
            view.setPosition(selection);
            view.revealPositionInCenterIfOutsideViewport(selection);
          }
          return true;
        }
      }));
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

  async function start() {
    if (state !== "idle") return state === "ready";
    state = "starting";
    let result = null;
    try {
      result = await request("initialize", { processId: null, rootUri: null, capabilities: {} });
    } catch (_) { result = null; }
    if (!result || !result.capabilities) { state = "unavailable"; return false; }
    capabilities = result.capabilities;
    state = "ready";
    register();
    watchModels();
    return true;
  }

  /* The server went away for good: hand everything back to the older helpers. */
  function stop() {
    if (state !== "ready") return;
    state = "unavailable";
    for (const disposable of providers.splice(0)) disposable.dispose();
    for (const disposable of watchers.splice(0)) disposable.dispose();
    for (const timer of pollTimers) timers.clearTimeout(timer);
    pollTimers = [];
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
    start, stop, handles, run, coversLine, pollEvents, uriFor,
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

const api = Object.freeze({ create, bindKeys, uriForPath, markdownOf, OWNER });
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
