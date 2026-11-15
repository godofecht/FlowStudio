// Monaco tokens for Flow, with Python and R blocks highlighted as Python
// and R (embedded languages):
//
//   let m: f64 = python(xs) {
//       import numpy as np
//       np.mean(xs)
//   }
//
// The rules follow src/flow_blocks.py and web/flow_blocks.js. A block opens
// with python or r at the start of a statement, or after = ( , [ an operator
// return and or not, in a statement that does not start with if, while, a
// declaration and the like. When { ends its line, the block ends at a line
// that starts with } indented exactly like the opening line. Otherwise it is
// one line and ends at the last } on it.
//
// Every line starts in root, which pushes a per-line state named with the
// line's indentation (line.<indent>), so the closing rule can match
// ^<indent>} through $S2. The per-line state pops at the line's newline.

const KEYWORDS = ['function', 'return', 'let', 'mut', 'const', 'if', 'else', 'elif', 'while', 'for',
  'in', 'import', 'export', 'struct', 'enum', 'trait', 'impl', 'match', 'true', 'false', 'and', 'or',
  'not', 'extern', 'to', 'step', 'break', 'continue'];
const HEADS = 'if|elif|while|for|match|function|struct|enum|extern|import|export|type|trait|impl|flow|field|const|else';
// (args) with one level of nested parentheses and Flow strings.
const ARGS = String.raw`((?:\((?:[^()"]|"(?:[^"\\]|\\.)*"|\((?:[^()"]|"(?:[^"\\]|\\.)*")*\))*\))?)`;
const TYPE = String.raw`((?:->[^{#]*)?)`;
const AFTER = String.raw`([=(,\[+\-*/%<>!&|]|\breturn\b|\band\b|\bor\b|\bnot\b)`;

function openers(withContext) {
  const before = withContext ? AFTER + String.raw`(\s*)` : '';
  const head = String.raw`(python|r)\b(\s*)` + ARGS + String.raw`(\s*)` + TYPE;
  const lead = withContext ? ['operator', 'white'] : [];
  const tokens = [...lead, 'keyword.block', 'white', 'delimiter.parenthesis', 'white', 'type.identifier'];
  const rules = [];
  for (const language of ['python', 'r']) {
    const pattern = head.replace('(python|r)', '(' + language + ')');
    // A block over several lines: { ends the line, or a comment follows it.
    rules.push([new RegExp(before + pattern + String.raw`(\{)(?=\s*(?:#.*)?$)`), [...tokens,
      { token: 'delimiter.curly', next: '@block.$S2', nextEmbedded: language }]]);
    // A block on one line.
    rules.push([new RegExp(before + pattern + String.raw`(\{)`), [...tokens,
      { token: 'delimiter.curly', next: '@inline', nextEmbedded: language }]]);
  }
  return rules;
}

const FLOW_TOKENS = [
  [/#.*/, 'comment'],
  [/"([^"\\]|\\.)*"/, 'string'],
  [/\b\d+(\.\d+)?\b/, 'number'],
  [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
  [/[{}()[\]]/, '@brackets'],
  [/./, '']
];

export const flowLanguage = {
  // Each line ends with its newline, where the per-line state pops.
  includeLF: true,
  keywords: KEYWORDS,
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
    { open: '[', close: ']', token: 'delimiter.square' }
  ],
  tokenizer: {
    root: [
      [new RegExp(String.raw`^([ \t]*)(?=\}?[ \t]*(?:` + HEADS + String.raw`)\b)`), { token: 'white', next: '@plain' }],
      [/^[ \t]*/, { token: 'white', next: '@start.$0' }]
    ],
    // The first token of a statement: a block may open here without context.
    start: [
      [/\n/, { token: '', next: '@pop' }],
      ...openers(false),
      [/(?=.)/, { token: '', switchTo: '@line.$S2' }]
    ],
    line: [
      [/\n/, { token: '', next: '@pop' }],
      ...openers(true),
      ...FLOW_TOKENS
    ],
    plain: [
      [/\n/, { token: '', next: '@pop' }],
      ...FLOW_TOKENS
    ],
    block: [
      [/^$S2\}/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]
    ],
    inline: [
      [/\}(?=[^}]*$)/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]
    ]
  }
};

// Monaco loads a language's grammar when a model of that language first
// appears. An embedded block alone does not trigger that, so the Python and
// R grammars are loaded up front; Flow models are tokenized again when they
// arrive.
export function loadEmbeddedLanguages(monaco) {
  for (const id of ['python', 'r']) monaco.editor.createModel('', id).dispose();
}
