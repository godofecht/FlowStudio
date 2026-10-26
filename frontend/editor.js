/* Keep the existing document and execution controllers connected to Monaco. */
export function mountEditor(monaco, source, host, app, language) {
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  const models = new Map();
  const views = new Map();
  let currentId = null;
  let updating = false;
  const editor = monaco.editor.create(host, {
    theme: 'flowstudio', automaticLayout: true, fontSize: 13, lineHeight: 23,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    minimap: { enabled: false }, padding: { top: 22, bottom: 24 },
    scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'smooth',
    renderLineHighlight: 'line', lineNumbersMinChars: 4, glyphMargin: false,
    folding: true, roundedSelection: true, tabSize: 4, insertSpaces: true,
    overviewRulerBorder: false, hideCursorInOverviewRuler: true,
    scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
    ariaLabel: 'Source code editor', fixedOverflowWidgets: true,
    wordBasedSuggestions: 'currentDocument', accessibilitySupport: 'auto'
  });
  function activate(doc) {
    if (!doc) return;
    if (currentId !== doc.id) {
      if (currentId) views.set(currentId, editor.saveViewState());
      let model = models.get(doc.id);
      if (!model) {
        model = monaco.editor.createModel(doc.text, doc.language);
        models.set(doc.id, model);
      }
      updating = true;
      editor.setModel(model);
      currentId = doc.id;
      if (views.has(doc.id)) editor.restoreViewState(views.get(doc.id));
      updating = false;
    }
    monaco.editor.setModelLanguage(editor.getModel(), doc.language);
    const live = new Set(app.documents.list().map(item => item.id));
    for (const [id, model] of models) {
      if (!live.has(id)) { model.dispose(); models.delete(id); views.delete(id); }
    }
  }
  activate(app.documents.active());
  function value() { return editor.getModel()?.getValue() ?? ''; }
  function offsets() {
    const selection = editor.getSelection(), model = editor.getModel();
    return selection && model ? [model.getOffsetAt(selection.getStartPosition()),
      model.getOffsetAt(selection.getEndPosition())] : [0, 0];
  }
  function select(start, end = start, direction = 'forward') {
    const model = editor.getModel();
    if (!model) return;
    const a = model.getPositionAt(start), b = model.getPositionAt(end);
    editor.setSelection(direction === 'backward'
      ? new monaco.Selection(b.lineNumber, b.column, a.lineNumber, a.column)
      : new monaco.Selection(a.lineNumber, a.column, b.lineNumber, b.column));
    editor.revealPositionInCenterIfOutsideViewport(a);
  }
  Object.defineProperties(source, {
    value: { configurable: true, get: value, set(text) {
      text = String(text);
      nativeValue.set.call(source, text);
      if (text === value()) return;
      updating = true;
      editor.getModel()?.setValue(text);
      updating = false;
    } },
    selectionStart: { configurable: true, get: () => offsets()[0],
      set: start => select(start, Math.max(start, offsets()[1])) },
    selectionEnd: { configurable: true, get: () => offsets()[1],
      set: end => select(Math.min(offsets()[0], end), end) }
  });
  source.focus = () => editor.focus();
  source.setSelectionRange = select;
  source.setRangeText = (text, start = offsets()[0], end = offsets()[1], mode = 'preserve') => {
    const model = editor.getModel();
    const a = model.getPositionAt(start), b = model.getPositionAt(end);
    editor.pushUndoStop();
    editor.executeEdits('flowstudio', [{ range: new monaco.Range(a.lineNumber, a.column,
      b.lineNumber, b.column), text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    if (mode === 'select') select(start, start + text.length);
    else if (mode === 'start') select(start);
    else if (mode === 'end') select(start + text.length);
  };
  editor.onDidChangeModelContent(() => {
    nativeValue.set.call(source, value());
    if (!updating) source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  editor.onDidChangeCursorSelection(() => {
    if (!updating) source.dispatchEvent(new Event('keyup', { bubbles: true }));
  });
  language.addEventListener('change', () => {
    monaco.editor.setModelLanguage(editor.getModel(), language.value);
  });
  source.hidden = true;
  host.hidden = false;
  return Object.freeze({ editor, activate });
}
