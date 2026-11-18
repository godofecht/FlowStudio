/* The Assistant: the user's own AI command line tool (Claude Code, Codex or
 * a local Ollama model) working on Flow inside FlowStudio.
 *
 * The server starts one job per prompt (src/assistant_session.c) and this
 * file polls it, parses the stream into text and tool lines, and keeps the
 * editor snapshot fresh so the MCP tool flowstudio_editor_state can read
 * it. Edit proposals from flowstudio_propose_edit arrive by polling and open
 * as inline diffs in the editor (web/ide_assistant_inline.js), listed under
 * Changes to review. Code blocks have Apply, which turns them into the same
 * inline diff. Nothing is written to a file without the user accepting it.
 *
 * Ctrl+L (Cmd+L) and Ctrl+I open the chat. The current file and selection go
 * with each message as chips the user can remove; @ adds files, the
 * selection or the current error. The chat is kept per project.
 */
(function (root) {
"use strict";

const LIMITS = Object.freeze({ active: 60000, other: 20000, total: 120000, console: 6000, history: 2000 });
const PROVIDER_KEY = "flowstudio.assistant.provider";
const MODEL_KEY = "flowstudio.assistant.model";
const RUNS_KEY = "flowstudio.assistant.runs";
const CHAT_KEY = "flowstudio.assistant.chat.";
const CHAT_TURNS = 40;

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
function buildPrompt({ action = "ask", request = "", snapshot = null, include = {}, tools = true, history = [], attachments = [] }) {
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
  for (const item of attachments) {
    parts.push("");
    parts.push(item.title + ":");
    parts.push(fenceFor(item.language || "", String(item.text || "").slice(0, LIMITS.other)));
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
      if (provider === "ollama") {
        // `ollama run` can draw a spinner with terminal escapes; keep only the text.
        const text = String(chunk || "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\u2800-\u28ff]/g, "");
        return text.trim() || text.includes("\n") ? [{ kind: "text", text }] : [];
      }
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
  const pattern = /```([\w+-]*)([^\n]*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0, match;
  const source = String(text || "");
  while ((match = pattern.exec(source))) {
    if (match.index > last) segments.push({ type: "text", text: source.slice(last, match.index) });
    segments.push({ type: "code", language: (match[1] || "").toLowerCase(), info: (match[1] + match[2]).trim(), code: match[3],
      closed: match[0].endsWith("```") && match[0].length >= match[1].length + match[2].length + 7 });
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

/* Recent error lines from the console, for @error. */
function consoleErrors(text, limit = 12) {
  const lines = String(text || "").split("\n").slice(-200);
  return lines.filter(line => /\b(error|exception|traceback|failed|panic)\b/i.test(line)).slice(-limit).join("\n");
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

const TEXT_FILE = /\.(flow|py|r|md|txt|csv|json|toml|ya?ml|sh|c|h)$/i;

function mount(doc, options = {}) {
  const host = options.host || doc.getElementById("assistantRoot");
  if (!host) return null;
  const app = () => options.app || root.FlowStudioApp || null;
  const editorApi = () => options.editor || (root.FlowStudioEditor && root.FlowStudioEditor.editor) || null;
  const monaco = () => options.monaco || root.FlowStudioMonaco || null;
  const sidePanel = () => options.sidePanel || root.FlowStudioSidePanel || null;
  const inline = () => options.inline || root.FlowStudioInlineEdit || null;
  const diffModel = () => options.diff || root.FlowStudioAssistantDiff || null;
  const fetcher = options.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
  const later = options.setTimeout || root.setTimeout.bind(root);
  const cancelLater = options.clearTimeout || root.clearTimeout.bind(root);
  const pollMs = options.pollMs || 100;
  const idleProposalMs = options.idleProposalMs || 2000;
  const mac = /Mac|iPhone|iPad/.test((root.navigator && (root.navigator.platform || root.navigator.userAgent)) || "");
  let storage = options.storage;
  if (storage === undefined) { try { storage = root.localStorage; } catch (_) { storage = null; } }
  const remember = (key, value) => { try { if (storage) storage.setItem(key, value); } catch (_) { /* optional */ } };
  const recall = key => { try { return storage ? storage.getItem(key) : null; } catch (_) { return null; } };

  let providers = [];
  let serverInfo = null;   // { mcpServer, url } for project agent files
  let job = null;            // { id, provider, parser, message, tools, timer }
  let history = [];
  let transcript = [];       // what the thread shows, kept per project
  let projectKey = "";
  let decisions = [];        // proposal ids, files and the user's decision
  let proposalQueue = [];
  let lastContext = "";
  let contextTimer = 0, proposalTimer = 0, chipTimer = 0;
  // The current file, selection and errors go with each message unless the
  // user removes their chip. Removing lasts for one message.
  const include = { file: true, selection: true, diagnostics: true };
  let mentions = [];         // { kind: "file", name, path, id?, handle? } | { kind: "selection" } | { kind: "error" }
  const colorCache = new Map();

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
  clearButton.id = "assistantNewChat";
  bar.append(providerSelect, modelSelect, runsLabel, clearButton);

  const thread = make(doc, "div", "as-thread");
  thread.id = "assistantThread";
  thread.setAttribute("role", "log");
  thread.setAttribute("aria-live", "polite");
  const empty = make(doc, "div", "as-empty");
  empty.append(make(doc, "p", "as-empty-title", "Work on Flow with your own AI"));
  empty.append(make(doc, "p", "", "The assistant uses Claude Code, Codex or a local Ollama model from this machine, with your own login. It reads the Flow guide and checks code with the Flow compiler before it shows it. Edits arrive as diffs in the editor for you to accept."));
  const keys = make(doc, "ul", "as-empty-keys");
  for (const [combo, what] of [[(mac ? "⌘" : "Ctrl+") + "K", "edit code in place"], [(mac ? "⌘" : "Ctrl+") + "L", "open this chat"], ["@", "add a file, the selection or the error"]]) {
    const item = make(doc, "li");
    item.append(make(doc, "kbd", "", combo), doc.createTextNode(" " + what));
    keys.append(item);
  }
  empty.append(keys);
  thread.append(empty);

  const review = make(doc, "div", "as-review");
  review.id = "assistantReview";
  review.hidden = true;
  review.setAttribute("aria-label", "Changes to review");

  const composer = make(doc, "div", "as-composer");
  const chips = make(doc, "div", "as-chips");
  chips.id = "assistantChips";
  chips.setAttribute("aria-label", "Context sent with the message");
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
  input.placeholder = "Ask about Flow, or describe a change. @ adds context. Enter sends.";
  input.setAttribute("aria-label", "Message to the assistant");
  input.setAttribute("aria-autocomplete", "list");
  const sendButton = make(doc, "button", "as-send primary", "Ask");
  sendButton.type = "button";
  sendButton.id = "assistantSend";
  const stopButton = make(doc, "button", "as-stop", "Stop");
  stopButton.type = "button";
  stopButton.id = "assistantStop";
  stopButton.hidden = true;
  row.append(input, sendButton, stopButton);
  const menu = make(doc, "div", "as-mention-menu");
  menu.id = "assistantMentions";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  const note = make(doc, "p", "as-note");
  note.id = "assistantStatus";
  note.setAttribute("role", "status");
  composer.append(menu, chips, actions, row, note);
  host.append(bar, thread, review, composer);

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
      const listing = JSON.parse(reply.text);
      providers = listing.providers || [];
      serverInfo = listing.mcpServer ? { mcpServer: listing.mcpServer, url: listing.url } : null;
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
  function startBody(provider, prompt) {
    return provider.id + "\n" + (provider.id === "ollama" ? modelSelect.value : "") + "\n" + (runsBox.checked ? "1" : "0") + "\n" + prompt;
  }

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
  function errorCount(current) {
    return current.diagnostics.length || (current.diagnosticsText ? 1 : 0) || (consoleErrors(current.console) ? 1 : 0);
  }
  function chip(label, title, key, onRemove) {
    const node = make(doc, "span", "as-chip");
    node.dataset.key = key;
    node.title = title;
    node.append(make(doc, "span", "as-chip-label", label));
    const remove = make(doc, "button", "as-chip-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + label);
    remove.addEventListener("click", () => { onRemove(); renderChips(); input.focus(); });
    node.append(remove);
    chips.append(node);
    return node;
  }
  function renderChips() {
    const current = snapshot();
    const active = current.active;
    chips.replaceChildren();
    const mentioned = kind => mentions.some(item => item.kind === kind);
    if (active && include.file)
      chip(active.name, "Sends " + (active.path || active.name) + " with the message", "file", () => { include.file = false; });
    const lines = current.selection ? current.selection.endLine - current.selection.startLine + 1 : 0;
    if (lines && (include.selection || mentioned("selection")))
      chip(lines === 1 ? "Selection, 1 line" : "Selection, " + lines + " lines", "Lines " + current.selection.startLine + " to " + current.selection.endLine,
        "selection", () => { include.selection = false; mentions = mentions.filter(item => item.kind !== "selection"); });
    const errors = errorCount(current);
    if (errors && (include.diagnostics || mentioned("error")))
      chip(current.diagnostics.length > 1 ? current.diagnostics.length + " errors" : "Current error", "Compiler and console errors",
        "diagnostics", () => { include.diagnostics = false; mentions = mentions.filter(item => item.kind !== "error"); });
    for (const item of mentions.filter(entry => entry.kind === "file"))
      chip(item.name, "Sends " + (item.path || item.name) + " with the message", "mention", () => { mentions = mentions.filter(entry => entry !== item); });
    const add = make(doc, "button", "as-chip-add", "@");
    add.type = "button";
    add.title = "Add context";
    add.setAttribute("aria-label", "Add context");
    add.addEventListener("click", () => {
      const at = input.selectionStart === undefined ? input.value.length : input.selectionStart;
      const before = input.value.slice(0, at);
      input.value = before + (before && !/\s$/.test(before) ? " @" : "@") + input.value.slice(at);
      input.focus();
      updateMenu();
    });
    chips.append(add);
    return current;
  }
  function scheduleChips() {
    if (chipTimer) cancelLater(chipTimer);
    chipTimer = later(() => { chipTimer = 0; renderChips(); scheduleContext(); }, 300);
  }

  /* ---------- @ mentions ---------- */
  let menuItems = [], menuIndex = 0, workspaceFiles = null, workspaceRoot = null;
  async function listWorkspace() {
    const explorer = root.FlowStudioWorkspaceExplorer;
    const handle = explorer && explorer.root ? explorer.root() : null;
    if (!handle || typeof handle.entries !== "function") { workspaceFiles = []; workspaceRoot = null; return workspaceFiles; }
    if (workspaceRoot === handle && workspaceFiles) return workspaceFiles;
    workspaceFiles = [];
    workspaceRoot = handle;
    const found = [];
    async function walk(dir, prefix, depth) {
      for await (const [name, entry] of dir.entries()) {
        if (found.length >= 400) return;
        if (name.startsWith(".") || name === "node_modules" || name === "build") continue;
        if (entry.kind === "directory" && depth < 4) await walk(entry, prefix + name + "/", depth + 1);
        else if (entry.kind === "file" && TEXT_FILE.test(name)) found.push({ name, path: (explorer.rootName ? explorer.rootName() + "/" : "") + prefix + name, handle: entry });
      }
    }
    try { await walk(handle, "", 0); } catch (_) { /* permission or a removed folder */ }
    workspaceFiles = found;
    return found;
  }
  function mentionQuery() {
    const at = input.selectionStart === undefined ? input.value.length : input.selectionStart;
    const match = /(^|\s)@([\w./-]*)$/.exec(input.value.slice(0, at));
    return match ? { query: match[2].toLowerCase(), from: at - match[2].length - 1, to: at } : null;
  }
  function candidates(query) {
    const current = snapshot();
    const items = [];
    if (current.selection) items.push({ kind: "selection", label: "Selection", detail: "lines " + current.selection.startLine + " to " + current.selection.endLine });
    if (errorCount(current)) items.push({ kind: "error", label: "Current error", detail: current.diagnostics.length ? "line " + current.diagnostics[0].line : "console" });
    const a = app();
    const seen = new Set();
    for (const item of a && a.documents ? a.documents.list() : []) {
      seen.add(item.path || item.name);
      items.push({ kind: "file", label: item.name, detail: item.path || "open", name: item.name, path: item.path || null, id: item.id });
    }
    for (const item of workspaceFiles || []) if (!seen.has(item.path))
      items.push({ kind: "file", label: item.name, detail: item.path, name: item.name, path: item.path, handle: item.handle });
    return items.filter(item => !query || item.label.toLowerCase().includes(query) || String(item.detail).toLowerCase().includes(query)).slice(0, 12);
  }
  function updateMenu() {
    const found = mentionQuery();
    if (!found) { closeMenu(); return; }
    if (workspaceFiles === null) void listWorkspace().then(found => { if (found.length && !menu.hidden) updateMenu(); });
    menuItems = candidates(found.query);
    menuIndex = Math.min(menuIndex, Math.max(0, menuItems.length - 1));
    menu.replaceChildren();
    if (!menuItems.length) { menu.append(make(doc, "div", "as-mention-empty", "Nothing matches")); }
    menuItems.forEach((item, index) => {
      const option = make(doc, "div", "as-mention");
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", index === menuIndex ? "true" : "false");
      option.append(make(doc, "span", "as-mention-label", item.label), make(doc, "span", "as-mention-detail", item.detail));
      option.addEventListener("mousedown", event => { event.preventDefault(); pick(index); });
      menu.append(option);
    });
    menu.hidden = false;
  }
  function closeMenu() { menu.hidden = true; menuItems = []; menuIndex = 0; }
  function pick(index) {
    const item = menuItems[index];
    const found = mentionQuery();
    if (!item || !found) { closeMenu(); return; }
    input.value = input.value.slice(0, found.from) + input.value.slice(found.to);
    if (input.setSelectionRange) input.setSelectionRange(found.from, found.from);
    if (item.kind === "selection") include.selection = true;
    if (item.kind === "error") include.diagnostics = true;
    if (!mentions.some(entry => entry.kind === item.kind && (entry.kind !== "file" || entry.path === item.path && entry.name === item.name)))
      mentions.push(item.kind === "file" ? { kind: "file", name: item.name, path: item.path, id: item.id, handle: item.handle } : { kind: item.kind });
    closeMenu();
    renderChips();
    input.focus();
  }
  async function attachmentsFor(current) {
    const out = [];
    const a = app();
    for (const item of mentions) {
      if (item.kind !== "file") continue;
      const open = a && a.documents ? a.documents.list().find(entry => entry.id === item.id || (item.path && entry.path === item.path)) : null;
      if (current.active && open && current.active.name === open.name && (current.active.path || null) === (open.path || null) && include.file) continue;
      let text = open ? String(open.text || "") : "";
      if (!open && item.handle) { try { text = await (await item.handle.getFile()).text(); } catch (_) { text = ""; } }
      out.push({ title: "File " + (item.path || item.name), language: languageOfName(item.name), text });
    }
    const errorsWanted = include.diagnostics || mentions.some(item => item.kind === "error");
    const fromConsole = errorsWanted ? consoleErrors(current.console) : "";
    if (fromConsole) out.push({ title: "Recent console errors", language: "text", text: fromConsole });
    return out;
  }

  /* ---------- the thread ---------- */
  function scrollDown() {
    // Follow the reply only while the user is at the bottom.
    if (thread.scrollHeight - thread.scrollTop - (thread.clientHeight || 0) < 80 || !thread.clientHeight) thread.scrollTop = thread.scrollHeight;
  }
  function addUser(text, context = []) {
    empty.hidden = true;
    const node = make(doc, "div", "as-msg as-user");
    node.append(make(doc, "div", "as-user-text", text));
    if (context.length) node.append(make(doc, "div", "as-user-context", context.join(" · ")));
    thread.append(node);
    thread.scrollTop = thread.scrollHeight;
    return node;
  }
  function addAssistant() {
    empty.hidden = true;
    const node = make(doc, "div", "as-msg as-assistant");
    node.dataset.state = "thinking";
    const thinking = make(doc, "div", "as-thinking", "Thinking");
    node.append(thinking);
    thread.append(node);
    scrollDown();
    return { node, text: "", body: null, thinking, all: "", tools: [] };
  }
  function renderMessage(message) {
    if (message.thinking) { message.thinking.remove(); message.thinking = null; }
    if (!message.body) { message.body = make(doc, "div", "as-body"); message.node.append(message.body); }
    message.body.replaceChildren();
    for (const segment of splitMarkdown(message.text)) {
      if (segment.type === "text") message.body.append(renderProse(doc, segment.text));
      else message.body.append(codeBlock(segment, message));
    }
    scrollDown();
  }
  function addTool(message, event) {
    if (message.thinking) { message.thinking.remove(); message.thinking = null; }
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
  function highlight(node, code, language) {
    const m = monaco();
    const id = language === "py" ? "python" : language;
    if (!id || !m || !m.editor || typeof m.editor.colorize !== "function") return;
    const key = id + "\u0000" + code;
    if (colorCache.has(key)) { node.innerHTML = colorCache.get(key); return; }
    m.editor.colorize(code.replace(/\n$/, ""), id, { tabSize: 4 }).then(html => {
      if (colorCache.size > 200) colorCache.clear();
      colorCache.set(key, html);
      if (node.isConnected !== false) node.innerHTML = html;
    }, () => {});
  }
  function codeBlock(segment, message) {
    const wrap = make(doc, "div", "as-code");
    const pre = make(doc, "pre");
    const code = make(doc, "code", "", segment.code);
    if (segment.language) code.dataset.language = segment.language;
    if (segment.closed !== false) highlight(code, segment.code, segment.language);
    pre.append(code);
    const tools = make(doc, "div", "as-code-actions");
    const label = make(doc, "span", "as-code-lang", (diffModel() && diffModel().fenceFile(segment.info)) || segment.language || "text");
    tools.append(label);
    const output = make(doc, "pre", "as-run-output");
    output.hidden = true;
    const button = (text, title, handler) => {
      const node = make(doc, "button", "", text);
      node.type = "button";
      node.title = title;
      node.addEventListener("click", handler);
      tools.append(node);
      return node;
    };
    const ready = segment.closed !== false;
    const applyButton = button("Apply", "Show this code as a diff in the editor", () => applyCode(segment, message));
    applyButton.className = "as-apply";
    applyButton.disabled = !ready;
    const copyButton = button("Copy", "Copy to the clipboard", () => void copyCode(segment.code, copyButton));
    copyButton.className = "as-copy";
    button("Insert", "Insert at the cursor", () => insertCode(segment.code, false));
    const language = segment.language === "py" ? "python" : segment.language;
    if (["flow", "python", "r"].includes(language) && ready)
      button("Run", "Run this code on the local server", () => void runCode(language, segment.code, output));
    wrap.append(tools, pre, output);
    return wrap;
  }
  async function copyCode(code, node) {
    const clipboard = root.navigator && root.navigator.clipboard;
    try {
      if (!clipboard) throw new Error("no clipboard");
      await clipboard.writeText(code);
      node.textContent = "Copied";
    } catch (_) {
      node.textContent = "Copy failed";
    }
    later(() => { node.textContent = "Copy"; }, 1500);
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
  /* Apply: the code block becomes an inline diff in the file it belongs to. */
  function applyCode(segment, message = {}) {
    const Diff = diffModel();
    const controller = inline();
    const a = app();
    if (!Diff || !controller || !a) { setNote("The editor is not ready."); return false; }
    const named = Diff.fenceFile(segment.info);
    const docs = a.documents.list();
    const target = (named && findDocument(a, named)) ||
      (message.documentId && docs.find(item => item.id === message.documentId)) || a.documents.active();
    if (!target) { setNote("Open the file to apply this to."); return false; }
    if (named && !findDocument(a, named)) setNote(named + " is not open. Applying to " + target.name + ".");
    if (a.documents.active() !== target && a.activateDocument) a.activateDocument(target.id);
    const editor = editorApi();
    const position = editor && editor.getPosition ? editor.getPosition() : null;
    const selection = message.selection && message.documentId === target.id ? message.selection : null;
    const plan = before => Diff.planApply(before, segment.code, { language: target.language, selection, cursorLine: position ? position.lineNumber : null });
    const model = editor && editor.getModel ? editor.getModel() : null;
    const how = plan(model && a.documents.active() === target ? model.getValue() : String(target.text || "")).how;
    const started = controller.propose({ document: target, source: "apply", label: "Apply from chat",
      after: before => plan(before).text,
      onFinish: result => setNote(result.accepted ? "Applied to " + target.name + "." : result.stale ? "The file changed. Apply again." : "") });
    if (started && !started.hunks.length) setNote("The file already has this code.");
    else if (started) setNote({ file: "Replaces the whole file.", definitions: "Replaces the matching definitions.", append: "Adds new definitions at the end.",
      selection: "Replaces the selection it was about.", cursor: "Inserts at the cursor." }[how] + " Review it in the editor.");
    else setNote("Finish the open review in " + target.name + " first. This one waits.");
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

  /* ---------- the chat, kept per project ---------- */
  function keyOfProject() {
    const projects = root.FlowStudioProjects;
    const current = projects && projects.current ? projects.current() : null;
    const explorer = root.FlowStudioWorkspaceExplorer;
    const name = (current && current.name) || (explorer && explorer.rootName ? explorer.rootName() : null);
    return name || "scratch";
  }
  function saveChat() {
    if (!projectKey) return;
    const kept = transcript.slice(-CHAT_TURNS).map(entry => ({ ...entry, text: String(entry.text || "").slice(0, 12000) }));
    remember(CHAT_KEY + projectKey, JSON.stringify(kept));
  }
  function loadChat() {
    if (job) return;
    const key = keyOfProject();
    if (key === projectKey) return;
    projectKey = key;
    for (const node of Array.from(thread.children)) if (node !== empty) node.remove();
    transcript = [];
    history = [];
    try { transcript = JSON.parse(recall(CHAT_KEY + key) || "[]") || []; } catch (_) { transcript = []; }
    if (!Array.isArray(transcript)) transcript = [];
    empty.hidden = transcript.length > 0;
    let pendingUser = null;
    for (const entry of transcript) {
      if (entry.role === "user") { addUser(entry.text, entry.context || []); pendingUser = entry.text; continue; }
      const message = addAssistant();
      message.node.dataset.state = entry.error ? "failed" : "done";
      if (message.thinking) { message.thinking.remove(); message.thinking = null; }
      for (const tool of entry.tools || []) {
        const line = make(doc, "div", "as-tool", tool.text);
        line.dataset.state = tool.state;
        message.node.append(line);
      }
      message.text = entry.text || "";
      if (message.text) renderMessage(message);
      if (entry.error) message.node.append(make(doc, "div", "as-error", entry.error));
      if (pendingUser !== null) { history.push({ user: pendingUser, assistant: entry.text || "" }); pendingUser = null; }
    }
    history = history.slice(-6);
    thread.scrollTop = thread.scrollHeight;
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
    let dirty = false;
    for (const event of events) {
      if (event.kind === "text") {
        message.text = event.replace ? event.text : message.text + event.text;
        job.answer = event.replace ? job.answer.slice(0, job.answer.length - job.streamed.length) + event.text : job.answer + event.text;
        job.streamed = event.replace ? "" : job.streamed + event.text;
        message.node.dataset.state = "writing";
        dirty = true;
      } else if (event.kind === "tool") {
        if (dirty) { renderMessage(message); dirty = false; }
        job.streamed = "";
        job.tools.set(event.id, { line: addTool(message, event), event });
        message.node.dataset.state = "working";
      } else if (event.kind === "tool-result") {
        const tool = job.tools.get(event.id);
        if (tool) {
          tool.line.dataset.state = event.ok ? "ok" : "error";
          tool.line.textContent = toolSummary(tool.event.name, tool.event.input, event.ok, event.text);
          tool.line.title = String(event.text || "").slice(0, 2000);
          if (toolShortName(tool.event.name) === "propose_edit") pollProposals(0);
        }
      } else if (event.kind === "error") {
        if (dirty) { renderMessage(message); dirty = false; }
        job.error = event.text;
        message.node.append(make(doc, "div", "as-error", event.text));
      }
    }
    if (dirty) renderMessage(message);
  }
  async function send(action = "ask", request = "") {
    if (job) return false;
    const provider = currentProvider();
    if (!provider || !provider.available) { setNote("Choose an installed assistant first."); return false; }
    if (provider.id === "ollama" && !modelSelect.value) { setNote("Pull a model with ollama first."); return false; }
    const spec = ACTIONS[action] || ACTIONS.ask;
    closeMenu();
    const current = await pushContext(true);
    if (spec.needs === "selection" && !(current.selection && current.selection.text)) { setNote("Select some code first."); return false; }
    if (spec.needs === "diagnostics" && !current.diagnostics.length && !current.diagnosticsText) {
      setNote("No compiler errors are shown. Check the file first (Run, Check Flow).");
      return false;
    }
    if (spec.needs === "code" && !(current.active && current.active.text.trim())) { setNote("Open a file with code first."); return false; }
    if (action === "ask" && !String(request).trim()) { setNote("Type a question first."); return false; }
    const wanted = { file: include.file, selection: include.selection || mentions.some(item => item.kind === "selection"),
      diagnostics: include.diagnostics || mentions.some(item => item.kind === "error") };
    const attachments = await attachmentsFor(current);
    const prompt = buildPrompt({ action, request, snapshot: current, include: wanted, tools: provider.tools, history, attachments });
    const context = [];
    if (current.active && wanted.file) context.push(current.active.name);
    if (current.selection && wanted.selection) context.push("selection");
    if (wanted.diagnostics && errorCount(current)) context.push("error");
    for (const item of mentions) if (item.kind === "file") context.push(item.name);
    const shown = action === "ask" ? request : spec.label + (String(request).trim() ? ": " + request : "");
    addUser(shown, context);
    transcript.push({ role: "user", text: shown, context });
    input.value = "";
    mentions = [];
    include.file = include.selection = include.diagnostics = true;
    renderChips();
    const message = addAssistant();
    const a = app();
    const activeDoc = a && a.documents ? a.documents.active() : null;
    message.documentId = activeDoc ? activeDoc.id : null;
    message.selection = current.selection && wanted.selection ? { startLine: current.selection.startLine, endLine: current.selection.endLine } : null;
    setBusy(true);
    setNote("");
    let reply;
    try { reply = await api("/api/assistant/start", startBody(provider, prompt)); }
    catch (error) { reply = { status: 0, text: error.message || String(error) }; }
    if (reply.status !== 200) {
      const text = reply.text || "The assistant did not start.";
      message.node.dataset.state = "failed";
      if (message.thinking) { message.thinking.remove(); message.thinking = null; }
      message.node.append(make(doc, "div", "as-error", text));
      transcript.push({ role: "assistant", text: "", tools: [], error: text });
      saveChat();
      setBusy(false);
      return false;
    }
    job = { id: reply.text.trim(), provider: provider.id, parser: createParser(provider.id), message,
      tools: new Map(), answer: "", streamed: "", request: request || spec.label, polls: 0, error: "" };
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
    if (++current.polls % 15 === 0) void pushContext();
    if (result.finished) { apply(current.parser.end()); finish(current, result); return; }
    current.timer = later(poll, pollMs);
  }
  function finish(current, result) {
    const message = current.message;
    if (message.thinking) { message.thinking.remove(); message.thinking = null; }
    let state = "";
    if (result.state === "cancelled") state = "Stopped.";
    else if (result.state === "timeout") state = "Stopped after the time limit.";
    else if (result.state === "lost") state = "Lost contact with the job.";
    else if (result.code !== 0) state = "The assistant exited with code " + result.code + ".";
    let errorText = current.error || "";
    if (state) {
      const line = make(doc, "div", "as-error", state);
      const detail = String(result.stderr || "").trim();
      if (detail && result.state !== "cancelled") line.title = detail;
      if (detail && result.code) line.textContent = state + " " + detail.split("\n").slice(-3).join(" ").slice(0, 400);
      message.node.append(line);
      errorText = line.textContent;
    }
    if (!message.text.trim() && !current.tools.size && !state) {
      message.node.append(make(doc, "div", "as-error", "No answer came back."));
      errorText = "No answer came back.";
    }
    message.node.dataset.state = errorText ? "failed" : "done";
    const tools = Array.from(current.tools.values()).map(tool => ({ text: tool.line.textContent, state: tool.line.dataset.state }));
    transcript.push({ role: "assistant", text: current.answer, tools, error: errorText });
    saveChat();
    history.push({ user: current.request, assistant: current.answer });
    history = history.slice(-6);
    job = null;
    setBusy(false);
    setNote("");
    pollProposals(0);
    if (projectKey !== keyOfProject()) loadChat();
  }
  async function stop() {
    if (!job) return false;
    setNote("Stopping.");
    try { await api("/api/assistant/cancel", job.id); } catch (_) { /* the poll reports it */ }
    return true;
  }

  /* One background job for inline edits: its text goes to the handlers, not
   * the thread. Returns { cancel() } at once. */
  function runJob(prompt, handlers = {}) {
    const control = { id: null, cancelled: false, done: false };
    const done = result => { if (control.done) return; control.done = true; if (handlers.onDone) handlers.onDone(result); };
    control.cancel = () => {
      control.cancelled = true;
      if (control.id) void api("/api/assistant/cancel", control.id).catch(() => {});
      else done({ ok: false, cancelled: true, text: "" });
    };
    const provider = currentProvider();
    if (!provider || !provider.available) {
      later(() => done({ ok: false, error: "Choose an installed assistant in the Assistant panel." }), 0);
      return control;
    }
    if (provider.id === "ollama" && !modelSelect.value) {
      later(() => done({ ok: false, error: "Pull a model with ollama first." }), 0);
      return control;
    }
    (async () => {
      await pushContext(true);
      if (control.cancelled) { done({ ok: false, cancelled: true, text: "" }); return; }
      let reply;
      try { reply = await api("/api/assistant/start", startBody(provider, prompt)); }
      catch (error) { reply = { status: 0, text: error.message || String(error) }; }
      if (reply.status !== 200) { done({ ok: false, error: reply.text || "The assistant did not start." }); return; }
      control.id = reply.text.trim();
      if (control.cancelled) void api("/api/assistant/cancel", control.id).catch(() => {});
      const parser = createParser(provider.id);
      let text = "", streamed = "", error = "";
      const tools = new Map();
      const take = events => {
        let changed = false;
        for (const event of events) {
          if (event.kind === "text") {
            text = event.replace ? text.slice(0, text.length - streamed.length) + event.text : text + event.text;
            streamed = event.replace ? "" : streamed + event.text;
            changed = true;
          } else if (event.kind === "tool") {
            streamed = "";
            tools.set(event.id, event);
            if (handlers.onTool) handlers.onTool(toolSummary(event.name, event.input, null, "") + "...");
          } else if (event.kind === "tool-result") {
            const tool = tools.get(event.id);
            if (tool && handlers.onTool) handlers.onTool(toolSummary(tool.name, tool.input, event.ok, event.text));
          } else if (event.kind === "error") error = event.text;
        }
        if (changed && handlers.onText) handlers.onText(text);
      };
      for (;;) {
        await new Promise(resolve => later(resolve, pollMs));
        let polled;
        try { polled = await api("/api/assistant/poll", control.id); } catch (_) { polled = { status: 0, text: "" }; }
        if (polled.status !== 200) { done({ ok: false, error: "Lost contact with the job.", text }); return; }
        const result = parsePoll(polled.text);
        if (result.output) take(parser.feed(result.output));
        if (result.finished) {
          take(parser.end());
          const cancelled = result.state === "cancelled";
          const failed = cancelled || result.state === "timeout" || result.code !== 0 || Boolean(error);
          const detail = String(result.stderr || "").trim().split("\n").slice(-2).join(" ").slice(0, 300);
          done({ ok: !failed, cancelled, text, error: error || (result.state === "timeout" ? "Stopped after the time limit." :
            result.code ? "The assistant exited with code " + result.code + (detail ? ": " + detail : ".") : "") });
          return;
        }
      }
    })();
    return control;
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
        if (inline()) while (proposalQueue.length) showProposal(proposalQueue.shift());
      }
      pollProposals(job ? 500 : idleProposalMs);
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
  /* A proposal opens as an inline diff in its file. It never switches the
   * tab or moves focus: other files wait in Changes to review. */
  function showProposal(item) {
    const proposal = item && item.proposal;
    if (!proposal || typeof proposal.content !== "string") return;
    const a = app();
    const target = findDocument(a, proposal.file);
    if (!target) { note_("The assistant proposed an edit to " + proposal.file + ", which is not open.", "error"); record(item, "file not open"); return; }
    const editor = editorApi();
    const isActive = a.documents.active() && a.documents.active().id === target.id;
    const cursor = isActive && editor && editor.getPosition ? editor.getPosition() : null;
    const name = target.path || target.name;
    inline().propose({ document: target, source: "proposal", label: proposal.summary || "", proposal: item,
      after: before => applyProposal(before, proposal, cursor ? cursor.lineNumber : 1),
      onFinish: result => {
        let status = "rejected";
        if (result.total === 0) status = "no change";
        else if (result.accepted === result.total) status = "accepted";
        else if (result.accepted) status = "accepted " + result.accepted + " of " + result.total + " changes";
        else if (result.stale) status = "failed: the file changed while the diff was open";
        note_((status.startsWith("accepted") ? "Accepted the edit to " : status === "rejected" ? "Rejected the edit to " :
          status === "no change" ? "The edit matched " : "Could not apply the edit to ") + name +
          (status.startsWith("failed") ? ": " + status.slice(8) : status.startsWith("accepted ") ? ", " + status.slice(9) + "." : "."),
          status.startsWith("accepted") ? "ok" : "error");
        record(item, status);
      } });
    note_("Proposed edit to " + name + (proposal.summary ? ": " + proposal.summary : "") + ". Review it in the editor.", "running");
  }
  function renderReview() {
    const controller = inline();
    const list = controller ? controller.list().filter(item => item.source !== "inline") : [];
    review.replaceChildren();
    review.hidden = !list.length;
    if (!list.length) return;
    const head = make(doc, "div", "as-review-head");
    head.append(make(doc, "span", "", list.length === 1 ? "1 file to review" : list.length + " files to review"));
    if (list.length > 1) {
      const rejectAll = make(doc, "button", "as-review-all", "Reject all");
      rejectAll.type = "button";
      rejectAll.addEventListener("click", () => { for (const item of controller.list()) if (item.source !== "inline") controller.reject(item.id); });
      const acceptAll = make(doc, "button", "as-review-all primary", "Accept all");
      acceptAll.type = "button";
      acceptAll.addEventListener("click", () => { for (const item of controller.list()) if (item.source !== "inline") controller.accept(item.id); });
      head.append(rejectAll, acceptAll);
    }
    review.append(head);
    for (const item of list) {
      const line = make(doc, "div", "as-review-row");
      line.dataset.file = item.file;
      const open = make(doc, "button", "as-review-file", item.file);
      open.type = "button";
      open.title = item.label || "Show the changes in the editor";
      open.addEventListener("click", () => controller.review(item.id));
      const stats = make(doc, "span", "as-review-stats");
      if (item.waiting) stats.textContent = "waiting";
      else stats.append(make(doc, "span", "as-add", "+" + item.added), make(doc, "span", "as-del", " -" + item.removed));
      const reject = make(doc, "button", "as-review-reject", "Reject");
      reject.type = "button";
      reject.addEventListener("click", () => controller.reject(item.id));
      const accept = make(doc, "button", "as-review-accept", "Accept");
      accept.type = "button";
      accept.addEventListener("click", () => controller.accept(item.id));
      line.append(open, stats, reject, accept);
      review.append(line);
    }
  }

  /* ---------- wiring ---------- */
  sendButton.addEventListener("click", () => void send("ask", input.value));
  stopButton.addEventListener("click", () => void stop());
  clearButton.addEventListener("click", () => {
    if (job) return;
    history = [];
    transcript = [];
    saveChat();
    for (const node of Array.from(thread.children)) if (node !== empty) node.remove();
    empty.hidden = false;
    input.focus();
  });
  input.addEventListener("input", updateMenu);
  input.addEventListener("blur", () => later(closeMenu, 100));
  input.addEventListener("keydown", event => {
    if (!menu.hidden && menuItems.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        menuIndex = (menuIndex + (event.key === "ArrowDown" ? 1 : -1) + menuItems.length) % menuItems.length;
        updateMenu();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pick(menuIndex); return; }
    }
    if (!menu.hidden && event.key === "Escape") { event.preventDefault(); if (event.stopPropagation) event.stopPropagation(); closeMenu(); return; }
    if (event.key === "Escape" && job) { event.preventDefault(); void stop(); return; }
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
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    const key = String(event.key).toLowerCase();
    if (key !== "i" && key !== "l") return;
    // In the terminal Ctrl+L clears the screen.
    if (key === "l" && event.ctrlKey && !mac && event.target && typeof event.target.closest === "function" && event.target.closest(".xterm")) return;
    if (key === "l" && mac && !event.metaKey) return;
    event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (key === "l") { include.selection = true; include.file = true; }
    open(true);
  }
  if (options.keyboard !== false) doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("flowstudio:documents", scheduleChips);
  doc.addEventListener("flowstudio:assistant-review", renderReview);
  const onRoot = () => { workspaceFiles = null; later(loadChat, 0); };
  doc.addEventListener("flowstudio:root", onRoot);
  const source = doc.getElementById("source");
  if (source) { source.addEventListener("input", scheduleChips); source.addEventListener("keyup", scheduleChips); }
  let unwatchProjects = null;
  if (root.FlowStudioProjects && root.FlowStudioProjects.onChange) unwatchProjects = root.FlowStudioProjects.onChange(onRoot);

  loadChat();
  const ready = loadProviders().then(() => { renderChips(); void pushContext(true); });
  pollProposals(options.firstProposalPoll === undefined ? 1500 : options.firstProposalPoll);

  return Object.freeze({
    ready, open, send, stop, loadProviders, pushContext, snapshot, runJob, applyCode,
    info: () => (serverInfo ? { ...serverInfo } : null),
    providerHasTools: () => { const provider = currentProvider(); return Boolean(provider && provider.tools); },
    notify: text => setNote(text),
    explain: () => { open(false); return send("explain", ""); },
    fixErrors: () => { open(false); return send("fix", ""); },
    translate: () => { open(false); return send("translate", ""); },
    writeTest: () => { open(false); return send("test", ""); },
    busy: () => Boolean(job),
    decisions: () => decisions.slice(),
    transcript: () => transcript.map(entry => ({ ...entry })),
    dispose() {
      for (const timer of [contextTimer, proposalTimer, chipTimer, job && job.timer]) if (timer) cancelLater(timer);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("flowstudio:documents", scheduleChips);
      doc.removeEventListener("flowstudio:assistant-review", renderReview);
      doc.removeEventListener("flowstudio:root", onRoot);
      if (unwatchProjects) unwatchProjects();
    }
  });
}

const api = Object.freeze({ mount, buildPrompt, createParser, parsePoll, splitMarkdown, toolSummary,
  collectSnapshot, applyProposal, parseDiagnostics, findDocument, consoleErrors, ACTIONS });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioAssistantModule = api;
if (typeof document !== "undefined" && document.getElementById("assistantRoot")) {
  try { root.FlowStudioAssistant = mount(document, {}); }
  catch (error) { if (root.console) root.console.error("FlowStudio assistant failed to mount: " + (error && error.message)); }
}
})(typeof globalThis !== "undefined" ? globalThis : this);
