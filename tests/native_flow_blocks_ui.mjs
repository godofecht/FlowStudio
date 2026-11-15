/* Real Chromium acceptance for Python and R blocks inside Flow, against the
 * running native server: FLOWSTUDIO_URL=... node tests/native_flow_blocks_ui.mjs
 *
 * Monaco highlights a block as Python or R and matches its brackets; Run
 * from the editor runs a program with blocks and gets typed values; a
 * Python error names the Flow line; Ctrl+Enter and the console prompt send
 * blocks to the Flow session; hover on a value passed to a block shows its
 * Flow type; Check Flow marks a block's type error on its line. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push('pageerror: ' + error.message));
page.on('console', message => {
  // 422 is the expected reply of a failed run or check.
  if (message.type() === 'error' && !/status of 422/.test(message.text())) errors.push('console: ' + message.text());
});
await page.goto(URL);
await page.waitForFunction(() => globalThis.FlowStudioFlowSession && globalThis.FlowStudioFlowBlocks &&
  globalThis.FlowStudioEditor && FlowStudioEditor.editor && globalThis.FlowStudioMonaco);
await page.evaluate(async () => { await FlowStudioFlowSession.client.reset(); });
await page.evaluate(() => {
  const select = document.getElementById('language');
  select.value = 'flow';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});

const PROGRAM = [
  'struct Obs {',
  '    x: f64,',
  '    y: f64',
  '}',
  '',
  'function main() -> i32 {',
  '    let xs: array<f64, 4> = [1.0, 2.0, 3.0, 4.0]',
  '    let obs: array<Obs, 3> = [Obs { x: 1.0, y: 2.0 }, Obs { x: 2.0, y: 4.1 }, Obs { x: 3.0, y: 5.9 }]',
  '    let m: f64 = python(xs) {',
  '        import statistics',
  '        values = {"first": xs[0], "rest": list(xs[1:])}',
  '        statistics.fmean(xs)',
  '    }',
  '    let slope: f64 = r(obs) { unname(coef(lm(y ~ x, data = obs))[2]) }',
  '    let scaled: array<f64, 4> = python(xs, k = slope) -> array<f64, 4> { [v * k for v in xs] }',
  '    printf("blocks: %.2f %.2f %.2f\\n", m, slope, scaled[3])',
  '    return 0',
  '}',
  ''
].join('\n');

const setText = (text, line = 1, column = 1) => page.evaluate(([value, lineNumber, col]) => {
  const editor = FlowStudioEditor.editor;
  editor.setValue(value);
  editor.setPosition({ lineNumber, column: col });
  editor.focus();
}, [text, line, column]);
await setText(PROGRAM);

// 1. Highlighting: the block's code is tokenized as Python and R, the Flow
// around it as Flow.
const tokens = await page.evaluate(text => {
  const monaco = FlowStudioMonaco;
  const lines = monaco.editor.tokenize(text, 'flow');
  return lines.map((line, index) => line.map((token, i) => {
    const end = i + 1 < line.length ? line[i + 1].offset : text.split('\n')[index].length;
    return { text: text.split('\n')[index].slice(token.offset, end), type: token.type, language: token.language };
  }));
}, PROGRAM);
const tokenOf = (line, text) => tokens[line - 1].find(token => token.text.trim() === text);
// Monaco loads the Python and R grammars on first use; tokenize again once they are in.
await page.waitForFunction(text => {
  const lines = FlowStudioMonaco.editor.tokenize(text, 'flow');
  return lines[9].some(token => token.language === 'python' && /keyword/.test(token.type));
}, PROGRAM, { timeout: 15000 });
const settled = await page.evaluate(text => FlowStudioMonaco.editor.tokenize(text, 'flow').map(line =>
  line.map(token => ({ offset: token.offset, type: token.type, language: token.language }))), PROGRAM);
const at = (line, word) => {
  const offset = PROGRAM.split('\n')[line - 1].indexOf(word);
  const list = settled[line - 1];
  let found = list[0];
  for (const token of list) if (token.offset <= offset) found = token;
  return found;
};
assert.equal(at(10, 'import').language, 'python', 'import inside the python block is Python');
assert.match(at(10, 'import').type, /keyword/);
assert.equal(at(11, '"first"').language, 'python');
assert.match(at(11, '"first"').type, /string/);
assert.equal(at(14, 'lm(').language, 'r', 'the one-line r block is R');
assert.equal(at(14, 'unname').language, 'r');
assert.equal(at(9, 'let').language, 'flow', 'the opening line is Flow');
assert.match(at(9, 'let').type, /keyword/);
assert.equal(at(13, '}').language, 'flow', 'the closing brace is Flow');
assert.equal(at(16, 'printf').language, 'flow', 'Flow resumes after the block');
assert.equal(at(15, 'for').language, 'python', 'the inline python block');
assert.ok(tokenOf(9, 'let'), 'tokens were read');

// The rendered line shows the Python keyword in the theme's keyword colour
// (B4A4E5, the 'keyword' rule of the flowstudio theme).
await page.evaluate(() => FlowStudioEditor.editor.revealLine(10));
await page.waitForTimeout(300);
const colours = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('#monacoHost .view-line span span'));
  const colour = text => {
    const span = spans.find(node => node.textContent === text);
    return span ? getComputedStyle(span).color : null;
  };
  return { importColour: colour('import'), statistics: colour('statistics') };
});
assert.equal(colours.importColour, 'rgb(180, 164, 229)', 'Python keywords use the keyword colour');
assert.notEqual(colours.importColour, colours.statistics);

// Bracket matching inside the block: the cursor after "(" in "list(" matches
// its ")"; the block's own braces match each other.
const bracketPairs = async (line, column) => {
  await page.evaluate(([lineNumber, col]) => {
    FlowStudioEditor.editor.setPosition({ lineNumber, column: col });
    FlowStudioEditor.editor.focus();
  }, [line, column]);
  await page.waitForTimeout(250);
  return page.evaluate(() => FlowStudioEditor.editor.getModel().getAllDecorations()
    .filter(d => /bracket-match/.test(d.options.className || ''))
    .map(d => [d.range.startLineNumber, d.range.startColumn]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
};
const line11 = PROGRAM.split('\n')[10];
const open = line11.indexOf('list(') + 5;          // 1-based column of that (
const pairs = await bracketPairs(11, open + 1);
assert.deepEqual(pairs, [[11, open], [11, line11.indexOf('])') + 2]], 'parentheses inside the block match');
const braces = await bracketPairs(9, PROGRAM.split('\n')[8].length + 1);
assert.deepEqual(braces, [[9, PROGRAM.split('\n')[8].length], [13, 5]], 'the block braces match');

// 2. Hover on a value passed to a block shows its Flow type.
await page.waitForFunction(() => globalThis.FlowStudioFlowLsp && FlowStudioFlowLsp.state() === 'ready', null, { timeout: 60000 });
await page.waitForTimeout(1200);
const hover = async (line, word, expected) => {
  // word starts one character before the name: the name's first letter.
  const column = PROGRAM.split('\n')[line - 1].indexOf(word) + 2;
  const point = await page.evaluate(([lineNumber, col]) => {
    const editor = FlowStudioEditor.editor;
    editor.revealLine(lineNumber);
    const position = editor.getScrolledVisiblePosition({ lineNumber, column: col });
    const box = editor.getDomNode().getBoundingClientRect();
    return { x: box.left + position.left + 2, y: box.top + position.top + position.height / 2 };
  }, [line, column]);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(150);
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(pattern => new RegExp(pattern).test(Array.from(document.querySelectorAll('.monaco-hover'))
    .map(node => node.textContent).join(' ')), expected, { timeout: 15000 });
  await page.mouse.move(5, 5);
};
await hover(9, '(xs', 'xs: array<f64');
await hover(14, '(obs', 'obs: array<Obs');
// The language server sees no error in a program whose blocks are right.
const lspMarkers = await page.evaluate(() => FlowStudioMonaco.editor.getModelMarkers({})
  .filter(marker => marker.owner === 'flow-lsp' && marker.severity >= 8).map(marker => marker.message));
assert.deepEqual(lspMarkers, []);

// 3. Run from the editor.
const transcript = () => page.evaluate(() => document.querySelector('.terminal-transcript').textContent);
const runAndWait = async (click, expected) => {
  const before = (await transcript()).length;
  await click();
  await page.waitForFunction(([size, pattern]) => {
    const now = document.querySelector('.terminal-transcript').textContent;
    return now.length > size && new RegExp(pattern).test(now.slice(size)) &&
      !/^Running/.test(document.getElementById('resultStatus').textContent);
  }, [before, expected], { timeout: 120000 });
  return (await transcript()).slice(before);
};
let output = await runAndWait(() => page.click('#run'), 'blocks: ');
assert.match(output, /blocks: 2\.50 1\.95 7\.80/);

// A Python error names the Flow line inside the block.
await setText(PROGRAM.replace('statistics.fmean(xs)', 'statistics.fmean(xs) / 0'));
output = await runAndWait(() => page.click('#run'), 'line 12');
assert.match(output, /line 12: Python error: ZeroDivisionError: float division by zero/);

// 4. The console session: Ctrl+Enter sends a statement holding a block.
const SCRIPT = [
  'let ys: array<f64, 3> = [3.0, 1.0, 2.0]',
  'let sorted: array<f64, 3> = python(ys) -> array<f64, 3> {',
  '    sorted(ys)',
  '}',
  'let spread: f64 = r(ys) { diff(range(ys)) }',
  'spread'
].join('\n');
await setText(SCRIPT);
const send = expected => runAndWait(() => page.keyboard.press('Control+Enter'), expected);
await send('');
assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), 2);
await send('');
assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), 5,
  'Ctrl+Enter sends the whole block and moves past it');
await send('');
output = await send('2\\.0');
assert.match(output, /2\.0/);
const variables = await page.evaluate(() => FlowStudioFlowSession.client.variables()
  .map(v => [v.name, v.type, v.display]));
assert.deepEqual(variables, [['ys', 'array<f64, 3>', '[3.0, 1.0, 2.0]'], ['sorted', 'array<f64, 3>', '[1.0, 2.0, 3.0]'],
  ['spread', 'f64', '2.0']]);

// The console prompt takes a one-line block too.
await page.evaluate(() => FlowStudioTerminal.show('console'));
const prompt = page.locator('.terminal-prompt-line textarea');
await prompt.click();
await prompt.fill('python(sorted, spread) -> f64 { sum(sorted) * spread }');
output = await runAndWait(() => prompt.press('Enter'), '12\\.0');
assert.match(output, /12\.0/);

// 5. Hover in a script: a session variable passed to a block.
await setText('let total: f64 = python(sorted) -> f64 { sum(sorted) }\ntotal\n');
await page.waitForTimeout(1200);
{
  const line = 'let total: f64 = python(sorted) -> f64 { sum(sorted) }';
  const point = await page.evaluate(column => {
    const editor = FlowStudioEditor.editor;
    const position = editor.getScrolledVisiblePosition({ lineNumber: 1, column });
    const box = editor.getDomNode().getBoundingClientRect();
    return { x: box.left + position.left + 2, y: box.top + position.top + position.height / 2 };
  }, line.indexOf('sorted') + 2);
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => /sorted: array<f64/.test(Array.from(document.querySelectorAll('.monaco-hover'))
    .map(node => node.textContent).join(' ')), null, { timeout: 15000 });
  await page.mouse.move(5, 5);
}

// 6. Check Flow marks a block's type error on its line, and nothing else.
await setText('let a: i32 = 2\nlet s: f64 = python(a) -> string {\n    str(a)\n}\nlet t: string = r(a) { a * 2 }\n');
await page.click('#checkFlow');
await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getAllDecorations()
  .some(d => d.options.inlineClassName === 'flowstudio-flow-error'), null, { timeout: 60000 });
const marked = await page.evaluate(() => FlowStudioEditor.editor.getModel().getAllDecorations()
  .filter(d => d.options.inlineClassName === 'flowstudio-flow-error').map(d => d.range.startLineNumber));
assert.deepEqual([...new Set(marked)], [2], 'the wrong result type is marked on the block line');

await page.evaluate(async () => { await FlowStudioFlowSession.client.reset(); });
assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: blocks highlight as Python and R with matching brackets, hover shows passed Flow types, Run returns ' +
  'typed values and maps a Python error to its line, Ctrl+Enter and the console prompt send blocks, Check Flow marks the line');
