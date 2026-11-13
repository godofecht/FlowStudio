/* The Assistant: the user's own AI command line tool (Claude Code, Codex or
 * a local Ollama model) working on Flow inside FlowStudio.
 *
 * The server starts one job per prompt (src/assistant_session.c) and this
 * file polls it, parses the stream into text and tool lines, and keeps the
 * editor snapshot fresh so the MCP tool flowstudio_editor_state can read
 * it. Edit proposals from flowstudio_propose_edit arrive by polling and
 * open as a Monaco diff with Accept and Reject. Nothing is written to a file
 * without the user accepting it.
 */
(function (root) {
"use strict";

const LIMITS = Object.freeze({ active: 60000, other: 20000, total: 120000, console: 6000, history: 2000 });
const PROVIDER_KEY = "flowstudio.assistant.provider";
const MODEL_KEY = "flowstudio.assistant.model";
const RUNS_KEY = "flowstudio.assistant.runs";

/* ---------- prompts ---------- */
const ACTIONS = Object.freeze({
  ask: { label: "Ask", needs: null },
  explain: { label: "Explain selection", needs: "selection",
    request: "Explain what the selected code does, step by step, in plain words." },
  fix: { label: "Fix errors", needs: "diagnostics",
    request: "Fix the compiler errors in the active file. Check the fixed program, then propose the change with flowstudio_propose_edit." },
  translate: { label: "Translate to Flow", needs: "selection",
    request: "Translate the selected code into Flow. Keep the numerical meaning the same. Check the Flow program and fix it until it passes." },
  test: { label: "Write a Flow test", needs: "code",
    request: "Write a Flow program that tests the code in the active file: call its functions with known inputs, compare against expected values, print PASS or FAIL for each case and return 1 from main if any case fails. Check and run it until it passes." }
});

function fenceFor(language, text) {
  const body = String(text || "");
  return "```" + (language || "") + "\n" + body + (body.endsWith("\n") ? "" : "\n") + "```";
}

function languageOfName(name) {
  if (/\.flow$/i.test(name || "")) return "flow";
  if (/\.py$/i.test(name || "")) return "python";
  if (/\.r$/i.test(name || "")) return "r";
  return "";
}

/* The prompt for one job. Tool providers can read more through MCP;
 * Ollama has no tools, so it gets the whole active file. */
function buildPrompt({ action = "ask", request = "", snapshot = null, include = {}, tools = true, history = [] }) {
  const spec = ACTIONS[action] || ACTIONS.ask;
  const parts = [];
  const asked = String(request || "").trim();
  if (history.length) {
    parts.push("Earlier in this conversation:");
    for (const turn of history.slice(-3)) {
      parts.push("User: " + String(turn.user || "").slice(0, LIMITS.history));
      parts.push("Assistant: " + String(turn.assistant || "").slice(0, LIMITS.history));
    }
    parts.push("");
  }
  parts.push("Request: " + (spec.request ? spec.request + (asked ? "\n" + asked : "") : asked));
  const active = snapshot && snapshot.active;
  if (active) {
    parts.push("");
    parts.push("Active file: " + (active.path || active.name) + " (" + (active.language || "text") + ")");
    const selection = snapshot.selection;
    if (include.selection !== false && selection && selection.text) {
      parts.push("Selected lines " + selection.startLine + " to " + selection.endLine + ":");
      parts.push(fenceFor(active.language, selection.text));
    }
    const whole = !tools || action === "fix" || action === "test" ||
      (include.file !== false && (active.text || "").length <= 12000);
    if (include.file !== false && whole && active.text) {
      parts.push("Text of " + (active.path || active.name) + ":");
      parts.push(fenceFor(active.language, active.text.slice(0, tools ? 12000 : LIMITS.active)));
    }
  }
  const diagnostics = snapshot && snapshot.diagnostics;
  if (include.diagnostics !== false && diagnostics && diagnostics.length) {
    parts.push("Compiler errors:");
    for (const item of diagnostics.slice(0, 30))
      parts.push("- line " + item.line + ", column " + item.column + ": " + item.message);
  } else if (include.diagnostics !== false && snapshot && snapshot.diagnosticsText) {
    parts.push("Compiler output:");
    parts.push(fenceFor("text", snapshot.diagnosticsText.slice(0, 4000)));
  }
  if (tools) parts.push("\nUse flowstudio_editor_state for the full editor, and check all Flow code before you show it.");
  return parts.join("\n");
}

/* ---------- the stream ---------- */
function toolShortName(name) {
  return String(name || "").replace(/^mcp__flowstudio__/, "").replace(/^flowstudio_/, "");
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(item => (item && (item.text || "")) || "").join("\n");
  if (content && typeof content === "object") return content.text || JSON.stringify(content);
  return "";
}

/* One compact line per tool call, such as "Checked app.flow: ok". */
function toolSummary(name, input, ok, text) {
  const short = toolShortName(name);
  const args = input || {};
  const target = args.file || args.path || (args.language ? args.language + " code" : "");
  const firstError = String(text || "").split("\n").find(line => /error/i.test(line)) || "";
  const verdict = ok === null || ok === undefined ? "" : ok ? ": ok" : ": " + (firstError.trim().slice(0, 120) || "failed");
  switch (short) {
    case "check_code": return "Checked " + (target || "code") + verdict;
    case "run_code": return "Ran " + (target || "code") + verdict;
    case "editor_state": return "Read the editor" + (ok === false ? verdict : "");
    case "propose_edit": return "Proposed an edit to " + (args.file || "a file") + (ok === false ? verdict : "");
    case "flow_guide": return "Read the Flow guide";
    case "flow_help": return "Looked up " + (args.topic || "the reference");
    case "read_workspace_file": return "Read " + (args.path || "a file") + (ok === false ? verdict : "");
    case "health": return "Checked the FlowStudio server" + verdict;
    default: return "Used " + short + verdict;
  }
}

/* Turns provider output lines into UI events:
 *   {kind:"text", text, replace}   append (or replace) the current message
 *   {kind:"tool", id, name, input} a tool call started
 *   {kind:"tool-result", id, ok, text}
 *   {kind:"error", text}           {kind:"done", ok}
 */
function createParser(provider) {
  let streamed = false;
  let buffer = "";
  function claudeEvent(event) {
    const out = [];
    if (event.type === "stream_event" && event.event) {
      const inner = event.event;
      if (inner.type === "content_block_delta" && inner.delta && inner.delta.type === "text_delta") {
        streamed = true;
        out.push({ kind: "text", text: inner.delta.text || "" });
      }
      if (inner.type === "message_start") streamed = false;
      return out;
    }
    if (event.type === "assistant" && event.message && Array.isArray(event.message.content)) {
      const text = event.message.content.filter(block => block.type === "text").map(block => block.text || "").join("");
      if (text) out.push({ kind: "text", text, replace: streamed });
      streamed = false;
      for (const block of event.message.content)
        if (block.type === "tool_use") out.push({ kind: "tool", id: block.id, name: block.name, input: block.input || {} });
      return out;
    }
    if (event.type === "user" && event.message && Array.isArray(event.message.content)) {
      for (const block of event.message.content)
        if (block.type === "tool_result")
          out.push({ kind: "tool-result", id: block.tool_use_id, ok: !block.is_error, text: resultText(block.content) });
      return out;
    }
    if (event.type === "result") {
      if (event.is_error) out.push({ kind: "error", text: String(event.result || event.subtype || "The assistant failed.") });
      out.push({ kind: "done", ok: !event.is_error });
    }
    return out;
  }
  function codexEvent(event) {
    const out = [];
    const item = event.item || {};
    if (event.type === "item.completed" && item.type === "agent_message")
      out.push({ kind: "text", text: (item.text || "") + "\n\n" });
    else if ((event.type === "item.started" || event.type === "item.completed") && item.type === "mcp_tool_call") {
      if (event.type === "item.started")
        out.push({ kind: "tool", id: item.id, name: item.tool, input: item.arguments || {} });
      else {
        const failed = item.status === "failed" || Boolean(item.error) || Boolean(item.result && item.result.isError);
        out.push({ kind: "tool-result", id: item.id, ok: !failed,
          text: item.error ? resultText(item.error.message || item.error) : resultText(item.result && item.result.content) });
      }
    } else if (event.type === "item.completed" && item.type === "command_execution")
      out.push({ kind: "tool", id: item.id, name: "command", input: { path: item.command } });
    else if (event.type === "turn.failed" || event.type === "error")
      out.push({ kind: "error", text: String((event.error && event.error.message) || event.message || "Codex failed.") });
    else if (event.type === "turn.completed") out.push({ kind: "done", ok: true });
    return out;
  }
  function line(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    let event;
    try { event = JSON.parse(trimmed); } catch (_) { return [{ kind: "text", text: raw + "\n" }]; }
    return provider === "codex" ? codexEvent(event) : claudeEvent(event);
  }
  return {
    feed(chunk) {
      if (provider === "ollama") return chunk ? [{ kind: "text", text: chunk }] : [];
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      return lines.flatMap(line);
    },
    end() {
      const rest = buffer;
      buffer = "";
      return provider === "ollama" ? [] : line(rest);
    }
  };
}

/* "running\n<out>" or "exit N\n<out>\x1e<stderr>" from /api/assistant/poll. */
function parsePoll(body) {
  const text = String(body || "");
  const newline = text.indexOf("\n");
  const state = newline < 0 ? text : text.slice(0, newline);
  const rest = newline < 0 ? "" : text.slice(newline + 1);
  if (state === "running") return { finished: false, state, output: rest, stderr: "" };
  const split = rest.indexOf("\x1e");
  const output = split < 0 ? rest : rest.slice(0, split);
  const stderr = split < 0 ? "" : rest.slice(split + 1);
  const match = /^exit (-?\d+)$/.exec(state);
  return { finished: true, state, output, stderr, code: match ? Number(match[1]) : null };
}

/* ---------- markdown ---------- */
/* Splits a reply into prose and fenced code. Rendering uses textContent. */
function splitMarkdown(text) {
  const segments = [];
  const pattern = /```([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g;
  let last = 0, match;
  const source = String(text || "");
  while ((match = pattern.exec(source))) {
    if (match.index > last) segments.push({ type: "text", text: source.slice(last, match.index) });
    segments.push({ type: "code", language: (match[1] || "").toLowerCase(), code: match[2], closed: match[0].endsWith("```") && match[0].length >= match[1].length + 7 });
    last = pattern.lastIndex;
    if (match[0].length === 0) break;
  }
  if (last < source.length) segments.push({ type: "text", text: source.slice(last) });
  return segments.filter(segment => segment.type === "code" || segment.text.trim());
}

function inline(doc, parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parent.append(doc.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    const node = doc.createElement(token.startsWith("`") ? "code" : "strong");
    node.textContent = token.startsWith("`") ? token.slice(1, -1) : token.slice(2, -2);
    parent.append(node);
    last = pattern.lastIndex;
  }
  if (last < text.length) parent.append(doc.createTextNode(text.slice(last)));
}

function renderProse(doc, text) {
  const fragment = doc.createDocumentFragment();
  let list = null;
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter(item => item.trim());
    if (!lines.length) continue;
    if (lines.every(item => /^\s*([-*]|\d+\.)\s+/.test(item))) {
      list = doc.createElement(/^\s*\d/.test(lines[0]) ? "ol" : "ul");
      for (const item of lines) {
        const li = doc.createElement("li");
        inline(doc, li, item.replace(/^\s*([-*]|\d+\.)\s+/, ""));
        list.append(li);
      }
      fragment.append(list);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
    const node = doc.createElement(heading ? "h4" : "p");
    inline(doc, node, heading ? heading[2] : lines.join("\n"));
    fragment.append(node);
  }
  return fragment;
}

/* ---------- the editor snapshot ---------- */
/* Compiler lines such as "prog.flow:3:13: error: Undefined variable 'x'". */
function parseDiagnostics(text) {
  const found = [];
  for (const line of String(text || "").split("\n")) {
    const match = /\.flow:(\d+):(\d+):\s*((?:parse )?error|warning):\s*(.*)$/.exec(line);
    if (match) found.push({ line: Number(match[1]), column: Number(match[2]), severity: match[3].includes("warning") ? "warning" : "error", message: match[4].trim() });
  }
  return found;
}

function clip(text, limit) {
  const value = String(text || "");
  return value.length > limit ? value.slice(0, limit) + "\n... (" + (value.length - limit) + " more characters)" : value;
}

/* What the user sees, bounded to fit one request body. */
function collectSnapshot({ app, editor = null, monaco = null, diagnosticsText = "", consoleText = "", proposals = [] }) {
  const docs = app && app.documents ? app.documents.list() : [];
  const current = app && app.documents ? app.documents.active() : null;
  const model = editor && editor.getModel ? editor.getModel() : null;
  const liveText = model ? model.getValue() : null;
  const snapshot = { updated: Date.now(), active: null, cursor: null, selection: null, openFiles: [],
    diagnostics: [], diagnosticsText: "", console: clip(consoleText, LIMITS.console).slice(-LIMITS.console),
    proposals: proposals.slice(-10) };
  let budget = LIMITS.total;
  if (current) {
    const text = liveText !== null ? liveText : String(current.text || "");
    snapshot.active = { name: current.name, path: current.path || null, language: current.language,
      dirty: Boolean(current.dirty), text: clip(text, LIMITS.active) };
    budget -= snapshot.active.text.length;
    if (model && editor.getSelection) {
      const selection = editor.getSelection();
      const position = editor.getPosition ? editor.getPosition() : null;
      if (position) snapshot.cursor = { line: position.lineNumber, column: position.column };
      if (selection && !selection.isEmpty()) {
        const selected = model.getValueInRange(selection);
        snapshot.selection = { text: clip(selected, 20000), startLine: selection.startLineNumber,
          startColumn: selection.startColumn, endLine: selection.endLineNumber, endColumn: selection.endColumn };
        budget -= snapshot.selection.text.length;
      }
    }
    if (model && monaco && monaco.editor && monaco.editor.getModelMarkers) {
      for (const marker of monaco.editor.getModelMarkers({ resource: model.uri }).slice(0, 50))
        snapshot.diagnostics.push({ line: marker.startLineNumber, column: marker.startColumn,
          severity: marker.severity >= 8 ? "error" : "warning", message: String(marker.message || "").slice(0, 400) });
    }
  }
  if (!snapshot.diagnostics.length && diagnosticsText) {
    snapshot.diagnostics = parseDiagnostics(diagnosticsText).slice(0, 50);
    snapshot.diagnosticsText = clip(diagnosticsText, 4000);
  }
  for (const item of docs) {
    const isActive = Boolean(current && item.id === current.id);
    const entry = { name: item.name, path: item.path || null, language: item.language, dirty: Boolean(item.dirty), active: isActive };
    if (!isActive) {
      const text = String(item.text || "");
      if (text.length <= LIMITS.other && text.length < budget) { entry.text = text; budget -= text.length; }
    }
    snapshot.openFiles.push(entry);
  }
  return snapshot;
}

/* ---------- proposals ---------- */
function findDocument(app, file) {
  if (!app || !app.documents) return null;
  const docs = app.documents.list();
  return docs.find(item => item.path === file) || docs.find(item => item.name === file) ||
    docs.find(item => item.path && item.path.endsWith("/" + file)) || null;
}

/* The full text after applying a proposal. cursorLine is 1-based. */
function applyProposal(text, proposal, cursorLine = 1) {
  const content = String(proposal.content || "");
  if (proposal.mode !== "insert") return content;
  const lines = String(text).split("\n");
  const at = Math.max(1, Math.min(Number(proposal.line) || cursorLine || 1, lines.length + 1));
  const insert = content.endsWith("\n") ? content.slice(0, -1) : content;
  lines.splice(at - 1, 0, ...insert.split("\n"));
  return lines.join("\n");
}

/* ---------- the panel ---------- */
function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function mount(doc, options = {}) {
  const host = options.host || doc.getElementById("assistantRoot");
  if (!host) return null;
  const app = () => options.app || root.FlowStudioApp || null;
  const editorApi = () => options.editor || (root.FlowStudioEditor && root.FlowStudioEditor.editor) || null;
  const monaco = () => options.monaco || root.FlowStudioMonaco || null;
  const sidePanel = () => options.sidePanel || root.FlowStudioSidePanel || null;
  const fetcher = options.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
  const later = options.setTimeout || root.setTimeout.bind(root);
  const cancelLater = options.clearTimeout || root.clearTimeout.bind(root);
  const pollMs = options.pollMs || 250;
  const idleProposalMs = options.idleProposalMs || 2000;
  let storage = options.storage;
  if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }
  const remember = (key, value) => { try { if (storage) storage.setItem(key, value); } catch (_) { /* optional */ } };
  const recall = key => { try { return storage ? storage.getItem(key) : null; } catch (_) { return null; } };

  let providers = [];
  let job = null;            // { id, provider, parser, message, tools, timer }
  let history = [];
  let decisions = [];        // proposal ids, files and the user's decision
  let proposalQueue = [];
  let showing = null;
  let lastContext = "";
  let contextTimer = 0, proposalTimer = 0, chipTimer = 0;
  const include = { file: true, selection: true, diagnostics: true };

  /* ---------- layout ---------- */
  host.replaceChildren();
  const bar = make(doc, "div", "as-bar");
  const providerSelect = make(doc, "select", "as-provider");
  providerSelect.id = "assistantProvider";
  providerSelect.setAttribute("aria-label", "Assistant");
  const modelSelect = make(doc, "select", "as-model");
  modelSelect.id = "assistantModel";
  modelSelect.setAttribute("aria-label", "Local model");
  modelSelect.hidden = true;
  const runsLabel = make(doc, "label", "as-runs");
  runsLabel.title = "Let the assistant build and run Flow programs to test them. Runs use your permissions, like pressing Run.";
  const runsBox = make(doc, "input");
  runsBox.type = "checkbox";
  runsBox.id = "assistantRuns";
  runsBox.checked = recall(RUNS_KEY) !== "0";
  runsLabel.append(runsBox, doc.createTextNode("Runs"));
  const clearButton = make(doc, "button", "as-clear", "New chat");
  clearButton.type = "button";
  bar.append(providerSelect, modelSelect, runsLabel, clearButton);

  const thread = make(doc, "div", "as-thread");
  thread.id = "assistantThread";
  thread.setAttribute("role", "log");
  thread.setAttribute("aria-live", "polite");
  const empty = make(doc, "div", "as-empty");
  empty.append(make(doc, "p", "as-empty-title", "Work on Flow with your own AI"));
  empty.append(make(doc, "p", "", "The assistant uses Claude Code, Codex or a local Ollama model from this machine, with your own login. It reads the Flow guide and checks code with the Flow compiler before it shows it. Edits arrive as diffs for you to accept."));
  thread.append(empty);

  const composer = make(doc, "div", "as-composer");
  const chips = make(doc, "div", "as-chips");
  chips.setAttribute("aria-label", "Context sent with the request");
  const chipFile = make(doc, "button", "as-chip");
  const chipSelection = make(doc, "button", "as-chip");
  const chipErrors = make(doc, "button", "as-chip");
  for (const [chip, key] of [[chipFile, "file"], [chipSelection, "selection"], [chipErrors, "diagnostics"]]) {
    chip.type = "button";
    chip.dataset.key = key;
    chip.addEventListener("click", () => { include[key] = !include[key]; renderChips(); });
    chips.append(chip);
  }
  const actions = make(doc, "div", "as-actions");
  for (const name of ["explain", "fix", "translate", "test"]) {
    const button = make(doc, "button", "as-action", ACTIONS[name].label);
    button.type = "button";
    button.dataset.action = name;
    button.addEventListener("click", () => void send(name, input.value));
    actions.append(button);
  }
  const row = make(doc, "div", "as-input-row");
  const input = make(doc, "textarea", "as-input");
  input.id = "assistantInput";
  input.rows = 3;
  input.placeholder = "Ask about Flow, or describe a change. Enter sends.";
  input.setAttribute("aria-label", "Message to the assistant");
  const sendButton = make(doc, "button", "as-send primary", "Ask");
  sendButton.type = "button";
  sendButton.id = "assistantSend";
  const stopButton = make(doc, "button", "as-stop", "Stop");
  stopButton.type = "button";
  stopButton.id = "assistantStop";
  stopButton.hidden = true;
  row.append(input, sendButton, stopButton);
  const note = make(doc, "p", "as-note");
  note.id = "assistantStatus";
  note.setAttribute("role", "status");
  composer.append(chips, actions, row, note);
  host.append(bar, thread, composer);

  /* ---------- server calls ---------- */
  async function api(path, body = "") {
    if (!fetcher) throw new Error("This page cannot reach the FlowStudio server.");
    const response = await fetcher(path, { method: "POST", headers: { "X-FlowStudio-Intent": "run" }, body });
    return { status: response.status, text: await response.text() };
  }
  function setNote(text) { note.textContent = text || ""; }

  async function loadProviders() {
    try {
      const reply = await api("/api/assistant/providers");
      if (reply.status !== 200) throw new Error(reply.text);
      providers = JSON.parse(reply.text).providers || [];
    } catch (error) {
      providers = [];
      setNote("Could not list assistants: " + (error.message || error));
    }
    providerSelect.replaceChildren();
    for (const item of providers) {
      const option = make(doc, "option", "", item.name + (item.available ? "" : " (not installed)"));
      option.value = item.id;
      option.disabled = !item.available;
      providerSelect.append(option);
    }
    const saved = recall(PROVIDER_KEY);
    const usable = providers.filter(item => item.available);
    // A tool that can check code beats a bare local model.
    const pick = usable.find(item => item.id === saved) || usable.find(item => item.tools) || usable[0];
    if (pick) providerSelect.value = pick.id;
    if (!usable.length && providers.length) setNote("No assistant is installed. Install Claude Code, Codex or Ollama, then reopen this panel.");
    syncModels();
    return providers;
  }
  function currentProvider() { return providers.find(item => item.id === providerSelect.value) || null; }
  function syncModels() {
    const provider = currentProvider();
    const models = provider && provider.id === "ollama" ? provider.models || [] : [];
    modelSelect.hidden = !models.length;
    modelSelect.replaceChildren(...models.map(name => { const option = make(doc, "option", "", name); option.value = name; return option; }));
    const saved = recall(MODEL_KEY);
    if (models.includes(saved)) modelSelect.value = saved;
    runsLabel.hidden = Boolean(provider && !provider.tools);
  }
  providerSelect.addEventListener("change", () => { remember(PROVIDER_KEY, providerSelect.value); syncModels(); });
  modelSelect.addEventListener("change", () => remember(MODEL_KEY, modelSelect.value));
  runsBox.addEventListener("change", () => remember(RUNS_KEY, runsBox.checked ? "1" : "0"));

  /* ---------- context ---------- */
  function snapshot() {
    const diagnosticsNode = doc.getElementById("flowDiagnostics");
    const consoleNode = doc.getElementById("console");
    return collectSnapshot({ app: app(), editor: editorApi(), monaco: monaco(),
      diagnosticsText: diagnosticsNode && !diagnosticsNode.hidden ? diagnosticsNode.textContent : "",
      consoleText: consoleNode ? consoleNode.textContent : "", proposals: decisions });
  }
  async function pushContext(force = false) {
    const current = snapshot();
    const body = JSON.stringify({ ...current, updated: 0 });
    if (!force && body === lastContext) return current;
    lastContext = body;
    try { await api("/api/assistant/context", JSON.stringify(current)); } catch (_) { /* the next push retries */ }
    return current;
  }
  function scheduleContext(delay = 800) {
    if (contextTimer) cancelLater(contextTimer);
    contextTimer = later(() => { contextTimer = 0; void pushContext(); renderChips(); }, delay);
  }
  function renderChips() {
    const current = snapshot();
    const active = current.active;
    chipFile.hidden = !active;
    chipFile.textContent = active ? active.name : "";
    chipFile.title = active ? "Send " + (active.path || active.name) + " with the request" : "";
    const lines = current.selection ? current.selection.endLine - current.selection.startLine + 1 : 0;
    chipSelection.hidden = !lines;
    chipSelection.textContent = lines === 1 ? "Selection, 1 line" : "Selection, " + lines + " lines";
    const errors = current.diagnostics.length || (current.diagnosticsText ? 1 : 0);
    chipErrors.hidden = !errors;
    chipErrors.textContent = errors === 1 ? "1 error" : errors + " errors";
    for (const chip of [chipFile, chipSelection, chipErrors]) chip.setAttribute("aria-pressed", include[chip.dataset.key] ? "true" : "false");
    return current;
  }
  function scheduleChips() {
    if (chipTimer) cancelLater(chipTimer);
    chipTimer = later(() => { chipTimer = 0; renderChips(); scheduleContext(); }, 300);
  }

  /* ---------- the thread ---------- */
  function scrollDown() { thread.scrollTop = thread.scrollHeight; }
  function addUser(text) {
    empty.hidden = true;
    const node = make(doc, "div", "as-msg as-user");
    node.textContent = text;
    thread.append(node);
    scrollDown();
  }
  function addAssistant() {
    empty.hidden = true;
    const node = make(doc, "div", "as-msg as-assistant");
    thread.append(node);
    return { node, text: "", body: null };
  }
  function renderMessage(message) {
    if (!message.body) { message.body = make(doc, "div", "as-body"); message.node.append(message.body); }
    message.body.replaceChildren();
    for (const segment of splitMarkdown(message.text)) {
      if (segment.type === "text") message.body.append(renderProse(doc, segment.text));
      else message.body.append(codeBlock(segment));
    }
    scrollDown();
  }
  function addTool(message, event) {
    const line = make(doc, "div", "as-tool");
    line.dataset.state = "running";
    line.dataset.tool = toolShortName(event.name);
    line.textContent = toolSummary(event.name, event.input, null, "") + "...";
    message.node.append(line);
    message.body = null;   // text after a tool call starts a new block
    message.text = "";
    scrollDown();
    return line;
  }
  function codeBlock(segment) {
    const wrap = make(doc, "div", "as-code");
    const pre = make(doc, "pre");
    const code = make(doc, "code", "", segment.code);
    if (segment.language) code.dataset.language = segment.language;
    pre.append(code);
    const tools = make(doc, "div", "as-code-actions");
    const output = make(doc, "pre", "as-run-output");
    output.hidden = true;
    const button = (label, handler) => {
      const node = make(doc, "button", "", label);
      node.type = "button";
      node.addEventListener("click", handler);
      tools.append(node);
    };
    button("Insert at cursor", () => insertCode(segment.code, false));
    button("Replace selection", () => insertCode(segment.code, true));
    const language = segment.language === "py" ? "python" : segment.language;
    if (["flow", "python", "r"].includes(language) && segment.closed !== false)
      button("Run", () => void runCode(language, segment.code, output));
    wrap.append(tools, pre, output);
    return wrap;
  }
  function insertCode(code, replace) {
    const editor = editorApi();
    const model = editor && editor.getModel ? editor.getModel() : null;
    if (!model) { setNote("Open a file first."); return false; }
    const selection = editor.getSelection();
    const range = replace ? selection : { startLineNumber: selection.startLineNumber, startColumn: selection.startColumn,
      endLineNumber: selection.startLineNumber, endColumn: selection.startColumn };
    editor.pushUndoStop();
    editor.executeEdits("flowstudio-assistant", [{ range, text: code, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    if (editor.focus) editor.focus();
    setNote(replace ? "Replaced the selection." : "Inserted at the cursor.");
    return true;
  }
  async function runCode(language, code, output) {
    output.hidden = false;
    output.textContent = "Running...";
    try {
      const reply = await api("/api/run/" + language, code);
      output.textContent = reply.text.trim() || "(no output)";
      output.dataset.state = reply.status === 200 ? "ok" : "error";
    } catch (error) {
      output.textContent = error.message || String(error);
      output.dataset.state = "error";
    }
  }

  /* ---------- jobs ---------- */
  function setBusy(busy) {
    sendButton.hidden = busy;
    stopButton.hidden = !busy;
    providerSelect.disabled = busy;
    for (const button of actions.querySelectorAll("button")) button.disabled = busy;
  }
  function apply(events) {
    const message = job.message;
    for (const event of events) {
      if (event.kind === "text") {
        message.text = event.replace ? event.text : message.text + event.text;
        job.answer = event.replace ? job.answer.slice(0, job.answer.length - job.streamed.length) + event.text : job.answer + event.text;
        job.streamed = event.replace ? "" : job.streamed + event.text;
        renderMessage(message);
      } else if (event.kind === "tool") {
        job.streamed = "";
        job.tools.set(event.id, { line: addTool(message, event), event });
      } else if (event.kind === "tool-result") {
        const tool = job.tools.get(event.id);
        if (tool) {
          tool.line.dataset.state = event.ok ? "ok" : "error";
          tool.line.textContent = toolSummary(tool.event.name, tool.event.input, event.ok, event.text);
          tool.line.title = String(event.text || "").slice(0, 2000);
          if (toolShortName(tool.event.name) === "propose_edit") pollProposals(0);
        }
      } else if (event.kind === "error") {
        const line = make(doc, "div", "as-error", event.text);
        message.node.append(line);
      }
    }
  }
  async function send(action = "ask", request = "") {
    if (job) return false;
    const provider = currentProvider();
    if (!provider || !provider.available) { setNote("Choose an installed assistant first."); return false; }
    if (provider.id === "ollama" && !modelSelect.value) { setNote("Pull a model with ollama first."); return false; }
    const spec = ACTIONS[action] || ACTIONS.ask;
    const current = await pushContext(true);
    if (spec.needs === "selection" && !(current.selection && current.selection.text)) { setNote("Select some code first."); return false; }
    if (spec.needs === "diagnostics" && !current.diagnostics.length && !current.diagnosticsText) {
      setNote("No compiler errors are shown. Check the file first (Run, Check Flow).");
      return false;
    }
    if (spec.needs === "code" && !(current.active && current.active.text.trim())) { setNote("Open a file with code first."); return false; }
    if (action === "ask" && !String(request).trim()) { setNote("Type a question first."); return false; }
    const prompt = buildPrompt({ action, request, snapshot: current, include, tools: provider.tools, history });
    addUser(action === "ask" ? request : spec.label + (String(request).trim() ? ": " + request : ""));
    input.value = "";
    const message = addAssistant();
    setBusy(true);
    setNote(provider.name + " is working.");
    let reply;
    try {
      reply = await api("/api/assistant/start", provider.id + "\n" + (provider.id === "ollama" ? modelSelect.value : "") + "\n" +
        (runsBox.checked ? "1" : "0") + "\n" + prompt);
    } catch (error) { reply = { status: 0, text: error.message || String(error) }; }
    if (reply.status !== 200) {
      message.node.append(make(doc, "div", "as-error", reply.text || "The assistant did not start."));
      setBusy(false);
      setNote("");
      return false;
    }
    job = { id: reply.text.trim(), provider: provider.id, parser: createParser(provider.id), message,
      tools: new Map(), answer: "", streamed: "", request: request || spec.label, polls: 0 };
    pollProposals(0);
    job.timer = later(poll, pollMs);
    return job.id;
  }
  async function poll() {
    if (!job) return;
    const current = job;
    let reply;
    try { reply = await api("/api/assistant/poll", current.id); }
    catch (error) { reply = { status: 0, text: "" }; }
    if (job !== current) return;
    if (reply.status !== 200) { finish(current, { state: "lost", output: "", stderr: reply.text }); return; }
    const result = parsePoll(reply.text);
    if (result.output) apply(current.parser.feed(result.output));
    if (++current.polls % 6 === 0) void pushContext();
    if (result.finished) { apply(current.parser.end()); finish(current, result); return; }
    current.timer = later(poll, pollMs);
  }
  function finish(current, result) {
    const message = current.message;
    let state = "";
    if (result.state === "cancelled") state = "Stopped.";
    else if (result.state === "timeout") state = "Stopped after the time limit.";
    else if (result.state === "lost") state = "Lost contact with the job.";
    else if (result.code !== 0) state = "The assistant exited with code " + result.code + ".";
    if (state) {
      const line = make(doc, "div", "as-error", state);
      const detail = String(result.stderr || "").trim();
      if (detail && result.state !== "cancelled") line.title = detail;
      if (detail && result.code) line.textContent = state + " " + detail.split("\n").slice(-3).join(" ").slice(0, 400);
      message.node.append(line);
    }
    if (!message.text.trim() && !current.tools.size && !state) message.node.append(make(doc, "div", "as-error", "No answer came back."));
    history.push({ user: current.request, assistant: current.answer });
    history = history.slice(-6);
    job = null;
    setBusy(false);
    setNote("");
    pollProposals(0);
  }
  async function stop() {
    if (!job) return false;
    setNote("Stopping.");
    try { await api("/api/assistant/cancel", job.id); } catch (_) { /* the poll reports it */ }
    return true;
  }

  /* ---------- proposals ---------- */
  function pollProposals(delay) {
    if (proposalTimer) cancelLater(proposalTimer);
    proposalTimer = later(async () => {
      proposalTimer = 0;
      if (!doc.hidden) {
        try {
          const reply = await api("/api/assistant/proposals");
          if (reply.status === 200) for (const item of JSON.parse(reply.text)) proposalQueue.push(item);
        } catch (_) { /* retried */ }
        if (!showing && proposalQueue.length) showProposal(proposalQueue.shift());
      }
      pollProposals(job ? 700 : idleProposalMs);
    }, delay === undefined ? 2000 : delay);
  }
  function record(item, status) {
    decisions.push({ id: item.id, file: item.proposal.file, status });
    decisions = decisions.slice(-20);
    void pushContext(true);
  }
  function note_(text, kind) {
    const line = make(doc, "div", "as-tool", text);
    line.dataset.state = kind;
    thread.append(line);
    scrollDown();
  }
  let dialog = null, diffEditor = null;
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = make(doc, "dialog", "as-diff-dialog");
    dialog.id = "assistantDiff";
    dialog.setAttribute("aria-label", "Proposed edit");
    const head = make(doc, "div", "as-diff-head");
    const title = make(doc, "h2", "as-diff-title");
    title.id = "assistantDiffTitle";
    const summary = make(doc, "p", "as-diff-summary");
    summary.id = "assistantDiffSummary";
    head.append(title, summary);
    const diffHost = make(doc, "div", "as-diff-host");
    diffHost.id = "assistantDiffHost";
    const buttons = make(doc, "div", "as-diff-actions np-actions");
    const reject = make(doc, "button", "", "Reject");
    reject.type = "button";
    reject.id = "assistantReject";
    const accept = make(doc, "button", "primary", "Accept");
    accept.type = "button";
    accept.id = "assistantAccept";
    buttons.append(reject, accept);
    dialog.append(head, diffHost, buttons);
    (doc.body || host).append(dialog);
    dialog.addEventListener("cancel", event => { event.preventDefault(); decide(false); });
    reject.addEventListener("click", () => decide(false));
    accept.addEventListener("click", () => decide(true));
    return dialog;
  }
  function showProposal(item) {
    const proposal = item && item.proposal;
    if (!proposal || typeof proposal.content !== "string") return;
    const a = app();
    const target = findDocument(a, proposal.file);
    if (!target) { note_("The assistant proposed an edit to " + proposal.file + ", which is not open.", "error"); record(item, "file not open"); return; }
    if (a.activateDocument) a.activateDocument(target.id);
    const editor = editorApi();
    const model = editor && editor.getModel ? editor.getModel() : null;
    const before = model ? model.getValue() : String(target.text || "");
    const cursor = editor && editor.getPosition ? editor.getPosition() : null;
    const after = applyProposal(before, proposal, cursor ? cursor.lineNumber : 1);
    showing = { item, target, before, after };
    const box = ensureDialog();
    box.querySelector("#assistantDiffTitle").textContent = "Proposed edit to " + (target.path || target.name);
    box.querySelector("#assistantDiffSummary").textContent = proposal.summary || (proposal.mode === "insert" ? "Insert lines" : "Replace the file");
    if (typeof box.showModal === "function" && !box.open) box.showModal(); else box.setAttribute("open", "");
    const m = monaco();
    const diffHost = box.querySelector("#assistantDiffHost");
    if (m && m.editor && m.editor.createDiffEditor) {
      if (!diffEditor) diffEditor = m.editor.createDiffEditor(diffHost, { readOnly: true, originalEditable: false,
        automaticLayout: true, theme: "flowstudio", renderSideBySide: true, minimap: { enabled: false }, scrollBeyondLastLine: false });
      const old = diffEditor.getModel && diffEditor.getModel();
      diffEditor.setModel({ original: m.editor.createModel(before, target.language), modified: m.editor.createModel(after, target.language) });
      if (old) { if (old.original) old.original.dispose(); if (old.modified) old.modified.dispose(); }
    } else {
      diffHost.replaceChildren(make(doc, "pre", "as-diff-plain", after));
    }
    note_("Proposed edit to " + (target.path || target.name) + ". Review it in the diff.", "running");
  }
  function decide(accepted) {
    if (!showing) return;
    const { item, target, before, after } = showing;
    showing = null;
    if (dialog) { if (typeof dialog.close === "function" && dialog.open) dialog.close(); else dialog.removeAttribute("open"); }
    let status = accepted ? "accepted" : "rejected";
    if (accepted) {
      const a = app();
      const current = a && a.documents.active();
      const editor = editorApi();
      const model = editor && editor.getModel ? editor.getModel() : null;
      if (!current || current.id !== target.id || !model) status = "failed: the file is no longer active";
      else if (model.getValue() !== before) status = "failed: the file changed while the diff was open";
      else {
        editor.pushUndoStop();
        editor.executeEdits("flowstudio-assistant", [{ range: model.getFullModelRange(), text: after, forceMoveMarkers: true }]);
        editor.pushUndoStop();
      }
    }
    note_((status === "accepted" ? "Accepted the edit to " : status === "rejected" ? "Rejected the edit to " : "Could not apply the edit to ") +
      (target.path || target.name) + (status.startsWith("failed") ? ": " + status.slice(8) : "."), status === "accepted" ? "ok" : "error");
    record(item, status);
    if (proposalQueue.length) showProposal(proposalQueue.shift());
  }

  /* ---------- wiring ---------- */
  sendButton.addEventListener("click", () => void send("ask", input.value));
  stopButton.addEventListener("click", () => void stop());
  clearButton.addEventListener("click", () => {
    if (job) return;
    history = [];
    for (const node of Array.from(thread.children)) if (node !== empty) node.remove();
    empty.hidden = false;
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send("ask", input.value); }
  });
  function open(focus = true) {
    const panel = sidePanel();
    if (panel) panel.show("assistant");
    renderChips();
    if (focus && input.focus) input.focus();
    return true;
  }
  function onKey(event) {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && String(event.key).toLowerCase() === "i") {
      event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      open(true);
    }
  }
  if (options.keyboard !== false) doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("flowstudio:documents", scheduleChips);
  const source = doc.getElementById("source");
  if (source) { source.addEventListener("input", scheduleChips); source.addEventListener("keyup", scheduleChips); }

  const ready = loadProviders().then(() => { renderChips(); void pushContext(true); });
  pollProposals(options.firstProposalPoll === undefined ? 1500 : options.firstProposalPoll);

  return Object.freeze({
    ready, open, send, stop, loadProviders, pushContext, snapshot,
    explain: () => { open(false); return send("explain", ""); },
    fixErrors: () => { open(false); return send("fix", ""); },
    translate: () => { open(false); return send("translate", ""); },
    writeTest: () => { open(false); return send("test", ""); },
    busy: () => Boolean(job),
    decisions: () => decisions.slice(),
    accept: () => decide(true),
    reject: () => decide(false),
    showingProposal: () => (showing ? { file: showing.target.path || showing.target.name, after: showing.after } : null),
    dispose() {
      for (const timer of [contextTimer, proposalTimer, chipTimer, job && job.timer]) if (timer) cancelLater(timer);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("flowstudio:documents", scheduleChips);
    }
  });
}

const api = Object.freeze({ mount, buildPrompt, createParser, parsePoll, splitMarkdown, toolSummary,
  collectSnapshot, applyProposal, parseDiagnostics, findDocument, ACTIONS });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioAssistantModule = api;
if (typeof document !== "undefined" && document.getElementById("assistantRoot")) {
  try { root.FlowStudioAssistant = mount(document, {}); }
  catch (error) { if (root.console) root.console.error("FlowStudio assistant failed to mount: " + (error && error.message)); }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
