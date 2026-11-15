/* Inline edits for the Assistant, drawn in the Monaco editor itself.
 *
 *   Ctrl+K (Cmd+K on a Mac) in the editor opens a prompt bar above the
 *   selection or the cursor line. The reply streams in as an inline diff:
 *   removed lines in red, new lines in green below them.
 *   Ctrl+Enter or Tab accepts, Esc rejects, and each change has its own
 *   Accept and Reject. An accept is one edit, so one undo takes it back.
 *
 * The same review drives edits the agent proposes through MCP and code
 * blocks applied from the chat. The model keeps the original text until
 * the user accepts, so nothing changes in a file before that.
 * The diff model lives in web/ide_assistant_diff.js.
 */
(function (root) {
"use strict";

const Diff = root.FlowStudioAssistantDiff ||
  (typeof require === "function" ? require("./ide_assistant_diff.js") : null);
const FIX_COMMAND = "flowstudio.assistant.fixError";
const DRAFT_LIMIT = 40;

function isMac(nav) { return /Mac|iPhone|iPad/.test((nav && (nav.platform || nav.userAgent)) || ""); }

function mount(options = {}) {
  const doc = options.document || root.document;
  const monaco = options.monaco || root.FlowStudioMonaco;
  const host = options.editorHost || root.FlowStudioEditor;
  const editor = options.editor || (host && host.editor);
  const app = () => options.app || root.FlowStudioApp || null;
  const assistant = () => options.assistant || root.FlowStudioAssistant || null;
  if (!doc || !monaco || !editor || !Diff) return null;
  const mac = isMac(root.navigator);
  const modKey = mac ? "⌘" : "Ctrl+";
  const lineHeight = () => editor.getOption(monaco.editor.EditorOption.lineHeight);

  let nextSession = 1;
  const sessions = [];          // review sessions, at most one live per model
  const waiting = [];           // proposals for files without a model yet
  const drafts = new Map();     // prompt bar text per model
  const colorCache = new Map();
  let zoneIds = [], overlays = [];
  let bar = null;               // the Ctrl+K prompt bar
  let renderQueued = false;

  /* ---------- helpers ---------- */
  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, className, title, handler) {
    const node = el("button", className, label);
    node.type = "button";
    if (title) node.title = title;
    node.addEventListener("mousedown", event => event.preventDefault());
    node.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); handler(); });
    return node;
  }
  function emit() {
    try { doc.dispatchEvent(new root.CustomEvent("flowstudio:assistant-review")); } catch (_) { /* old browsers */ }
  }
  function documentFor(model) {
    const id = host && host.documentIdFor ? host.documentIdFor(model) : null;
    const a = app();
    const docs = a && a.documents ? a.documents.list() : [];
    return docs.find(item => item.id === id) || null;
  }
  function modelFor(document) {
    if (!document) return null;
    return (host && host.modelFor && host.modelFor(document.id)) || null;
  }
  function fileName(model) {
    const document = documentFor(model);
    return document ? document.path || document.name : "file";
  }
  function languageOf(model) {
    const id = model.getLanguageId ? model.getLanguageId() : "";
    return id === "plaintext" ? "" : id;
  }
  function sessionFor(model) { return sessions.find(item => item.model === model && item.state !== "done") || null; }
  function activeSession() { return sessionFor(editor.getModel()); }
  function pending(session) { return session.hunks.filter(hunk => hunk.state === "pending"); }

  /* ---------- tracking hunks in the model ---------- */
  function trackRange(model, hunk) {
    const count = model.getLineCount();
    if (hunk.removed.length) {
      const end = Math.min(count, hunk.start + hunk.removed.length - 1);
      return { range: new monaco.Range(hunk.start, 1, end, model.getLineMaxColumn(end)), atEnd: false };
    }
    if (hunk.start <= count) return { range: new monaco.Range(hunk.start, 1, hunk.start, 1), atEnd: false };
    return { range: new monaco.Range(count, model.getLineMaxColumn(count), count, model.getLineMaxColumn(count)), atEnd: true };
  }
  function removedDecoration(hunk, streaming) {
    return hunk.removed.length ? { isWholeLine: true, className: "fs-diff-del" + (streaming ? " fs-diff-streaming" : ""),
      linesDecorationsClassName: "fs-diff-del-gutter", stickiness: 1,
      overviewRuler: { color: "#d9645a99", position: 7 } } : { stickiness: 1 };
  }
  function decorate(session) {
    const model = session.model;
    const live = session.hunks.filter(hunk => hunk.state === "pending");
    const decorations = live.map(hunk => {
      const { range, atEnd } = trackRange(model, hunk);
      hunk.atEnd = atEnd;
      return { range, options: removedDecoration(hunk, session.state === "streaming") };
    });
    const ids = model.deltaDecorations([], decorations);
    live.forEach((hunk, index) => { hunk.decoration = ids[index]; });
  }
  function untrack(session, hunks = session.hunks) {
    const ids = hunks.map(hunk => hunk.decoration).filter(Boolean);
    if (ids.length && !session.model.isDisposed()) session.model.deltaDecorations(ids, []);
    for (const hunk of hunks) hunk.decoration = null;
  }
  /* Where a hunk sits now: { start, end, after } in current lines. */
  function place(session, hunk) {
    const range = hunk.decoration ? session.model.getDecorationRange(hunk.decoration) : null;
    if (!range) return null;
    if (hunk.removed.length) return { start: range.startLineNumber, end: range.endLineNumber, after: range.endLineNumber };
    if (hunk.atEnd) return { start: range.startLineNumber + 1, end: range.startLineNumber, after: range.startLineNumber };
    return { start: range.startLineNumber, end: range.startLineNumber - 1, after: range.startLineNumber - 1 };
  }
  function stale(session, hunk, where) {
    if (!where) return true;
    if (!hunk.removed.length) return false;
    if (where.end - where.start + 1 !== hunk.removed.length) return true;
    for (let i = 0; i < hunk.removed.length; i++)
      if (session.model.getLineContent(where.start + i) !== hunk.removed[i]) return true;
    return false;
  }
  function editFor(model, hunk, where) {
    const count = model.getLineCount();
    const text = hunk.added.join("\n");
    if (hunk.removed.length) {
      const { start, end } = where;
      if (hunk.added.length) return { range: new monaco.Range(start, 1, end, model.getLineMaxColumn(end)), text };
      if (end < count) return { range: new monaco.Range(start, 1, end + 1, 1), text: "" };
      if (start > 1) return { range: new monaco.Range(start - 1, model.getLineMaxColumn(start - 1), end, model.getLineMaxColumn(end)), text: "" };
      return { range: new monaco.Range(1, 1, end, model.getLineMaxColumn(end)), text: "" };
    }
    if (hunk.atEnd) {
      const line = where.after;
      return { range: new monaco.Range(line, model.getLineMaxColumn(line), line, model.getLineMaxColumn(line)), text: "\n" + text };
    }
    return { range: new monaco.Range(where.start, 1, where.start, 1), text: text + "\n" };
  }

  /* One edit for all the hunks: one undo step. */
  function applyEdits(session, hunks) {
    const model = session.model;
    const edits = [];
    const applied = [];
    for (const hunk of hunks) {
      const where = place(session, hunk);
      if (stale(session, hunk, where)) { hunk.state = "stale"; continue; }
      edits.push(editFor(model, hunk, where));
      applied.push(hunk);
    }
    untrack(session, hunks);
    if (!edits.length) return applied;
    for (const edit of edits) edit.forceMoveMarkers = true;
    if (editor.getModel() === model) {
      editor.pushUndoStop();
      editor.executeEdits("flowstudio-assistant", edits);
      editor.pushUndoStop();
    } else {
      model.pushStackElement();
      model.pushEditOperations([], edits, () => null);
      model.pushStackElement();
    }
    for (const hunk of applied) hunk.state = "accepted";
    return applied;
  }

  /* ---------- sessions ---------- */
  function createSession(model, hunks, info) {
    const session = { id: nextSession++, model, file: fileName(model), document: documentFor(model),
      hunks: hunks.map(hunk => ({ ...hunk, state: "pending", decoration: null })),
      state: info.state || "review", source: info.source, label: info.label || "", onFinish: info.onFinish || null,
      proposal: info.proposal || null };
    sessions.push(session);
    decorate(session);
    queueRender();
    emit();
    if (session.state === "review" && !session.hunks.length) finish(session);
    return session;
  }
  function replaceHunks(session, hunks, state) {
    untrack(session);
    session.hunks = hunks.map(hunk => ({ ...hunk, state: "pending", decoration: null }));
    session.state = state;
    decorate(session);
    queueRender();
    emit();
  }
  function finish(session) {
    if (session.state === "done") return;
    untrack(session);
    session.state = "done";
    const count = state => session.hunks.filter(hunk => hunk.state === state).length;
    const result = { accepted: count("accepted"), rejected: count("rejected"), stale: count("stale"), total: session.hunks.length };
    const index = sessions.indexOf(session);
    if (index >= 0) sessions.splice(index, 1);
    queueRender();
    emit();
    if (session.onFinish) { try { session.onFinish(result, session); } catch (_) { /* the caller's problem */ } }
    const next = waiting.findIndex(item => modelFor(item.document) === session.model);
    if (next >= 0) startWaiting(waiting.splice(next, 1)[0]);
    return result;
  }
  function decide(session, hunks, accept) {
    if (!session || session.state !== "review") return false;
    const list = hunks.filter(hunk => hunk.state === "pending");
    if (!list.length) return false;
    if (accept) applyEdits(session, list);
    else { untrack(session, list); for (const hunk of list) hunk.state = "rejected"; }
    if (!pending(session).length) finish(session); else { queueRender(); emit(); }
    return true;
  }
  const acceptAll = (session = activeSession()) => decide(session, session ? session.hunks : [], true);
  const rejectAll = (session = activeSession()) => decide(session, session ? session.hunks : [], false);
  function hunkNear(session, line) {
    const list = pending(session).map(hunk => ({ hunk, where: place(session, hunk) })).filter(item => item.where);
    return (list.find(item => item.where.start <= line && line <= Math.max(item.where.end, item.where.start)) ||
      list.find(item => item.where.start >= line) || list[list.length - 1] || {}).hunk || null;
  }

  /* ---------- drawing ---------- */
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(() => { renderQueued = false; render(); });
  }
  function clearView() {
    if (zoneIds.length) editor.changeViewZones(accessor => { for (const id of zoneIds) accessor.removeZone(id); });
    zoneIds = [];
    for (const widget of overlays) editor.removeOverlayWidget(widget);
    overlays = [];
  }
  function colorized(node, text, language) {
    const key = language + "\u0000" + text;
    if (colorCache.has(key)) { node.innerHTML = colorCache.get(key); return; }
    node.textContent = text;
    if (!language || typeof monaco.editor.colorize !== "function") return;
    monaco.editor.colorize(text, language, { tabSize: 4 }).then(html => {
      if (colorCache.size > 300) colorCache.clear();
      colorCache.set(key, html);
      if (node.isConnected && node.dataset.source === key) node.innerHTML = html;
    }, () => {});
    node.dataset.source = key;
  }
  function overlay(id, node, preference = null) {
    const widget = { getId: () => id, getDomNode: () => node, getPosition: () => (preference === null ? null : { preference }) };
    editor.addOverlayWidget(widget);
    overlays.push(widget);
    return widget;
  }
  function render() {
    clearView();
    const model = editor.getModel();
    const session = model ? sessionFor(model) : null;
    const layout = editor.getLayoutInfo();
    const font = editor.getOption(monaco.editor.EditorOption.fontInfo);
    const height = lineHeight();
    const zones = [];
    if (session) {
      const language = languageOf(model);
      const streaming = session.state === "streaming";
      const live = pending(session);
      live.forEach((hunk, index) => {
        const where = place(session, hunk);
        if (!where) return;
        const zone = el("div", "fs-diff-add" + (streaming ? " fs-diff-streaming" : ""));
        zone.dataset.hunk = String(hunk.id);
        zone.style.fontFamily = font.fontFamily;
        zone.style.fontSize = font.fontSize + "px";
        zone.style.lineHeight = height + "px";
        const code = el("div", "fs-diff-add-code");
        if (hunk.added.length) colorized(code, hunk.added.join("\n"), language);
        zone.append(code);
        const margin = el("div", "fs-diff-add-margin");
        let toolbar = null;
        if (!streaming) {
          toolbar = el("div", "fs-hunk-bar");
          toolbar.dataset.hunk = String(hunk.id);
          toolbar.append(
            button("Reject", "fs-hunk-reject", "Reject this change (Alt+N)", () => decide(session, [hunk], false)),
            button("Accept", "fs-hunk-accept", "Accept this change (Alt+Y)", () => decide(session, [hunk], true)));
          toolbar.style.display = "none";
          overlay("fs.hunk." + session.id + "." + hunk.id + "." + index, toolbar);
        }
        // In a narrow editor the buttons get their own row under the new lines.
        const own = !streaming && layout.contentWidth < 520 && hunk.added.length > 0;
        zones.push({ afterLineNumber: Math.max(0, where.after),
          heightInPx: hunk.added.length ? hunk.added.length * height + (own ? 24 : 0) : (streaming ? 0 : 24),
          domNode: zone, marginDomNode: margin, suppressMouseDown: false, ordinal: 2,
          onDomNodeTop: top => {
            if (!toolbar) return;
            const visible = top > -1000 && top < layout.height;
            toolbar.style.display = visible ? "" : "none";
            toolbar.style.top = Math.max(0, own ? top + hunk.added.length * height + 1 : top - hunk.removed.length * height + 1) + "px";
            toolbar.style.right = (layout.verticalScrollbarWidth + 14) + "px";
          } });
      });
      if (session.state === "review" && !(bar && bar.session === session)) overlay("fs.review.bar", reviewBar(session), 1);
    }
    if (bar && bar.model === model) {
      const width = Math.max(220, Math.min(680, layout.contentWidth - 30));
      const narrow = width < 440;
      bar.node.classList.toggle("fs-inline-narrow", narrow);
      bar.height = narrow ? 78 : 44;
      zones.push({ afterLineNumber: Math.max(0, bar.anchorLine() - 1), heightInPx: bar.height, ordinal: 1, domNode: el("div", "fs-inline-spacer"),
        onDomNodeTop: top => {
          bar.node.style.display = top > -1000 ? "" : "none";
          bar.node.style.top = top + "px";
          bar.node.style.left = layout.contentLeft + "px";
          bar.node.style.width = width + "px";
        } });
    }
    if (zones.length) editor.changeViewZones(accessor => { zoneIds = zones.map(zone => accessor.addZone(zone)); });
  }
  function reviewBar(session) {
    const node = el("div", "fs-review-bar");
    node.setAttribute("role", "toolbar");
    node.setAttribute("aria-label", "Review the Assistant's changes");
    const left = pending(session).length;
    const { added, removed } = Diff.countChanges(pending(session));
    node.append(el("span", "fs-review-label", (left === 1 ? "1 change" : left + " changes") + " to " + session.file));
    const stats = el("span", "fs-review-stats");
    stats.append(el("span", "fs-add", "+" + added), el("span", "fs-del", " -" + removed));
    const rejectKey = session.source === "inline" ? "Esc" : modKey + (mac ? "⇧⌫" : "Shift+Backspace");
    node.append(stats,
      button("Reject all", "fs-review-reject", "Reject all (" + rejectKey + ")", () => rejectAll(session)),
      button("Accept all", "fs-review-accept primary", "Accept all (" + modKey + "Enter)", () => acceptAll(session)));
    const keys = el("span", "fs-review-keys", rejectKey + "  " + modKey + (mac ? "⏎" : "Enter"));
    node.append(keys);
    return node;
  }
  editor.onDidChangeModel(() => {
    if (bar && bar.model !== editor.getModel()) closeBar(false);
    const model = editor.getModel();
    if (model) for (let i = waiting.length - 1; i >= 0; i--)
      if (modelFor(waiting[i].document) === model && !sessionFor(model)) startWaiting(waiting.splice(i, 1)[0]);
    queueRender();
  });
  editor.onDidLayoutChange(() => { if (sessions.length || bar) queueRender(); });

  /* ---------- the Ctrl+K prompt bar ---------- */
  function selectionRegion() {
    const model = editor.getModel();
    const selection = editor.getSelection();
    if (!model || !selection) return null;
    if (!selection.isEmpty()) {
      let end = selection.endLineNumber;
      if (selection.endColumn === 1 && end > selection.startLineNumber) end--;
      return { startLine: selection.startLineNumber, endLine: end };
    }
    const line = selection.positionLineNumber;
    if (!model.getLineContent(line).trim()) return { startLine: line, endLine: line };
    return { startLine: line + 1, endLine: line };
  }
  function openInline({ instruction = null, region = null, error = null, submit = false } = {}) {
    const model = editor.getModel();
    if (!model) return false;
    if (bar && bar.model === model && bar.state !== "idle" && bar.state !== "failed" && !instruction) { bar.input.focus(); return true; }
    if (activeSession() && !(bar && activeSession() === bar.session)) {
      flash("Review the open changes first.");
      return false;
    }
    if (bar) closeBar(false);
    const chosen = region || selectionRegion();
    if (!chosen) return false;
    bar = makeBar(model, chosen, error);
    // The bar stays attached while it is open, so re-drawing never takes its focus.
    bar.widget = { getId: () => "fs.inline.bar", getDomNode: () => bar.node, getPosition: () => null };
    bar.node.style.top = "-10000px";
    editor.addOverlayWidget(bar.widget);
    if (instruction !== null) bar.input.value = instruction;
    else if (drafts.has(model)) bar.input.value = drafts.get(model);
    render();
    bar.input.focus();
    bar.input.select && instruction === null && bar.input.select();
    if (submit) void bar.submit();
    return true;
  }
  function makeBar(model, region, error) {
    const node = el("div", "fs-inline-bar");
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label", "Edit with the Assistant");
    const input = el("textarea", "fs-inline-input");
    input.rows = 1;
    input.id = "assistantInlineInput";
    input.placeholder = region.endLine >= region.startLine ? "Edit the selected code" : "Describe the code to write here";
    input.setAttribute("aria-label", "Instruction for the Assistant");
    const status = el("span", "fs-inline-status");
    status.id = "assistantInlineStatus";
    status.setAttribute("role", "status");
    const actions = el("div", "fs-inline-actions");
    const startLine = region.startLine;
    // The region follows edits made elsewhere while the reply arrives.
    const regionIds = model.deltaDecorations([], [{
      range: region.endLine >= region.startLine
        ? new monaco.Range(region.startLine, 1, region.endLine, model.getLineMaxColumn(region.endLine))
        : startLine <= model.getLineCount() ? new monaco.Range(startLine, 1, startLine, 1)
          : new monaco.Range(model.getLineCount(), model.getLineMaxColumn(model.getLineCount()), model.getLineCount(), model.getLineMaxColumn(model.getLineCount())),
      options: { stickiness: 1, className: region.endLine >= region.startLine ? "fs-inline-region" : undefined, isWholeLine: true } }]);
    const atEnd = region.endLine < region.startLine && startLine > model.getLineCount();
    const original = region.endLine >= region.startLine
      ? Diff.splitLines(model.getValue()).slice(region.startLine - 1, region.endLine) : [];
    const state = { model, node, input, status, actions, height: 44, state: "idle", job: null, session: null,
      original, error, lastInstruction: "", lastCode: "", regionIds };
    state.region = () => {
      const range = model.getDecorationRange(regionIds[0]);
      if (!range) return { startLine, endLine: startLine - 1 };
      if (original.length) return { startLine: range.startLineNumber, endLine: range.endLineNumber };
      return atEnd ? { startLine: range.startLineNumber + 1, endLine: range.startLineNumber } : { startLine: range.startLineNumber, endLine: range.startLineNumber - 1 };
    };
    state.anchorLine = () => state.region().startLine;
    const send = button("Send", "fs-inline-send primary", "Send (Enter)", () => void state.submit());
    const stop = button("Stop", "fs-inline-stop", "Stop (Esc)", () => stopBar());
    const accept = button("Accept", "fs-inline-accept primary", "Accept (" + modKey + "Enter or Tab)", () => acceptBar());
    const reject = button("Reject", "fs-inline-reject", "Reject (Esc)", () => rejectBar());
    const close = button("×", "fs-inline-close", "Close (Esc)", () => closeBar(true));
    close.setAttribute("aria-label", "Close");
    actions.append(send, stop, reject, accept);
    node.append(input, status, actions, close);
    state.buttons = { send, stop, accept, reject };
    state.setState = (next, text = "") => {
      state.state = next;
      node.dataset.state = next;
      status.textContent = text;
      send.hidden = !(next === "idle" || next === "failed");
      stop.hidden = !(next === "thinking" || next === "writing");
      accept.hidden = reject.hidden = next !== "review";
      input.placeholder = next === "review" ? "Ask for a change to this edit" : input.placeholder;
    };
    state.setState("idle");
    input.addEventListener("input", () => {
      drafts.set(model, input.value);
      if (drafts.size > DRAFT_LIMIT) drafts.delete(drafts.keys().next().value);
      input.style.height = "auto";
      input.style.height = Math.min(96, input.scrollHeight) + "px";
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        if (state.state === "idle" || state.state === "failed" || (state.state === "review" && input.value.trim() && input.value !== state.lastInstruction))
          void state.submit();
      }
    });
    state.submit = () => submitBar(state);
    return state;
  }
  async function submitBar(state) {
    const instruction = state.input.value.trim();
    if (!instruction) { state.setState(state.state === "review" ? "review" : "idle", "Type an instruction first."); return false; }
    const runner = assistant();
    if (!runner || typeof runner.runJob !== "function") { state.setState("failed", "The Assistant is not ready."); return false; }
    const followUp = state.state === "review" && state.lastCode;
    if (state.session) { finishQuiet(state.session); state.session = null; }
    const model = state.model;
    const region = state.region();
    const regionNow = region.endLine >= region.startLine ? Diff.splitLines(model.getValue()).slice(region.startLine - 1, region.endLine) : [];
    if (regionNow.join("\n") !== state.original.join("\n")) state.original = regionNow;
    const previous = followUp ? state.lastCode : null;
    const combined = followUp ? state.lastInstruction + "\nThen: " + instruction : instruction;
    const prompt = Diff.buildInlinePrompt({ instruction: combined, file: fileName(model), language: languageOf(model),
      text: model.getValue(), region, error: state.error, previous, tools: runner.providerHasTools ? runner.providerHasTools() : true });
    state.lastInstruction = combined;
    state.input.value = "";
    state.input.placeholder = combined.split("\n").pop();
    drafts.delete(model);
    state.setState("thinking", "Thinking");
    state.session = createSession(model, [], { source: "inline", state: "streaming", label: combined });
    let text = "";
    state.job = runner.runJob(prompt, {
      onText(full) {
        text = full;
        if (state.job === null || bar !== state) return;
        const reply = Diff.extractCode(text, false);
        if (!reply.fenced) return;
        if (state.state === "thinking") state.setState("writing", "Writing");
        const where = state.region();
        replaceHunks(state.session, Diff.streamingHunks(state.original, reply.code, where.startLine - 1), "streaming");
      },
      onTool(summary) { if (state.state === "thinking" || state.state === "writing") state.status.textContent = summary; },
      onDone(result) {
        state.job = null;
        if (bar !== state) return;
        if (!result.ok) {
          if (state.session) { untrack(state.session); finishQuiet(state.session); state.session = null; }
          state.input.value = instruction;
          state.setState("failed", result.cancelled ? "Stopped." : result.error || "The Assistant failed.");
          queueRender();
          return;
        }
        const reply = Diff.extractCode(result.text || text, true);
        const code = reply.code.replace(/\n$/, "");
        state.lastCode = code;
        const where = state.region();
        const newLines = code === "" && !state.original.length ? [] : code.split("\n");
        const hunks = Diff.hunksOf(state.original, newLines, where.startLine - 1);
        if (!hunks.length) {
          finishQuiet(state.session);
          state.session = null;
          state.setState("failed", "No change came back.");
          queueRender();
          return;
        }
        replaceHunks(state.session, hunks, "review");
        state.session.onFinish = () => { if (bar === state) closeBar(false, true); };
        const { added, removed } = Diff.countChanges(hunks);
        state.setState("review", "+" + added + " -" + removed);
        state.input.placeholder = "Ask for a change to this edit";
        reveal(state.session);
      }
    });
    return true;
  }
  function finishQuiet(session) {
    untrack(session);
    session.state = "done";
    const index = sessions.indexOf(session);
    if (index >= 0) sessions.splice(index, 1);
    emit();
  }
  function stopBar() {
    if (!bar || !bar.job) return false;
    bar.job.cancel();
    return true;
  }
  function acceptBar() { if (bar && bar.session) acceptAll(bar.session); }
  function rejectBar() { if (bar && bar.session) rejectAll(bar.session); }
  function closeBar(focusEditor, decided = false) {
    if (!bar) return;
    const state = bar;
    bar = null;
    if (state.job) state.job.cancel();
    if (state.session && !decided && state.session.state !== "done") {
      if (state.session.state === "review") rejectAll(state.session); else finishQuiet(state.session);
    }
    if (!state.model.isDisposed()) state.model.deltaDecorations(state.regionIds, []);
    if (state.widget) editor.removeOverlayWidget(state.widget);
    queueRender();
    if (focusEditor || doc.activeElement === state.input || state.node.contains(doc.activeElement)) editor.focus();
  }
  function reveal(session) {
    const first = pending(session).map(hunk => place(session, hunk)).find(Boolean);
    if (first) editor.revealLinesInCenterIfOutsideViewport(Math.max(1, first.start), Math.max(first.start, first.end));
  }
  function flash(text) {
    const runner = assistant();
    if (runner && runner.notify) runner.notify(text);
  }

  /* ---------- keyboard ---------- */
  function widgetOpen() {
    const dom = editor.getDomNode();
    return Boolean(dom && dom.querySelector(".suggest-widget.visible, .find-widget.visible, .rename-box, .context-view .monaco-menu"));
  }
  function onKey(event) {
    const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    const key = String(event.key || "");
    const inEditor = editor.hasTextFocus();
    const inBar = Boolean(bar && bar.node.contains(doc.activeElement));
    if (!inEditor && !inBar) return;
    const stop = () => { event.preventDefault(); event.stopPropagation(); if (event.stopImmediatePropagation) event.stopImmediatePropagation(); };
    if (mod && !event.shiftKey && !event.altKey && key.toLowerCase() === "k") { stop(); openInline(); return; }
    const session = activeSession();
    if (inBar && key === "Escape") {
      stop();
      if (bar.state === "thinking" || bar.state === "writing") stopBar();
      else if (bar.state === "review") rejectBar();
      else closeBar(true);
      return;
    }
    if (!session || session.state !== "review") return;
    if (mod && key === "Enter" && !event.shiftKey) { stop(); acceptAll(session); if (inBar) editor.focus(); return; }
    // Esc rejects a Ctrl+K edit. Agent edits take a deliberate key, so a stray
    // Esc never throws them away.
    if (key === "Escape" && inEditor && session.source === "inline" && !widgetOpen()) { stop(); rejectAll(session); return; }
    if (mod && event.shiftKey && key === "Backspace" && inEditor) { stop(); rejectAll(session); return; }
    if (key === "Tab" && !event.shiftKey && !mod && !event.altKey && session.source === "inline" &&
        ((inEditor && !widgetOpen()) || (inBar && !bar.input.value.trim()))) { stop(); acceptAll(session); editor.focus(); return; }
    if (event.altKey && !mod && (event.code === "KeyY" || event.code === "KeyN") && inEditor) {
      stop();
      const position = editor.getPosition();
      const hunk = hunkNear(session, position ? position.lineNumber : 1);
      if (hunk) decide(session, [hunk], event.code === "KeyY");
    }
  }
  const keyTarget = options.keyTarget || root;
  if (keyTarget && keyTarget.addEventListener) keyTarget.addEventListener("keydown", onKey, true);

  /* ---------- Fix with Assistant ---------- */
  function errorsAt(model, line, markers = []) {
    const found = [];
    for (const marker of markers || [])
      if (marker.severity >= 8 && marker.startLineNumber <= line && line <= marker.endLineNumber)
        found.push({ line: marker.startLineNumber, message: String(marker.message || "") });
    if (!found.length && model.getLineDecorations) {
      for (const decoration of model.getLineDecorations(line) || []) {
        const options = decoration.options || {};
        if (options.inlineClassName === "flowstudio-flow-error") {
          const hover = options.hoverMessage;
          const message = Array.isArray(hover) ? hover.map(item => item.value).join(" ") : hover && hover.value;
          found.push({ line, message: String(message || "Compiler error") });
        }
      }
    }
    return found;
  }
  function fixError(line, message) {
    const model = editor.getModel();
    if (!model) return false;
    const target = line || (editor.getPosition() || { lineNumber: 1 }).lineNumber;
    let text = message;
    if (!text) { const found = errorsAt(model, target, monaco.editor.getModelMarkers({ resource: model.uri })); text = found.length ? found[0].message : ""; }
    if (!text) return false;
    const block = Diff.enclosingBlock(model.getValue(), target, languageOf(model));
    return openInline({ instruction: "Fix this error: " + text + " (line " + target + ")", region: { startLine: block.start, endLine: block.end },
      error: { line: target, message: text } });
  }
  const disposables = [];
  if (typeof monaco.editor.registerCommand === "function")
    disposables.push(monaco.editor.registerCommand(FIX_COMMAND, (_accessor, line, message) => fixError(line, message)));
  if (monaco.languages && monaco.languages.registerCodeActionProvider)
    disposables.push(monaco.languages.registerCodeActionProvider(["flow", "python", "r"], {
      provideCodeActions(model, range, context) {
        const errors = errorsAt(model, range.startLineNumber, context && context.markers);
        if (!errors.length) return { actions: [], dispose() {} };
        const first = errors[0];
        return { actions: [{ title: "Fix with Assistant (" + modKey + "K)", kind: "quickfix",
          diagnostics: (context.markers || []).filter(marker => marker.startLineNumber === first.line),
          command: { id: FIX_COMMAND, title: "Fix with Assistant", arguments: [first.line, first.message] } }], dispose() {} };
      }
    }, { providedCodeActionKinds: ["quickfix"] }));

  /* ---------- proposals and Apply ---------- */
  function startWaiting(item) {
    const model = modelFor(item.document);
    if (!model) { waiting.push(item); emit(); return null; }
    if (sessionFor(model)) { waiting.push(item); emit(); return null; }
    const before = model.getValue();
    const after = typeof item.after === "function" ? item.after(before) : item.after;
    return createSession(model, Diff.hunksOf(before, after), { source: item.source, label: item.label,
      onFinish: item.onFinish, proposal: item.proposal });
  }
  /* item: { document, after: text | (before) => text, source, label, onFinish } */
  function propose(item) { return startWaiting({ ...item, id: nextSession++ }); }
  function activate(session) {
    const a = app();
    const document = session.document || documentFor(session.model);
    if (editor.getModel() !== session.model && a && a.activateDocument && document) a.activateDocument(document.id);
    return editor.getModel() === session.model;
  }
  function find(id) { return sessions.find(item => item.id === id) || null; }
  function list() {
    const live = sessions.filter(item => item.state === "review").map(item => {
      const left = pending(item);
      const { added, removed } = Diff.countChanges(left);
      return { id: item.id, file: item.file, source: item.source, label: item.label, pending: left.length,
        total: item.hunks.length, added, removed, active: item.model === editor.getModel(), waiting: false };
    });
    for (const item of waiting) live.push({ id: item.id, file: item.document ? item.document.path || item.document.name : "file",
      source: item.source, label: item.label, pending: 0, total: 0, added: 0, removed: 0, active: false, waiting: true });
    return live;
  }
  function review(id) {
    const session = find(id);
    if (session) { if (activate(session)) { reveal(session); editor.focus(); } return true; }
    const index = waiting.findIndex(item => item.id === id);
    if (index < 0) return false;
    const a = app();
    if (a && a.activateDocument) a.activateDocument(waiting[index].document.id);
    return true;
  }
  function decideSession(id, accept) {
    const session = find(id);
    if (session) {
      if (accept && !activate(session)) return false;
      return accept ? acceptAll(session) : rejectAll(session);
    }
    const index = waiting.findIndex(item => item.id === id);
    if (index < 0) return false;
    const item = waiting.splice(index, 1)[0];
    if (accept) {
      const a = app();
      if (a && a.activateDocument) a.activateDocument(item.document.id);
      const started = startWaiting(item);
      return started ? acceptAll(started) : false;
    }
    emit();
    if (item.onFinish) item.onFinish({ accepted: 0, rejected: 1, stale: 0, total: 1 });
    return true;
  }

  render();
  const api = {
    open: openInline, close: () => closeBar(true), fixError, propose, list, review,
    accept: id => decideSession(id, true), reject: id => decideSession(id, false),
    acceptAll: () => acceptAll(), rejectAll: () => rejectAll(),
    acceptHunk: id => { const s = activeSession(); return s ? decide(s, s.hunks.filter(h => h.id === id), true) : false; },
    rejectHunk: id => { const s = activeSession(); return s ? decide(s, s.hunks.filter(h => h.id === id), false) : false; },
    state: () => {
      const session = activeSession();
      return { bar: bar ? bar.state : null, status: bar ? bar.status.textContent : "",
        session: session ? { id: session.id, state: session.state, source: session.source,
          hunks: session.hunks.map(h => ({ id: h.id, state: h.state, removed: h.removed.slice(), added: h.added.slice() })) } : null };
    },
    dispose() {
      closeBar(false);
      for (const session of sessions.slice()) finishQuiet(session);
      clearView();
      if (keyTarget && keyTarget.removeEventListener) keyTarget.removeEventListener("keydown", onKey, true);
      for (const item of disposables) if (item && item.dispose) item.dispose();
    }
  };
  return Object.freeze(api);
}

const api = Object.freeze({ mount, FIX_COMMAND, isMac });
if (typeof module !== "undefined" && module.exports) module.exports = api;
root.FlowStudioInlineEditModule = api;
/* The editor arrives from the workbench module after this script runs. */
if (typeof document !== "undefined" && document.getElementById("monacoHost")) {
  let tries = 0;
  const start = () => {
    if (root.FlowStudioInlineEdit) return;
    if (!(root.FlowStudioEditor && root.FlowStudioEditor.editor && root.FlowStudioMonaco)) {
      if (++tries < 600) setTimeout(start, 50);
      return;
    }
    try { root.FlowStudioInlineEdit = mount({}); }
    catch (error) { if (root.console) root.console.error("FlowStudio inline edits failed to mount: " + (error && error.message)); }
  };
  start();
}
})(typeof globalThis !== "undefined" ? globalThis : this);
