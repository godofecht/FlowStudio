/* Monaco glue for the FlowStudio completion core. Registered once from the
 * bundled workbench (frontend/main.js). Python and R draw live session symbols
 * from the loopback inspect routes; Flow uses lexical buffer symbols. */
import '/ide_completion_core.js';

const INSPECT_ROUTES = { python: '/api/inspect/python', r: '/api/inspect/r' };

export function sessionSymbols(fetchFn, language, signal) {
  const route = INSPECT_ROUTES[language];
  if (!route) return Promise.resolve([]);
  return fetchFn(route, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' },
    body: ''
  }).then(response => response.ok ? response.json() : { variables: [] })
    .then(snapshot => (snapshot && Array.isArray(snapshot.variables))
      ? snapshot.variables.filter(v => v && typeof v.name === 'string')
          .slice(0, 128).map(v => v.name)
      : [])
    .catch(() => []);
}

const WORD_AT = /[A-Za-z0-9_.]*$/;
const WORD_START = /^[A-Za-z0-9_.]+/;

export function prefixAt(model, position, language) {
  if (!model || !position) return '';
  const line = model.getLineContent(position.lineNumber) || '';
  const before = line.slice(0, position.column - 1);
  const match = WORD_AT.exec(before);
  const word = match ? match[0] : '';
  const isR = language === 'r';
  // Python identifiers cannot start with '.'; R allows leading dots.
  if (word.startsWith('.') && !isR) return word.slice(1);
  return word;
}

const core = globalThis.FlowStudioCompletionCore;

export function registerCompletion(monaco, app, fetchFn = (typeof fetch !== 'undefined' ? fetch : null)) {
  if (!monaco || !app || typeof fetchFn !== 'function' || !core) return () => {};
  const cache = new Map();
  const disposers = [];
  for (const language of ['flow', 'python', 'r']) {
    const disposable = monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: language === 'r' ? ['.'] : [],
      provideCompletionItems: async (model, position) => {
        const prefix = prefixAt(model, position, language);
        if (!prefix) return { suggestions: [] };
        const doc = app.documents.active();
        const source = model.getValue();
        let session = [];
        if (INSPECT_ROUTES[language]) {
          const cached = cache.get(language);
          if (cached && Date.now() - cached.at < 5000) {
            try { session = await cached.promise; } catch (_) { session = []; }
          } else {
            if (cached) { try { cached.controller.abort(); } catch (_) {} cache.delete(language); }
            const controller = new AbortController();
            const entry = { promise: sessionSymbols(fetchFn, language, controller.signal), controller, at: Date.now() };
            cache.set(language, entry);
            try { session = await entry.promise; } catch (_) { session = []; }
          }
        }
        const lexical = language === 'flow'
          ? (core.flowSymbols(source, model.getOffsetAt(position), prefix) || [])
          : [...core.bufferIdentifiers(source, prefix, language, 262144)];
        const items = core.suggestionsFor(language, { prefix, session, lexical });
        return {
          suggestions: items.map(item => ({
            label: item.label,
            kind: item.kind === 'snippet' ? monaco.languages.CompletionItemKind.Snippet :
              item.kind === 'keyword' ? monaco.languages.CompletionItemKind.Keyword :
              item.kind === 'variable' ? monaco.languages.CompletionItemKind.Variable :
              monaco.languages.CompletionItemKind.Text,
            insertText: item.insert,
            range: wordRange(model, position, prefix)
          }))
        };
      }
    });
    disposers.push(disposable);
  }
  // Session symbols re-cache after every run; the editor app clears the cache.
  return () => { for (const dispose of disposers) dispose(); cache.clear(); };
}

function wordRange(model, position, prefix) {
  const word = model.getWordUntilPosition(position);
  const column = Math.max(1, (word?.startColumn ?? position.column) - prefix.length);
  return { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
    startColumn: column, endColumn: position.column };
}
