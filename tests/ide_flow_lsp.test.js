"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const client = require("../web/ide_flow_lsp.js");

/* A fake clock: timers run only when the test advances time. */
function clock() {
  let time = 1000, next = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: time + (delay || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        await flush();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = Math.max(time, due[1].at);
        due[1].fn();
      }
      time = end;
      await flush();
    }
  };
}
async function flush() { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); }

let modelSeq = 0;
function fakeModel(text, language = "flow") {
  const listeners = { change: [], dispose: [] };
  const model = {
    id: "m" + (++modelSeq),
    uri: { toString() { return "inmemory://model/" + this.owner.id; } },
    text, language, disposed: false,
    getValue: () => model.text,
    getValueLength: () => model.text.length,
    getLanguageId: () => model.language,
    isDisposed: () => model.disposed,
    getLineCount: () => model.text.split("\n").length,
    getLineContent: n => model.text.split("\n")[n - 1] || "",
    getWordUntilPosition(p) {
      const before = model.getLineContent(p.lineNumber).slice(0, p.column - 1);
      const word = /[A-Za-z0-9_]*$/.exec(before)[0];
      return { word, startColumn: p.column - word.length, endColumn: p.column };
    },
    getWordAtPosition(p) {
      const line = model.getLineContent(p.lineNumber);
      let s = p.column - 1, e = p.column - 1;
      while (s > 0 && /\w/.test(line[s - 1])) s--;
      while (e < line.length && /\w/.test(line[e])) e++;
      return s === e ? null : { word: line.slice(s, e), startColumn: s + 1, endColumn: e + 1 };
    },
    getValueInRange(r) { return model.getLineContent(r.startLineNumber).slice(r.startColumn - 1, r.endColumn - 1); },
    onDidChangeContent(fn) { listeners.change.push(fn); return { dispose() { listeners.change = listeners.change.filter(f => f !== fn); } }; },
    onWillDispose(fn) { listeners.dispose.push(fn); return { dispose() {} }; },
    edit(next) { model.text = next; listeners.change.forEach(fn => fn()); },
    changeListeners: () => listeners.change.length
  };
  model.uri.owner = model;
  return model;
}

function fakeMonaco(models) {
  const providers = {};
  const markers = new Map();
  const disposed = [];
  const register = kind => (language, provider) => {
    assert.equal(language, "flow");
    providers[kind] = provider;
    return { dispose() { disposed.push(kind); delete providers[kind]; } };
  };
  const kinds = { Method: 0, Function: 1, Constructor: 2, Field: 3, Variable: 4, Class: 5, Struct: 6,
    Interface: 7, Module: 8, Property: 9, Event: 10, Operator: 11, Unit: 12, Value: 13, Constant: 14,
    Enum: 15, EnumMember: 16, Keyword: 17, Text: 18, Color: 19, File: 20, Reference: 21,
    Customcolor: 22, Folder: 23, TypeParameter: 24, User: 25, Issue: 26, Snippet: 27 };
  return {
    providers, markers, disposed,
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    KeyMod: { Shift: 1024, Alt: 512 }, KeyCode: { F2: 60, F12: 70, KeyF: 36 },
    languages: {
      CompletionItemKind: kinds,
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: register("completion"),
      registerHoverProvider: register("hover"),
      registerDefinitionProvider: register("definition"),
      registerReferenceProvider: register("references"),
      registerDocumentHighlightProvider: register("highlight"),
      registerRenameProvider: register("rename"),
      registerDocumentFormattingEditProvider: register("format"),
      registerDocumentRangeFormattingEditProvider: register("rangeFormat"),
      registerDocumentSymbolProvider: register("symbols"),
      registerCodeActionProvider: register("codeAction")
    },
    editor: {
      getModels: () => models,
      onDidCreateModel: () => ({ dispose() {} }),
      onDidChangeModelLanguage: () => ({ dispose() {} }),
      setModelMarkers(model, owner, list) { markers.set(model.id + ":" + owner, list); },
      getModelMarkers({ owner, resource }) {
        const model = models.find(m => m.uri === resource);
        return (markers.get(model.id + ":" + owner) || []).map(m => Object.assign({ owner }, m));
      },
      registerEditorOpener(opener) { providers.opener = opener; return { dispose() { delete providers.opener; } }; }
    }
  };
}

const CAPABILITIES = { capabilities: { textDocumentSync: { openClose: true, change: 1 },
  completionProvider: { triggerCharacters: [".", ":", "<"] }, hoverProvider: true } };

/* Fake bridge: records every JSON-RPC message, answers from a table. */
function fakeBridge(answers = {}) {
  const sent = [];
  const events = [];
  let unavailable = false;
  async function fetch(route, init) {
    assert.equal(init.method, "POST");
    assert.equal(init.headers["X-FlowStudio-Intent"], "run");
    const reply = (status, body) => ({ status, text: async () => typeof body === "string" ? body : JSON.stringify(body) });
    if (unavailable) return reply(503, "The Flow language server is unavailable.");
    if (route === "/api/lsp/events") return reply(200, events.splice(0));
    if (route === "/api/lsp/start") return reply(200, { available: true });
    assert.equal(route, "/api/lsp/request");
    const message = JSON.parse(init.body);
    sent.push(message);
    if (message.id === undefined) return reply(200, "null");
    if (message.method === "initialize") return reply(200, { jsonrpc: "2.0", id: message.id, result: CAPABILITIES });
    const answer = answers[message.method];
    if (answer && answer.error) return reply(200, { jsonrpc: "2.0", id: message.id, error: answer.error });
    return reply(200, { jsonrpc: "2.0", id: message.id,
      result: typeof answer === "function" ? answer(message.params) : answer === undefined ? null : answer });
  }
  return { fetch, sent, events, goAway() { unavailable = true; },
    methods: () => sent.map(m => m.method) };
}

function setup({ answers, docs, models, fetch } = {}) {
  const time = clock();
  models = models || [fakeModel("function add_one(x: i32) -> i32 {\n    return x + 1\n}\n")];
  docs = docs || { [models[0].id]: { id: "doc-1", name: "main.flow", path: "src/main.flow" } };
  const monaco = fakeMonaco(models);
  const bridge = fakeBridge(answers);
  const activated = [];
  const editor = {
    model: models[0],
    getModel() { return this.model; },
    focus() {}, actions: [],
    getAction(id) { return { run: () => { editor.actions.push(id); } }; },
    setSelection(s) { this.selection = s; }, revealRangeInCenterIfOutsideViewport() {},
    setPosition(p) { this.position = p; }, revealPositionInCenterIfOutsideViewport() {}
  };
  const app = {
    documents: { find: id => Object.values(docs).find(d => d.id === id) || null },
    activateDocument(id) {
      activated.push(id);
      editor.model = models.find(m => docs[m.id] && docs[m.id].id === id);
      return true;
    }
  };
  const lsp = client.create({ monaco, editor, app, fetch: fetch || bridge.fetch, scheduler: time, now: time.now,
    documentIdFor: model => docs[model.id] ? docs[model.id].id : null });
  return { lsp, monaco, bridge, time, models, docs, editor, activated };
}

test("an unavailable server registers nothing and leaves the lexical helpers on", async () => {
  const f = setup({ fetch: async () => ({ status: 503, text: async () => "unavailable" }) });
  assert.equal(await f.lsp.start(), false);
  assert.equal(f.lsp.state(), "unavailable");
  assert.deepEqual(Object.keys(f.monaco.providers), []);
  assert.equal(f.lsp.handles(f.models[0]), false);
  assert.equal(f.lsp.run("definition"), false);
});

test("a missing flow lsp is found by the start probe, with no failed request", async () => {
  const routes = [];
  const f = setup({ fetch: async route => {
    routes.push(route);
    return { status: 200, text: async () => JSON.stringify({ available: false }) };
  } });
  assert.equal(await f.lsp.start(), false);
  assert.equal(f.lsp.state(), "unavailable");
  assert.deepEqual(routes, ["/api/lsp/start"]);
  assert.deepEqual(Object.keys(f.monaco.providers), []);
});

test("start registers every provider and opens Flow models under their project path", async () => {
  const f = setup();
  assert.equal(await f.lsp.start(), true);
  await f.time.advance(0);
  assert.deepEqual(Object.keys(f.monaco.providers).sort(), ["codeAction", "completion", "definition",
    "format", "highlight", "hover", "opener", "rangeFormat", "references", "rename", "symbols"]);
  assert.deepEqual(f.monaco.providers.completion.triggerCharacters, [".", ":", "<"]);
  const open = f.bridge.sent.find(m => m.method === "textDocument/didOpen");
  assert.equal(open.params.textDocument.uri, "file:///flowstudio/src/main.flow");
  assert.equal(open.params.textDocument.text, f.models[0].text);
  assert.equal(f.lsp.handles(f.models[0]), true);
  assert.equal(f.lsp.handles(fakeModel("x = 1", "python")), false);
});

test("untitled buffers get a stable uri from their document id", () => {
  const f = setup({ docs: {} });
  const model = f.models[0];
  f.docs[model.id] = { id: "doc-7", name: "scratch.flow", path: null };
  assert.equal(f.lsp.uriFor(model), "file:///flowstudio/untitled/doc-7/scratch.flow");
  assert.equal(client.uriForPath("a b/c.flow"), "file:///flowstudio/a%20b/c.flow");
});

test("edits debounce into one full didChange and diagnostics become markers", async () => {
  const f = setup();
  await f.lsp.start();
  await f.time.advance(0);
  const model = f.models[0];
  model.edit("function main() -> i32 {\n    return \"x\"\n}\n");
  model.edit("function main() -> i32 {\n    return \"hello\"\n}\n");
  await f.time.advance(100);
  assert.equal(f.bridge.methods().filter(m => m === "textDocument/didChange").length, 0);
  await f.time.advance(200);
  const changes = f.bridge.sent.filter(m => m.method === "textDocument/didChange");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].params.contentChanges[0].text, model.text);
  assert.equal(changes[0].params.textDocument.version, 2);
  f.bridge.events.push({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
    uri: "file:///flowstudio/src/main.flow", diagnostics: [
      { range: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } }, severity: 2,
        source: "flow-typecheck", message: "returns a non-i32 value from an i32 function" },
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, severity: 1,
        source: "flow-parser", message: "parse error" }] } });
  await f.time.advance(2500);
  const markers = f.monaco.markers.get(model.id + ":flow-lsp");
  assert.equal(markers.length, 2);
  assert.deepEqual([markers[0].startLineNumber, markers[0].startColumn, markers[0].endColumn, markers[0].severity],
    [2, 5, 11, 4]);
  assert.equal(markers[0].message, "returns a non-i32 value from an i32 function");
  assert.equal(markers[1].severity, 8);
  assert.equal(markers[1].endColumn, 2, "an empty range still shows one character");
  assert.equal(f.lsp.coversLine(model, 2), true);
  assert.equal(f.lsp.coversLine(model, 3), false);
});

test("completion maps kinds, snippets and edit ranges and skips math commands", async () => {
  const f = setup({ answers: { "textDocument/completion": [
    { label: "add_one", kind: 3, detail: "(x: i32) -> i32" },
    { label: "while", kind: 14 },
    { label: "fn", kind: 15, insertText: "function ${1:name}() {\n    $0\n}", insertTextFormat: 2 },
    { label: "len", kind: 2, textEdit: { newText: "len()", range: { start: { line: 1, character: 4 }, end: { line: 1, character: 6 } } } }
  ] } });
  await f.lsp.start();
  await f.time.advance(0);
  const model = f.models[0];
  model.edit("function add_one(x: i32) -> i32 {\n    ad\n}\n");
  const pending = f.monaco.providers.completion.provideCompletionItems(model, { lineNumber: 2, column: 7 }, { triggerKind: 0 });
  await f.time.advance(0);
  const list = await pending;
  // The pending edit reached the server before the completion request.
  const methods = f.bridge.methods();
  assert.ok(methods.lastIndexOf("textDocument/didChange") < methods.lastIndexOf("textDocument/completion"));
  const request = f.bridge.sent.find(m => m.method === "textDocument/completion");
  assert.deepEqual(request.params.position, { line: 1, character: 6 });
  assert.equal(request.params.context.triggerKind, 1);
  const [fn, kw, snippet, edit] = list.suggestions;
  assert.equal(fn.kind, 1);
  assert.equal(fn.detail, "(x: i32) -> i32");
  assert.deepEqual(fn.range, { startLineNumber: 2, endLineNumber: 2, startColumn: 5, endColumn: 7 });
  assert.equal(kw.kind, 17);
  assert.equal(snippet.insertTextRules, 4);
  assert.equal(edit.insertText, "len()");
  assert.deepEqual(edit.range, { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 7 });
  model.edit("function add_one(x: i32) -> i32 {\n    \\nab\n}\n");
  assert.equal(await f.monaco.providers.completion.provideCompletionItems(model, { lineNumber: 2, column: 9 }, {}), null);
});

test("hover returns the server markdown", async () => {
  const value = "```flow\nfunction add_one(x: i32) -> i32\n```\n\n*typechecked function:* `(i32) -> i32`";
  const f = setup({ answers: { "textDocument/hover": { contents: { kind: "markdown", value } } } });
  await f.lsp.start();
  await f.time.advance(0);
  const hover = await f.monaco.providers.hover.provideHover(f.models[0], { lineNumber: 1, column: 12 });
  assert.deepEqual(hover.contents, [{ value }]);
  assert.deepEqual(client.markdownOf([{ language: "flow", value: "x" }, "plain"]),
    [{ value: "```flow\nx\n```" }, { value: "plain" }]);
});

test("definition maps server uris to open models and opens the other document", async () => {
  const main = fakeModel("import .lib { twice }\nfunction main() -> i32 {\n    return twice(2)\n}\n");
  const lib = fakeModel("export function twice(x: i32) -> i32 {\n    return x * 2\n}\n");
  const docs = { [main.id]: { id: "doc-1", name: "main.flow", path: "main.flow" },
    [lib.id]: { id: "doc-2", name: "lib.flow", path: "lib.flow" } };
  const range = { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } };
  const f = setup({ models: [main, lib], docs, answers: { "textDocument/definition": [
    { uri: "file:///flowstudio/lib.flow", range },
    { uri: "file:///elsewhere/std/math.flow", range }] } });
  await f.lsp.start();
  await f.time.advance(0);
  const pending = f.monaco.providers.definition.provideDefinition(main, { lineNumber: 3, column: 13 });
  await f.time.advance(300);
  const locations = await pending;
  assert.equal(locations.length, 1, "targets with no open buffer are left out");
  assert.equal(locations[0].uri, lib.uri);
  assert.deepEqual(locations[0].range, { startLineNumber: 1, startColumn: 17, endLineNumber: 1, endColumn: 22 });
  const opened = f.monaco.providers.opener.openCodeEditor(f.editor, lib.uri, locations[0].range);
  assert.equal(opened, true);
  assert.deepEqual(f.activated, ["doc-2"]);
  assert.deepEqual(f.editor.selection, locations[0].range);
});

test("rename returns every edit and reports refusals", async () => {
  const edits = [[2, 9, 16], [7, 17, 24], [8, 20, 27]].map(([line, a, b]) => ({
    range: { start: { line, character: a }, end: { line, character: b } }, newText: "inc" }));
  let refuse = false;
  const f = setup({ answers: {
    "textDocument/rename": () => ({ changes: { "file:///flowstudio/src/main.flow": edits } }),
    "textDocument/prepareRename": () => refuse ? null : { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 16 } }, placeholder: "add_one" }
  } });
  await f.lsp.start();
  await f.time.advance(0);
  const model = f.models[0];
  let pending = f.monaco.providers.rename.resolveRenameLocation(model, { lineNumber: 1, column: 12 });
  await f.time.advance(300);
  const location = await pending;
  assert.equal(location.text, "add_one");
  assert.deepEqual(location.range, { startLineNumber: 1, startColumn: 10, endLineNumber: 1, endColumn: 17 });
  pending = f.monaco.providers.rename.provideRenameEdits(model, { lineNumber: 1, column: 12 }, "inc");
  await f.time.advance(300);
  const result = await pending;
  assert.equal(result.edits.length, 3);
  assert.ok(result.edits.every(e => e.resource === model.uri && e.textEdit.text === "inc"));
  refuse = true;
  pending = f.monaco.providers.rename.resolveRenameLocation(model, { lineNumber: 1, column: 1 });
  await f.time.advance(300);
  assert.match((await pending).rejectReason, /cannot be renamed/);
});

test("a rename error from the server becomes a reject reason", async () => {
  const f = setup({ answers: { "textDocument/rename": { error: { code: -32803, message: "'while' is a keyword" } } } });
  await f.lsp.start();
  await f.time.advance(0);
  const pending = f.monaco.providers.rename.provideRenameEdits(f.models[0], { lineNumber: 1, column: 12 }, "while");
  await f.time.advance(300);
  assert.deepEqual(await pending, { edits: [], rejectReason: "'while' is a keyword" });
});

test("formatting, symbols, highlights and code actions convert ranges", async () => {
  const whole = { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } };
  const diagnostic = { range: { start: { line: 1, character: 4 }, end: { line: 1, character: 11 } }, severity: 4,
    source: "flow-idiom", code: "FIDIOM001", message: "Unnecessary 'mut' declaration", data: { replacement: "let x" } };
  let actionParams = null;
  const f = setup({ answers: {
    "textDocument/formatting": [{ range: whole, newText: "formatted\n" }],
    "textDocument/documentSymbol": [{ name: "add_one", kind: 12, detail: "function", range: whole,
      selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 16 } } }],
    "textDocument/documentHighlight": [{ range: whole, kind: 3 }, { range: whole }],
    "textDocument/codeAction": params => { actionParams = params; return [{ title: "Apply fix for FIDIOM001",
      kind: "quickfix", edit: { changes: { "file:///flowstudio/src/main.flow": [{ range: diagnostic.range, newText: "let x" }] } } }]; }
  } });
  await f.lsp.start();
  await f.time.advance(0);
  const model = f.models[0];
  const edits = await f.monaco.providers.format.provideDocumentFormattingEdits(model, { tabSize: 4, insertSpaces: true });
  assert.deepEqual(edits, [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 }, text: "formatted\n" }]);
  const sent = f.bridge.sent.find(m => m.method === "textDocument/formatting");
  assert.deepEqual(sent.params.options, { tabSize: 4, insertSpaces: true });
  let pending = f.monaco.providers.symbols.provideDocumentSymbols(model);
  await f.time.advance(300);
  const [symbol] = await pending;
  assert.equal(symbol.name, "add_one");
  assert.equal(symbol.kind, 11, "LSP Function 12 is Monaco Function 11");
  const highlights = await f.monaco.providers.highlight.provideDocumentHighlights(model, { lineNumber: 1, column: 12 });
  assert.deepEqual(highlights.map(h => h.kind), [2, 0]);
  f.bridge.events.push({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics",
    params: { uri: "file:///flowstudio/src/main.flow", diagnostics: [diagnostic] } });
  await f.lsp.pollEvents();
  const [marker] = f.monaco.markers.get(model.id + ":flow-lsp").map(m => Object.assign({ owner: "flow-lsp" }, m));
  const result = await f.monaco.providers.codeAction.provideCodeActions(model,
    { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 12 }, { markers: [marker] });
  assert.equal(actionParams.context.diagnostics[0].data.replacement, "let x", "fix data goes back to the server");
  assert.equal(result.actions[0].title, "Apply fix for FIDIOM001");
  assert.equal(result.actions[0].edit.edits[0].textEdit.text, "let x");
});

test("a restarted server gets every document again", async () => {
  const f = setup();
  await f.lsp.start();
  await f.time.advance(0);
  f.bridge.events.push({ jsonrpc: "2.0", method: "flowstudio/serverStarted", params: { generation: 1 } });
  await f.lsp.pollEvents();
  const opens = () => f.bridge.methods().filter(m => m === "textDocument/didOpen").length;
  assert.equal(opens(), 1);
  f.bridge.events.push({ jsonrpc: "2.0", method: "flowstudio/serverStarted", params: { generation: 2 } });
  await f.lsp.pollEvents();
  assert.equal(opens(), 2);
});

test("losing the server hands the editor back to the older helpers", async () => {
  const f = setup();
  await f.lsp.start();
  await f.time.advance(0);
  const model = f.models[0];
  f.bridge.events.push({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
    uri: "file:///flowstudio/src/main.flow", diagnostics: [{ range: { start: { line: 0, character: 0 },
      end: { line: 0, character: 3 } }, severity: 1, message: "x" }] } });
  await f.lsp.pollEvents();
  assert.equal(f.monaco.markers.get(model.id + ":flow-lsp").length, 1);
  f.bridge.goAway();
  await f.lsp.pollEvents();
  assert.equal(f.lsp.state(), "unavailable");
  assert.equal(f.lsp.handles(model), false);
  assert.deepEqual(f.monaco.markers.get(model.id + ":flow-lsp"), []);
  assert.deepEqual(Object.keys(f.monaco.providers), []);
  assert.equal(model.changeListeners(), 0);
});

test("run sends Flow buffers to Monaco actions and declines the rest", async () => {
  const f = setup();
  await f.lsp.start();
  await f.time.advance(0);
  assert.equal(f.lsp.run("definition"), true);
  assert.equal(f.lsp.run("format"), true);
  assert.equal(f.lsp.run("rename"), true);
  assert.equal(f.lsp.run("references"), true);
  assert.deepEqual(f.editor.actions, ["editor.action.revealDefinition", "editor.action.formatDocument",
    "editor.action.rename", "editor.action.goToReferences"]);
  f.models[0].language = "python";
  assert.equal(f.lsp.run("definition"), false);
});

test("F12, Shift+F12, F2 and Shift+Alt+F reach the app commands", () => {
  const monaco = fakeMonaco([]);
  const bound = new Map();
  const editor = { addCommand(key, fn) { bound.set(key, fn); } };
  const calls = [];
  const app = { commands: { goToDefinition: () => calls.push("def"), findReferences: () => calls.push("refs"),
    renameSymbol: () => calls.push("rename"), formatDocument: () => calls.push("format") } };
  client.bindKeys(monaco, editor, app);
  bound.get(70)();
  bound.get(1024 | 70)();
  bound.get(60)();
  bound.get(1024 | 512 | 36)();
  assert.deepEqual(calls, ["def", "refs", "rename", "format"]);
});

test("idle compiler checks keep running beside the language server without double markers", async () => {
  const { mount } = require("../web/flow_diagnostics.js");
  const timers = [];
  const model = { getValue: () => "function main() -> i32 {\n    return 0\n}", getVersionId: () => 1,
    getLineCount: () => 3, getLineMaxColumn: () => 30 };
  const handlers = {};
  const decorations = [];
  let owned = true;
  globalThis.FlowStudioFlowLsp = { handles: () => owned, coversLine: (m, line) => line === 2 };
  try {
    mount({
      editor: { getModel: () => model, createDecorationsCollection: () => ({ set: v => decorations.push(v), clear() {} }),
        onDidChangeModelContent: fn => { handlers.content = fn; }, onDidChangeModel() {},
        setPosition() {}, revealPositionInCenterIfOutsideViewport() {} },
      native: { available: () => true, checkSyntax: async () => ({ ok: false, output: "errors",
        diagnostics: [{ line: 2, column: 5, message: "both" }, { line: 3, column: 1, message: "compiler only" }] }) },
      app: { documents: { active: () => ({ id: "doc-1" }) } },
      language: { value: "flow", addEventListener() {} },
      button: { disabled: false, addEventListener(type, fn) { handlers.button = fn; } },
      output: { hidden: true, textContent: "" }, status: { textContent: "", dataset: {} },
      autoCheck: { checked: true, addEventListener(type, fn) { handlers.auto = fn; } },
      scheduler: { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} }
    });
    handlers.content();
    // The server misses errors the strict compiler finds (a let of the wrong
    // type), so the idle check still runs while the server owns the model.
    assert.equal(timers.length, 1, "the idle compiler check still runs");
    handlers.button();
    await flush();
    const shown = decorations.filter(set => set.length).at(-1);
    assert.deepEqual(shown.map(d => d.range.startLineNumber), [3], "a line the server marks is not marked twice");
    owned = false;
    handlers.content();
    assert.equal(timers.length, 2, "idle checks run when the server is gone too");
  } finally {
    delete globalThis.FlowStudioFlowLsp;
  }
});
