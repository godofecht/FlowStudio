"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const assistant = require("../web/ide_assistant.js");

/* ---------- a small DOM fake: enough for the panel ---------- */
class Node_ {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.hidden = false;
    this.value = "";
    this.text = "";
    this.className = "";
    this.id = "";
    this.open = false;
  }
  get textContent() { return this.tagName === "#TEXT" ? this.text : this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === "#FRAGMENT") { this.append(...node.children); node.children = []; continue; }
      if (node.parent) node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.text = ""; this.append(...nodes); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "open") this.open = true; }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "open") this.open = false; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(item => item !== fn); }
  dispatch(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {}, stopPropagation() {}, target: this, ...event }); }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  get scrollHeight() { return 0; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) { return this.all().slice(1).filter(node => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function makeDoc() {
  const doc = { listeners: {}, hidden: false, activeElement: null };
  doc.createElement = tag => new Node_(tag, doc);
  doc.createTextNode = text => { const node = new Node_("#text", doc); node.text = String(text); return node; };
  doc.createDocumentFragment = () => new Node_("#fragment", doc);
  doc.body = doc.createElement("body");
  doc.getElementById = id => doc.body.all().find(node => node.id === id) || null;
  doc.addEventListener = (name, fn) => { (doc.listeners[name] ||= []).push(fn); };
  doc.removeEventListener = (name, fn) => { doc.listeners[name] = (doc.listeners[name] || []).filter(item => item !== fn); };
  doc.key = event => { for (const fn of doc.listeners.keydown || []) fn(event); };
  return doc;
}

/* ---------- a Monaco fake: one model, a selection, markers, a diff editor ---------- */
function offsetAt(text, line, column) {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += lines[i].length + 1;
  return offset + column - 1;
}
function fakeEditor(text) {
  const model = {
    value: text, uri: "inmemory://app",
    getValue() { return this.value; },
    getValueInRange(range) { return this.value.slice(offsetAt(this.value, range.startLineNumber, range.startColumn), offsetAt(this.value, range.endLineNumber, range.endColumn)); },
    getFullModelRange() { const lines = this.value.split("\n"); return { startLineNumber: 1, startColumn: 1, endLineNumber: lines.length, endColumn: lines[lines.length - 1].length + 1 }; }
  };
  let selection = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
  const editor = {
    model, edits: 0,
    getModel: () => model,
    getSelection: () => ({ ...selection, isEmpty: () => selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn }),
    getPosition: () => ({ lineNumber: selection.endLineNumber, column: selection.endColumn }),
    select(range) { selection = range; },
    pushUndoStop() {},
    focus() {},
    executeEdits(_source, list) {
      for (const edit of list) {
        const start = offsetAt(model.value, edit.range.startLineNumber, edit.range.startColumn);
        const end = offsetAt(model.value, edit.range.endLineNumber, edit.range.endColumn);
        model.value = model.value.slice(0, start) + edit.text + model.value.slice(end);
        editor.edits++;
      }
      return true;
    }
  };
  return editor;
}
function fakeMonaco(markers = []) {
  const monaco = { diffs: [], editor: {
    getModelMarkers: () => markers,
    createModel: (value, language) => ({ value, language, dispose() { this.disposed = true; } }),
    createDiffEditor: host => { const diff = { host, model: null, setModel(m) { this.model = m; }, getModel() { return this.model; } }; monaco.diffs.push(diff); return diff; }
  } };
  return monaco;
}
function fakeApp(editor) {
  const docs = [
    { id: "d1", name: "app.flow", path: "demo/app.flow", language: "flow", text: "stale", dirty: false },
    { id: "d2", name: "fit.R", path: "demo/fit.R", language: "r", text: "x <- c(1, 2)\nmean(x)\n", dirty: true }
  ];
  let active = "d1";
  return { docs, activated: [], documents: { list: () => docs.slice(), active: () => docs.find(d => d.id === active) },
    activateDocument(id) { active = id; this.activated.push(id); return true; } };
}

/* A scripted server: the panel's requests and the replies it gets. */
function fakeServer() {
  const calls = [];
  const state = { polls: [], proposals: [], contexts: [], started: [], cancelled: [] };
  state.providers = { providers: [
    { id: "fake", name: "Test provider", available: true, tools: true, models: [] },
    { id: "claude", name: "Claude Code", available: false, tools: true, models: [] },
    { id: "ollama", name: "Ollama (local model)", available: true, tools: false, models: ["small:latest"] }
  ], mcpServer: "/x/mcp/flowstudio_mcp.py", url: "http://127.0.0.1:8763" };
  async function fetch(path, init) {
    calls.push({ path, init });
    assert.equal(init.headers["X-FlowStudio-Intent"], "run", "every call carries the intent header");
    const reply = (status, text) => ({ status, text: async () => text });
    if (path === "/api/assistant/providers") return reply(200, JSON.stringify(state.providers));
    if (path === "/api/assistant/context") { state.contexts.push(JSON.parse(init.body)); return reply(200, ""); }
    if (path === "/api/assistant/start") { state.started.push(init.body); return reply(200, "7"); }
    if (path === "/api/assistant/poll") return reply(200, state.polls.length ? state.polls.shift() : "running\n");
    if (path === "/api/assistant/cancel") { state.cancelled.push(init.body); state.polls = ["cancelled\n\x1e"]; return reply(200, ""); }
    if (path === "/api/assistant/proposals") { const list = state.proposals; state.proposals = []; return reply(200, JSON.stringify(list)); }
    if (path === "/api/run/flow") return reply(200, "twice 21 = 42\n");
    return reply(404, "unknown");
  }
  return { fetch, calls, state };
}
const line = event => JSON.stringify(event) + "\n";
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail("condition not reached");
}
function mountPanel(text = "function main() -> i32 {\n    return 0\n}\n", markers = []) {
  const doc = makeDoc();
  const host = doc.createElement("div");
  host.id = "assistantRoot";
  doc.body.append(host);
  const editor = fakeEditor(text);
  const monaco = fakeMonaco(markers);
  const app = fakeApp(editor);
  const server = fakeServer();
  const shown = [];
  // Unref'd timers: a failed assertion never leaves the proposal poll holding the test runner open.
  const timer = (fn, ms) => { const handle = setTimeout(fn, ms); handle.unref(); return handle; };
  const panel = assistant.mount(doc, { host, app, editor, monaco, fetch: server.fetch, storage: null, pollMs: 5,
    setTimeout: timer, clearTimeout, idleProposalMs: 20,
    firstProposalPoll: 20, sidePanel: { show: name => shown.push(name) } });
  return { doc, host, editor, monaco, app, server, panel, shown };
}

/* ---------- pure parts ---------- */
test("prompts carry the request, selection, errors and history", () => {
  const snapshot = { active: { name: "app.flow", path: "demo/app.flow", language: "flow", text: "let x = 1\n" },
    selection: { text: "let x = 1", startLine: 1, endLine: 1 },
    diagnostics: [{ line: 3, column: 5, message: "Undefined variable 'y'" }] };
  const prompt = assistant.buildPrompt({ action: "fix", snapshot, include: {}, tools: true,
    history: [{ user: "earlier question", assistant: "earlier answer" }] });
  assert.match(prompt, /Fix the compiler errors/);
  assert.match(prompt, /Active file: demo\/app\.flow \(flow\)/);
  assert.match(prompt, /```flow\nlet x = 1\n```/);
  assert.match(prompt, /line 3, column 5: Undefined variable 'y'/);
  assert.match(prompt, /User: earlier question/);
  assert.match(prompt, /flowstudio_editor_state/);
  const excluded = assistant.buildPrompt({ action: "ask", request: "hi", snapshot, include: { selection: false, diagnostics: false, file: false }, tools: true });
  assert.doesNotMatch(excluded, /Undefined variable/);
  assert.doesNotMatch(excluded, /Selected lines/);
  const local = assistant.buildPrompt({ action: "ask", request: "hi", snapshot, include: {}, tools: false });
  assert.doesNotMatch(local, /flowstudio_editor_state/, "Ollama has no tools");
  assert.match(local, /Text of demo\/app\.flow/);
});

test("Claude stream-json becomes text, tool lines and a done event", () => {
  const parser = assistant.createParser("claude");
  const delta = text => line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  const whole = delta("Hel") + delta("lo");
  const events = [...parser.feed(whole.slice(0, 30)), ...parser.feed(whole.slice(30))];
  assert.deepEqual(events.map(event => event.text), ["Hel", "lo"], "a line split across polls is kept");
  const full = parser.feed(line({ type: "assistant", message: { content: [{ type: "text", text: "Hello" },
    { type: "tool_use", id: "t1", name: "mcp__flowstudio__flowstudio_check_code", input: { language: "flow", code: "x" } }] } }));
  assert.deepEqual(full[0], { kind: "text", text: "Hello", replace: true }, "the full message replaces its deltas");
  assert.equal(full[1].kind, "tool");
  const result = parser.feed(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "p.flow:3:1: error: Undefined variable 'x'" }] }] } }));
  assert.deepEqual(result[0], { kind: "tool-result", id: "t1", ok: false, text: "p.flow:3:1: error: Undefined variable 'x'" });
  assert.equal(assistant.toolSummary(full[1].name, full[1].input, false, result[0].text), "Checked flow code: p.flow:3:1: error: Undefined variable 'x'");
  assert.equal(assistant.toolSummary("mcp__flowstudio__flowstudio_check_code", { language: "flow" }, true, ""), "Checked flow code: ok");
  assert.equal(assistant.toolSummary("mcp__flowstudio__flowstudio_propose_edit", { file: "app.flow" }, true, ""), "Proposed an edit to app.flow");
  assert.deepEqual(parser.feed(line({ type: "result", is_error: false })), [{ kind: "done", ok: true }]);
});

test("Codex JSONL and Ollama text are parsed", () => {
  const codex = assistant.createParser("codex");
  const events = codex.feed(
    line({ type: "item.started", item: { id: "c1", type: "mcp_tool_call", server: "flowstudio", tool: "flowstudio_check_code", arguments: { language: "flow" } } }) +
    line({ type: "item.completed", item: { id: "c1", type: "mcp_tool_call", status: "completed", result: { content: [{ type: "text", text: "ok" }] } } }) +
    line({ type: "item.completed", item: { type: "agent_message", text: "Done." } }) +
    line({ type: "turn.completed" }));
  assert.deepEqual(events.map(event => event.kind), ["tool", "tool-result", "text", "done"]);
  assert.equal(events[1].ok, true);
  const ollama = assistant.createParser("ollama");
  assert.deepEqual(ollama.feed("plain {not json}"), [{ kind: "text", text: "plain {not json}" }]);
});

test("poll replies, markdown fences and diagnostics parse", () => {
  assert.deepEqual(assistant.parsePoll("running\nabc"), { finished: false, state: "running", output: "abc", stderr: "" });
  assert.deepEqual(assistant.parsePoll("exit 2\nout\x1eerr"), { finished: true, state: "exit 2", output: "out", stderr: "err", code: 2 });
  assert.equal(assistant.parsePoll("cancelled\n\x1e").code, null);
  const segments = assistant.splitMarkdown("Text\n```flow\nfunction f() {\n```\nmore\n```py\nopen");
  assert.deepEqual(segments.map(segment => [segment.type, segment.language, segment.closed]),
    [["text", undefined, undefined], ["code", "flow", true], ["text", undefined, undefined], ["code", "py", false]]);
  assert.deepEqual(assistant.parseDiagnostics("/tmp/x/prog.flow:3:13: error: Undefined variable 'total'\nflowc emit: typecheck failed"),
    [{ line: 3, column: 13, severity: "error", message: "Undefined variable 'total'" }]);
});

test("proposals replace a file or insert lines", () => {
  assert.equal(assistant.applyProposal("a\nb\n", { mode: "replace", content: "z\n" }), "z\n");
  assert.equal(assistant.applyProposal("a\nb\n", { mode: "insert", content: "x\n", line: 2 }), "a\nx\nb\n");
  assert.equal(assistant.applyProposal("a\nb", { mode: "insert", content: "x" }, 1), "x\na\nb");
  assert.equal(assistant.applyProposal("a", { mode: "insert", content: "x", line: 99 }), "a\nx");
});

test("the snapshot reads the live editor and stays bounded", () => {
  const editor = fakeEditor("line one\nline two\n");
  editor.select({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 9 });
  const app = fakeApp(editor);
  app.docs.push({ id: "big", name: "big.flow", language: "flow", text: "x".repeat(50000) });
  const snapshot = assistant.collectSnapshot({ app, editor, monaco: fakeMonaco([{ startLineNumber: 2, startColumn: 3, severity: 8, message: "bad" }]),
    consoleText: "y".repeat(10000), proposals: [{ id: 1, file: "app.flow", status: "accepted" }] });
  assert.equal(snapshot.active.text, "line one\nline two\n", "the live model wins over stale document text");
  assert.deepEqual(snapshot.selection, { text: "line two", startLine: 2, startColumn: 1, endLine: 2, endColumn: 9 });
  assert.deepEqual(snapshot.cursor, { line: 2, column: 9 });
  assert.deepEqual(snapshot.diagnostics, [{ line: 2, column: 3, severity: "error", message: "bad" }]);
  assert.equal(snapshot.openFiles.find(file => file.name === "fit.R").text, "x <- c(1, 2)\nmean(x)\n");
  assert.equal(snapshot.openFiles.find(file => file.name === "big.flow").text, undefined, "large files are listed without text");
  assert.ok(snapshot.console.length <= 6000);
  assert.ok(JSON.stringify(snapshot).length < 131072);
});

/* ---------- the panel ---------- */
test("a prompt streams into the thread with tool lines, and the context is shared", async () => {
  const { host, server, panel, editor } = mountPanel();
  await panel.ready;
  assert.equal(host.querySelector("#assistantProvider").value, "fake");
  editor.select({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 13 });
  const delta = text => line({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  server.state.polls = [
    "running\n" + delta("Checking "),
    "running\n" + line({ type: "assistant", message: { content: [{ type: "text", text: "Checking it." },
      { type: "tool_use", id: "t1", name: "mcp__flowstudio__flowstudio_check_code", input: { language: "flow", code: "x" } }] } }),
    "running\n" + line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: [{ type: "text", text: "passed" }] }] } }),
    "exit 0\n" + line({ type: "assistant", message: { content: [{ type: "text", text: "Here:\n\n```flow\nfunction main() -> i32 {\n    return 0\n}\n```\n" }] } }) + line({ type: "result", is_error: false }) + "\x1e"
  ];
  host.querySelector("#assistantInput").value = "make it print";
  host.querySelector("#assistantSend").click();
  await until(() => server.state.started.length === 1);
  const [provider, model, runs, ...prompt] = server.state.started[0].split("\n");
  assert.deepEqual([provider, model, runs], ["fake", "", "1"]);
  assert.match(prompt.join("\n"), /Request: make it print/);
  assert.match(prompt.join("\n"), /Selected lines 2 to 2/);
  assert.equal(server.state.contexts.at(-1).selection.text, "return 0", "the snapshot went to the server before the job");
  assert.equal(host.querySelector("#assistantStop").hidden, false);
  await until(() => !panel.busy());
  const thread = host.querySelector("#assistantThread");
  const tool = thread.querySelectorAll(".as-tool")[0];
  assert.equal(tool.textContent, "Checked flow code: ok");
  assert.equal(tool.dataset.state, "ok");
  assert.match(thread.textContent, /Checking it\./);
  assert.doesNotMatch(thread.textContent, /Checking Checking/, "deltas are replaced by the full message");
  const code = thread.querySelector(".as-code");
  assert.ok(code, "the code block renders");
  const buttons = code.querySelectorAll("button").map(button => button.textContent);
  assert.deepEqual(buttons, ["Insert at cursor", "Replace selection", "Run"]);
  code.querySelectorAll("button")[1].click();
  assert.equal(editor.model.value, "function main() -> i32 {\n    function main() -> i32 {\n    return 0\n}\n\n}\n", "Replace selection edits through Monaco");
  code.querySelectorAll("button")[2].click();
  await until(() => code.querySelector(".as-run-output").textContent === "twice 21 = 42");
  assert.equal(host.querySelector("#assistantStop").hidden, true);
  panel.dispose();
});

test("Stop cancels the job", async () => {
  const { server, panel, host } = mountPanel();
  await panel.ready;
  host.querySelector("#assistantInput").value = "long task";
  await panel.send("ask", "long task");
  assert.equal(panel.busy(), true);
  host.querySelector("#assistantStop").click();
  await until(() => !panel.busy());
  assert.deepEqual(server.state.cancelled, ["7"]);
  assert.match(host.querySelector("#assistantThread").textContent, /Stopped\./);
  panel.dispose();
});

test("actions refuse without what they need and never start a job", async () => {
  const { server, panel, host } = mountPanel();
  await panel.ready;
  assert.equal(await panel.send("explain", ""), false);
  assert.match(host.querySelector("#assistantStatus").textContent, /Select some code first/);
  assert.equal(await panel.send("fix", ""), false);
  assert.match(host.querySelector("#assistantStatus").textContent, /No compiler errors/);
  assert.equal(server.state.started.length, 0);
  panel.dispose();
});

test("a proposal opens as a diff; Accept edits the file and is reported back", async () => {
  const { server, panel, editor, monaco, app, doc } = mountPanel("a\nb\n");
  await panel.ready;
  server.state.proposals = [{ id: 4, proposal: { file: "demo/app.flow", mode: "replace", content: "a\nB\n", summary: "Fix b" } }];
  await until(() => panel.showingProposal());
  assert.deepEqual(app.activated, ["d1"]);
  const dialog = doc.getElementById("assistantDiff");
  assert.equal(dialog.open, true);
  assert.equal(doc.getElementById("assistantDiffTitle").textContent, "Proposed edit to demo/app.flow");
  assert.equal(doc.getElementById("assistantDiffSummary").textContent, "Fix b");
  assert.deepEqual([monaco.diffs[0].model.original.value, monaco.diffs[0].model.modified.value], ["a\nb\n", "a\nB\n"]);
  doc.getElementById("assistantAccept").click();
  assert.equal(editor.model.value, "a\nB\n");
  assert.equal(dialog.open, false);
  assert.deepEqual(panel.decisions(), [{ id: 4, file: "demo/app.flow", status: "accepted" }]);
  await until(() => (server.state.contexts.at(-1).proposals || []).length === 1);

  server.state.proposals = [{ id: 5, proposal: { file: "app.flow", mode: "insert", line: 1, content: "# top\n" } }];
  await until(() => panel.showingProposal());
  doc.getElementById("assistantReject").click();
  assert.equal(editor.model.value, "a\nB\n", "Reject leaves the file alone");
  assert.equal(panel.decisions()[1].status, "rejected");

  server.state.proposals = [{ id: 6, proposal: { file: "app.flow", mode: "replace", content: "zzz" } }];
  await until(() => panel.showingProposal());
  editor.model.value = "edited meanwhile";
  doc.getElementById("assistantAccept").click();
  assert.equal(editor.model.value, "edited meanwhile", "a stale diff is never applied");
  assert.match(panel.decisions()[2].status, /changed while the diff was open/);

  server.state.proposals = [{ id: 7, proposal: { file: "missing.flow", mode: "replace", content: "x" } }];
  await until(() => panel.decisions().length === 4);
  assert.equal(panel.decisions()[3].status, "file not open");
  panel.dispose();
});

test("Ctrl+I and Cmd+I open the Assistant and focus the input", async () => {
  const { doc, panel, shown, host } = mountPanel();
  await panel.ready;
  let prevented = false;
  doc.key({ key: "i", ctrlKey: true, preventDefault() { prevented = true; }, stopPropagation() {} });
  doc.key({ key: "I", metaKey: true, preventDefault() {}, stopPropagation() {} });
  doc.key({ key: "i", ctrlKey: true, shiftKey: true, preventDefault() { assert.fail("Ctrl+Shift+I is not ours"); } });
  assert.equal(prevented, true);
  assert.deepEqual(shown, ["assistant", "assistant"]);
  assert.equal(doc.activeElement, host.querySelector("#assistantInput"));
  panel.dispose();
});

test("Ollama needs a model; the picker lists pulled models", async () => {
  const { host, panel, server } = mountPanel();
  await panel.ready;
  const select = host.querySelector("#assistantProvider");
  assert.equal(select.children.find(option => option.value === "claude").disabled, true, "missing tools are listed but disabled");
  select.value = "ollama";
  select.dispatch("change");
  const models = host.querySelector("#assistantModel");
  assert.equal(models.hidden, false);
  models.value = "small:latest";
  await panel.send("ask", "hello");
  const [provider, model, runs] = server.state.started[0].split("\n");
  assert.deepEqual([provider, model, runs], ["ollama", "small:latest", "1"]);
  panel.dispose();
});
