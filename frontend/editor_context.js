/* The editor's right-click menu and the split editor.
 *
 * Monaco keeps its own context menu (Go to Definition, Rename Symbol and
 * Format Document come from the Flow language server; Cut, Copy and Paste
 * from Monaco's clipboard contribution). This adds FlowStudio's actions to
 * it: run the selection or line in the console, lexical navigation where no
 * language server answers, Check Flow, the assistant, breakpoints and the
 * command palette. The menu renders in the page (useShadowDOM off) so
 * web/ide_context_menu.css styles it like every other menu.
 *
 * The split editor shows a second document beside the main one. Both share
 * the document's Monaco model, so an edit in either side is the same edit.
 */
export function mountEditorContext(monaco, host, app) {
  if (!host || !host.editor || !app) return null;
  const editor = host.editor;
  editor.updateOptions({ useShadowDOM: false });
  const { KeyMod, KeyCode } = monaco;
  const commands = app.commands || {};
  const call = name => () => { const run = commands[name]; if (typeof run === 'function') return run(); return false; };

  function language() {
    const model = editor.getModel();
    return model ? model.getLanguageId() : 'flow';
  }
  function showConsole() {
    const panel = globalThis.FlowStudioTerminal;
    if (panel && typeof panel.show === 'function') panel.show('console', { focus: false });
  }
  function submit(code) {
    const send = globalThis.FlowStudioConsoleSubmit;
    if (typeof send !== 'function') { app.status('The console is not available.', 'error'); return false; }
    if (!code.trim()) { app.status('Nothing to run on this line.', 'error'); return false; }
    showConsole();
    return send(language(), code);
  }
  function debuggerApi() {
    const debug = globalThis.FlowStudioDebugger;
    return debug && debug.instance && debug.instance.breakpoints ? debug.instance.breakpoints : null;
  }

  const breakpointHere = editor.createContextKey('flowstudioBreakpointHere', false);
  function syncBreakpoint() {
    const points = debuggerApi();
    const model = editor.getModel(), position = editor.getPosition();
    breakpointHere.set(Boolean(points && model && position && points.find(model, position.lineNumber)));
  }
  editor.onDidChangeCursorPosition(syncBreakpoint);
  editor.onDidChangeModel(syncBreakpoint);
  editor.onContextMenu(syncBreakpoint);
  function toggleBreakpoint() {
    const points = debuggerApi();
    const model = editor.getModel(), position = editor.getPosition();
    if (!points || !model || !position) { app.status('The debugger is not ready yet.', 'error'); return false; }
    points.toggle(model, position.lineNumber);
    syncBreakpoint();
    return true;
  }

  const actions = [
    { id: 'flowstudio.runSelection', label: 'Run Selection in Console', group: 'navigation', order: 0.1,
      precondition: 'editorHasSelection',
      run: () => {
        const model = editor.getModel(), selection = editor.getSelection();
        return model && selection ? submit(model.getValueInRange(selection)) : false;
      } },
    { id: 'flowstudio.runLine', label: 'Run Line in Console', group: 'navigation', order: 0.2,
      precondition: '!editorHasSelection',
      run: () => {
        const model = editor.getModel(), position = editor.getPosition();
        if (!model || !position) return false;
        const sent = submit(model.getLineContent(position.lineNumber));
        // As RStudio does, the caret moves on so the next line is one keystroke away.
        if (position.lineNumber < model.getLineCount()) editor.setPosition({ lineNumber: position.lineNumber + 1, column: 1 });
        return sent;
      } },
    // Lexical navigation for R, Python and Flow without a language server.
    // With the Flow language server running, Monaco's own items take over.
    { id: 'flowstudio.goToDefinition', label: 'Go to Definition', group: 'navigation', order: 1.1,
      precondition: '!editorHasDefinitionProvider', keybindings: [KeyCode.F12], run: call('goToDefinition') },
    { id: 'flowstudio.findReferences', label: 'Find References', group: 'navigation', order: 1.2,
      precondition: '!editorHasReferenceProvider', keybindings: [KeyMod.Shift | KeyCode.F12], run: call('findReferences') },
    { id: 'flowstudio.renameSymbol', label: 'Rename Symbol', group: '1_modification', order: 1.1,
      precondition: '!editorHasRenameProvider', keybindings: [KeyCode.F2], run: call('renameSymbol') },
    { id: 'flowstudio.checkFlow', label: 'Check Flow', group: '1_modification', order: 2,
      precondition: "editorLangId == 'flow'", run: call('checkFlow') },
    { id: 'flowstudio.explain', label: 'Explain with Assistant', group: '2_assistant', order: 1,
      precondition: 'editorHasSelection', run: call('assistantExplain') },
    { id: 'flowstudio.inlineEdit', label: 'Edit with Assistant', group: '2_assistant', order: 2,
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyK], run: call('assistantInlineEdit') },
    { id: 'flowstudio.addBreakpoint', label: 'Add Breakpoint', group: '3_debug', order: 1,
      precondition: '!flowstudioBreakpointHere', keybindings: [KeyCode.F9], run: toggleBreakpoint },
    { id: 'flowstudio.removeBreakpoint', label: 'Remove Breakpoint', group: '3_debug', order: 1,
      precondition: 'flowstudioBreakpointHere', keybindings: [KeyCode.F9], run: toggleBreakpoint },
    { id: 'flowstudio.commandPalette', label: 'Command Palette', group: 'z_commands', order: 1,
      keybindings: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyP],
      run: () => globalThis.FlowStudioContextMenu ? globalThis.FlowStudioContextMenu.commandPalette() : false }
  ];
  for (const action of actions) {
    editor.addAction({
      id: action.id, label: action.label, precondition: action.precondition,
      keybindings: action.keybindings, contextMenuGroupId: action.group, contextMenuOrder: action.order,
      run: () => {
        try {
          const result = action.run();
          if (result && typeof result.then === 'function')
            result.then(null, error => app.status(action.label + ' failed: ' + (error && error.message || error), 'error'));
        } catch (error) { app.status(action.label + ' failed: ' + (error && error.message || error), 'error'); }
      }
    });
  }

  const split = mountSplit(monaco, host, app);
  globalThis.FlowStudioSplitEditor = split;
  return Object.freeze({ actions: actions.map(action => action.id), split });
}

function mountSplit(monaco, host, app) {
  const main = document.getElementById('monacoHost');
  let pane = null, side = null, row = null, docId = null, listener = null;

  function close() {
    if (!pane) return false;
    if (listener) listener.dispose();
    side.dispose();
    row.replaceWith(main);
    pane = side = row = listener = null;
    docId = null;
    host.editor.focus();
    return true;
  }
  function open(id) {
    const doc = app.documents.find(id);
    if (!doc || !main) return false;
    // Write the visible buffer back first, so the side shows current text.
    if (typeof app.saveEditorBuffer === 'function') app.saveEditorBuffer();
    const model = host.ensureModel ? host.ensureModel(doc) : host.modelFor(doc.id);
    if (!model) return false;
    if (!pane) {
      row = document.createElement('div');
      row.className = 'fs-split-row';
      main.replaceWith(row);
      pane = document.createElement('section');
      pane.className = 'fs-split-pane';
      pane.id = 'splitEditor';
      pane.setAttribute('aria-label', 'Split editor');
      const head = document.createElement('div');
      head.className = 'fs-split-head';
      const name = document.createElement('span');
      name.className = 'fs-split-name';
      const shut = document.createElement('button');
      shut.type = 'button';
      shut.className = 'fs-split-close';
      shut.id = 'splitEditorClose';
      shut.textContent = '×';
      shut.title = 'Close the split editor';
      shut.setAttribute('aria-label', 'Close the split editor');
      shut.addEventListener('click', close);
      head.append(name, shut);
      const surface = document.createElement('div');
      surface.className = 'fs-split-host';
      pane.append(head, surface);
      row.append(main, pane);
      side = monaco.editor.create(surface, {
        theme: 'flowstudio', automaticLayout: true, fontSize: 13, lineHeight: 23,
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        minimap: { enabled: false }, padding: { top: 12, bottom: 24 }, scrollBeyondLastLine: false,
        lineNumbersMinChars: 3, glyphMargin: false, folding: true, tabSize: 4, insertSpaces: true,
        overviewRulerBorder: false, scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
        ariaLabel: 'Split source editor', fixedOverflowWidgets: true, useShadowDOM: false
      });
    }
    side.setModel(model);
    docId = doc.id;
    pane.querySelector('.fs-split-name').textContent = doc.path || doc.name;
    pane.querySelector('.fs-split-name').title = doc.path || doc.name;
    if (listener) listener.dispose();
    // The main editor syncs its own document. Edits here to another
    // document go straight into the document model and its dirty mark.
    listener = side.onDidChangeModelContent(() => {
      const active = app.documents.active();
      const target = app.documents.find(docId);
      if (!target || (active && active.id === docId)) return;
      app.documents.setText(docId, model.getValue());
      app.renderTabs();
    });
    side.focus();
    return true;
  }
  async function openHandle(handle, path) {
    const previous = app.documents.active();
    if (!(await app.openEditorHandle(handle, path))) return false;
    const opened = app.documents.list().find(item => item.path === path);
    if (!opened) return false;
    // The main editor keeps what it showed; the file opens beside it.
    if (previous && previous.id !== opened.id && app.documents.find(previous.id)) app.activateDocument(previous.id);
    return open(opened.id);
  }
  document.addEventListener('flowstudio:documents', () => {
    if (!pane) return;
    const doc = app.documents.find(docId);
    if (!doc) { Promise.resolve().then(close); return; }
    pane.querySelector('.fs-split-name').textContent = doc.path || doc.name;
  });
  return Object.freeze({
    available: () => Boolean(main),
    open, openHandle, close,
    isOpen: () => Boolean(pane),
    documentId: () => docId,
    editor: () => side
  });
}
