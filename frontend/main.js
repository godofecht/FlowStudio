import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/r/register.js';
import { createIcons, FolderOpen, FilePlus2, RotateCw, Play, Blocks, Files, ListTree,
  ChartNoAxesCombined, Table2, Terminal, SlidersHorizontal, Search, Command,
  ChevronRight, Circle, ArrowUpRight, X, FileCode2, Package, Library, Bug,
  Octagon, Download, List } from 'lucide';
import { mountEditor } from './editor.js';
import { registerCompletion } from './completion.js';
import './workbench.css';

const icons = { FolderOpen, FilePlus2, RotateCw, Play, Blocks, Files, ListTree,
  ChartNoAxesCombined, Table2, Terminal, SlidersHorizontal, Search, Command,
  ChevronRight, Circle, ArrowUpRight, X, FileCode2, Package, Library, Bug,
  Octagon, Download, List };
createIcons({ icons, attrs: { 'aria-hidden': 'true', 'stroke-width': 1.6 } });
globalThis.MonacoEnvironment = {
  getWorker: () => new Worker('/ui/editor.worker.js', { name: 'flowstudio-editor' })
};
monaco.editor.defineTheme('flowstudio', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '737D89', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'B4A4E5' },
    { token: 'string', foreground: 'A9C7A0' },
    { token: 'number', foreground: 'DEB789' },
    { token: 'type.identifier', foreground: '82B9C7' }
  ],
  colors: {
    'editor.background': '#191B20', 'editor.foreground': '#CDD1D8',
    'editorLineNumber.foreground': '#515761', 'editorLineNumber.activeForeground': '#A9B0BA',
    'editor.lineHighlightBackground': '#202329', 'editor.selectionBackground': '#35463F',
    'editor.inactiveSelectionBackground': '#2B3335', 'editorCursor.foreground': '#A8C9B6',
    'editorIndentGuide.background1': '#282C33', 'editorIndentGuide.activeBackground1': '#454B53',
    'editorWidget.background': '#22252B', 'editorWidget.border': '#373C45',
    'editorGutter.background': '#191B20', 'focusBorder': '#8BB79F'
  }
});
monaco.languages.register({ id: 'flow', extensions: ['.flow'] });
monaco.languages.setMonarchTokensProvider('flow', {
  keywords: ['function', 'return', 'let', 'mut', 'const', 'if', 'else', 'while', 'for',
    'in', 'import', 'export', 'struct', 'enum', 'trait', 'impl', 'match', 'true', 'false', 'and', 'or'],
  tokenizer: { root: [
    [/#.*$/, 'comment'], [/"([^"\\]|\\.)*"/, 'string'],
    [/\b\d+(\.\d+)?\b/, 'number'],
    [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }]
  ] }
});
monaco.languages.setLanguageConfiguration('flow', {
  comments: { lineComment: '#' }, brackets: [['{', '}'], ['(', ')'], ['[', ']']],
  autoClosingPairs: [{ open: '{', close: '}' }, { open: '(', close: ')' },
    { open: '[', close: ']' }, { open: '"', close: '"' }]
});
const app = globalThis.FlowStudioApp;
globalThis.FlowStudioEditor = mountEditor(monaco, document.getElementById('source'),
  document.getElementById('monacoHost'), app, document.getElementById('language'));
document.getElementById('editorEngine').textContent = 'Monaco';
registerCompletion(monaco, app);

// Native dialog supplies focus containment, Escape and focus restoration.
const palette = document.getElementById('commandPalette');
const query = document.getElementById('commandQuery');
const results = document.getElementById('commandResults');
const commands = [
  ['New buffer', 'newDocument', 'Ctrl+Alt+N'], ['Open file', 'openFile', 'Ctrl+O'],
  ['Open folder', 'openFolder', ''], ['Save file', 'saveFile', 'Ctrl+S'],
  ['Find in buffer', 'focusFind', 'Ctrl+F'], ['Go to symbol', 'goToSymbol', 'Ctrl+Shift+O'],
  ['Run selection or file', 'run', 'Ctrl+Enter'], ['Run current cell', 'runCell', 'Ctrl+Shift+Enter'],
  ['Show files', 'showFiles', ''], ['Show plots', 'showPlots', ''], ['Show data', 'showData', ''],
  ['Refresh environment', 'refreshEnvironment', ''], ['Toggle console', 'toggleDock', '']
];
function renderCommands() {
  results.replaceChildren();
  const matches = commands.filter(([label]) => label.toLowerCase().includes(query.value.toLowerCase()));
  for (const [label, command, shortcut] of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    const name = document.createElement('span'); name.textContent = label;
    const hint = document.createElement('kbd'); hint.textContent = shortcut;
    button.append(name, hint);
    button.addEventListener('click', () => { palette.close(); app.commands[command](); });
    results.append(button);
  }
  if (!matches.length) results.textContent = 'No matching commands.';
}
document.getElementById('commandLauncher').addEventListener('click', () => {
  query.value = ''; renderCommands(); palette.showModal(); query.focus();
});
document.getElementById('closePalette').addEventListener('click', () => palette.close());
query.addEventListener('input', renderCommands);
palette.addEventListener('click', event => { if (event.target === palette) palette.close(); });
palette.addEventListener('keydown', event => {
  const buttons = [...results.querySelectorAll('button')];
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  } else if (event.key === 'Enter' && event.target === query) {
    event.preventDefault(); buttons[0]?.click();
  }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); document.getElementById('commandLauncher').click();
  }
}, true);
