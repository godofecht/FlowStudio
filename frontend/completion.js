/* Monaco glue for the FlowStudio completion core. Registered once from the
 * bundled workbench (frontend/main.js). Python and R draw live session symbols
 * from the loopback inspect routes; Flow uses lexical buffer symbols. */
import '/ide_completion_core.js';

const INSPECT_ROUTES = { python: '/api/inspect/python', r: '/api/inspect/r' };

export function sessionSnapshot(fetchFn, language, signal) {
  const route = INSPECT_ROUTES[language];
  if (!route) return Promise.resolve([]);
  return fetchFn(route, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' },
    body: ''
  }).then(response => response.ok ? response.json() : { variables: [] })
    .then(snapshot => (snapshot && Array.isArray(snapshot.variables))
      ? snapshot.variables.filter(v => v && typeof v.name === 'string').slice(0, 128)
      : [])
    .catch(() => []);
}
export function sessionSymbols(fetchFn, language, signal) {
  return sessionSnapshot(fetchFn, language, signal).then(variables => variables.map(v => v.name));
}

const WORD_AT = /[A-Za-z0-9_.]*$/;
const MATH_COMMANDS = Object.freeze({
  partial: '∂', nabla: '∇', grad: '∇', laplacian: '∇²', div: '∇·', curl: '∇×',
  cdot: '·', times: '×', otimes: '⊗', odot: '⊙', circ: '∘',
  sum: '∑', prod: '∏', int: '∫', approx: '≈', equiv: '≡', in: '∈',
  forall: '∀', exists: '∃', perp: '⊥', parallel: '∥', oplus: '⊕',
  vdash: '⊢', mapsto: '↦', pipe: '▷', star: '⋆', dagger: '†',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ',
  nu: 'ν', rho: 'ρ', pi: 'π', omega: 'ω', Omega: 'Ω',
  sub0: '₀', sub1: '₁', subt: 'ₜ', squared: '²', cubed: '³'
});
export function mathCommandAt(model, position) {
  const line = model.getLineContent(position.lineNumber) || '';
  const before = line.slice(0, position.column - 1);
  const match = /\\([A-Za-z][A-Za-z0-9]*)$/.exec(before);
  return match ? { command: match[1], length: match[0].length } : null;
}
export { MATH_COMMANDS };
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
      triggerCharacters: language === 'r' ? ['.', ' : language === 'flow' ? ['\\'] : [],] : language === 'flow' ? ['\\'] : [],
      provideCompletionItems: async (model, position) => {
        const math = language === 'flow' ? mathCommandAt(model, position) : null;
        if (math) {
          return { suggestions: Object.entries(MATH_COMMANDS)
            .filter(([command]) => command.startsWith(math.command))
            .map(([command, glyph]) => ({
              label: '\\' + command + ' → ' + glyph,
              kind: monaco.languages.CompletionItemKind.Operator,
              insertText: glyph,
              range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                startColumn: position.column - math.length, endColumn: position.column }
            })) };
        }
        const beforeCursor = (model.getLineContent(position.lineNumber) || '')
          .slice(0, position.column - 1);
        const member = language === 'r' ? core.rMemberContext(beforeCursor) : null;
        const prefix = member ? member.prefix : prefixAt(model, position, language);
        if (!prefix && !member) return { suggestions: [] };
        const source = model.getValue();
        let variables = [];
        if (INSPECT_ROUTES[language]) {
          const cached = cache.get(language);
          if (cached && Date.now() - cached.at < 5000) {
            try { variables = await cached.promise; } catch (_) { variables = []; }
          } else {
            if (cached) { try { cached.controller.abort(); } catch (_) {} cache.delete(language); }
            const controller = new AbortController();
            const entry = { promise: sessionSnapshot(fetchFn, language, controller.signal), controller, at: Date.now() };
            cache.set(language, entry);
            try { variables = await entry.promise; } catch (_) { variables = []; }
          }
        }
        const lexical = member ? [] : language === 'flow'
          ? (core.flowSymbols(source, model.getOffsetAt(position), prefix) || [])
          : [...core.bufferIdentifiers(source, prefix, language, 262144)];
        const items = member
          ? core.rListMembers(variables, member.path, prefix)
          : core.suggestionsFor(language, { prefix,
              session: variables.map(variable => variable.name), lexical });
        return {
          suggestions: items.map(item => ({
            label: item.label,
            kind: item.kind === 'snippet' ? monaco.languages.CompletionItemKind.Snippet :
              item.kind === 'keyword' ? monaco.languages.CompletionItemKind.Keyword :
              item.kind === 'variable' ? monaco.languages.CompletionItemKind.Variable :
              monaco.languages.CompletionItemKind.Text,
            insertText: item.insert,
            insertTextRules: item.kind === 'snippet' ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            range: member ? {
              startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
              startColumn: position.column - prefix.length, endColumn: position.column
            } : wordRange(model, position, prefix)
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
