import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
// Language server features for Flow (web/ide_flow_lsp.js): go to definition,
// references, rename, formatting, quick fixes and problem navigation.
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js';
import 'monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js';
import 'monaco-editor/editor/contrib/rename/browser/rename.js';
import 'monaco-editor/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/r/register.js';
import { createIcons, FolderOpen, FilePlus2, RotateCw, Play, Blocks, Files, ListTree,
  ChartNoAxesCombined, Table2, Terminal, SlidersHorizontal, Search, Command,
  ChevronRight, Circle, ArrowUpRight, X, FileCode2, Package, Library, Bug,
  Octagon, Download, List, CircleCheck, Ellipsis } from 'lucide';
import { mountEditor } from './editor.js';
import { registerCompletion } from './completion.js';
import './workbench.css';
import { mountTerminalPanel } from './terminal_panel.js';

const icons = { FolderOpen, FilePlus2, RotateCw, Play, Blocks, Files, ListTree,
  ChartNoAxesCombined, Table2, Terminal, SlidersHorizontal, Search, Command,
  ChevronRight, Circle, ArrowUpRight, X, FileCode2, Package, Library, Bug,
  Octagon, Download, List, CircleCheck, Ellipsis };
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
// The debugger registers its hover provider through this.
globalThis.FlowStudioMonaco = monaco;
const app = globalThis.FlowStudioApp;
globalThis.FlowStudioEditor = mountEditor(monaco, document.getElementById('source'),
  document.getElementById('monacoHost'), app, document.getElementById('language'));
document.getElementById('editorEngine').textContent = 'Monaco';
registerCompletion(monaco, app);

mountTerminalPanel();

// The top bar command center, Ctrl+K and Ctrl+P open Search Everywhere
// (web/ide_search_everywhere.js).
