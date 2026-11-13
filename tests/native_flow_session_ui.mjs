/* Real Chromium acceptance for the Flow console session against the running
 * native server: node tests/native_flow_session_ui.mjs
 *
 * Ctrl+Enter sends the statement under the cursor to the console and moves
 * to the next one. Values, functions and structs persist; the Environment
 * pane lists the Flow variables; the console prompt reaches the same
 * session; resetting from the console menu forgets it. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', error => errors.push('pageerror: ' + error.message));
page.on('console', message => {
  if (message.type() === 'error' && !/status of (410|422|503)/.test(message.text())) errors.push('console: ' + message.text());
});
await page.goto(URL);
await page.waitForFunction(() => globalThis.FlowStudioFlowSession && globalThis.FlowStudioConsoleSubmit &&
  globalThis.FlowStudioEditor && FlowStudioEditor.editor);
await page.evaluate(async () => { await FlowStudioFlowSession.client.reset(); });
await page.evaluate(() => {
  const select = document.getElementById('language');
  select.value = 'flow';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});

const SCRIPT = [
  'let x = 41',
  'function sq(n: i32) -> i32 {',
  '    return n * n',
  '}',
  'struct Point {',
  '    x: f64',
  '    y: f64',
  '}',
  'let p = Point { x: 1.5, y: -2.0 }',
  'sq(x) + 1'
].join('\n');
await page.evaluate(text => {
  const editor = FlowStudioEditor.editor;
  editor.setValue(text);
  editor.setPosition({ lineNumber: 1, column: 1 });
  editor.focus();
}, SCRIPT);

const transcript = () => page.evaluate(() => document.querySelector('.terminal-transcript').textContent);
const cursorLine = () => page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber);
const send = async expected => {
  const before = (await transcript()).length;
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(([size, text]) => {
    const now = document.querySelector('.terminal-transcript').textContent;
    return now.length > size && document.getElementById('resultStatus').dataset.state !== '' &&
      !/^Running/.test(document.getElementById('resultStatus').textContent) && (!text || now.includes(text));
  }, [before, expected], { timeout: 60000 });
};

await send();
assert.equal(await cursorLine(), 2, 'the cursor moves to the next statement');
await send();
assert.equal(await cursorLine(), 5, 'a whole function is sent at once');
await send();
await send();
assert.equal(await cursorLine(), 10);
await send('1682');
assert.match(await transcript(), /1682/, 'the value of the last expression is shown');

// The Environment pane lists the Flow variables.
await page.evaluate(() => FlowStudioSidePanel.show('environment'));
await page.waitForSelector('#pythonEnvironment table.flow-env tr[data-name="p"]');
const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#pythonEnvironment table.flow-env tr[data-name]'))
  .map(row => Array.from(row.children).map(cell => cell.textContent)));
assert.deepEqual(rows, [['x', 'i32', '41'], ['p', 'Point', 'Point { x: 1.5, y: -2.0 }']]);

// The console prompt reaches the same session.
const prompt = page.locator('.terminal-prompt-line textarea');
await prompt.click();
await prompt.fill('p.x * 4.0');
const before = (await transcript()).length;
await prompt.press('Enter');
await page.waitForFunction(size => document.querySelector('.terminal-transcript').textContent.length > size &&
  /6\.0/.test(document.querySelector('.terminal-transcript').textContent.slice(size)), before, { timeout: 60000 });

// A selection runs just that text.
await page.evaluate(() => {
  const editor = FlowStudioEditor.editor;
  editor.setValue('let y = x * 2\nlet z = y + 1');
  editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 14 });
  editor.focus();
});
await send();
const names = await page.evaluate(() => FlowStudioFlowSession.client.variables().map(v => v.name));
assert.deepEqual(names, ['x', 'p', 'y']);

// A program with main() still runs as a whole program.
await page.evaluate(() => {
  const editor = FlowStudioEditor.editor;
  editor.setValue('function main() -> i32 {\n    println("whole program")\n    return 0\n}\n');
  editor.setPosition({ lineNumber: 2, column: 5 });
  editor.focus();
});
await page.keyboard.press('Control+Enter');
await page.waitForFunction(() => /whole program/.test(document.querySelector('.terminal-transcript').textContent) ||
  /whole program/.test(document.body.textContent), null, { timeout: 60000 });
assert.deepEqual(await page.evaluate(() => FlowStudioFlowSession.client.variables().map(v => v.name)), ['x', 'p', 'y']);

// In a script, Flow's language server knows the session's variables:
// hovering p shows its struct type, though p was defined in an earlier entry.
await page.evaluate(() => {
  const editor = FlowStudioEditor.editor;
  editor.setValue('let w = p.x + 1.0\nlet bad: i32 = "text"\nw\n');
  editor.setPosition({ lineNumber: 1, column: 1 });
});
await page.waitForFunction(() => globalThis.FlowStudioFlowLsp && FlowStudioFlowLsp.state() === 'ready', null, { timeout: 30000 });
await page.waitForTimeout(800);
const point = await page.evaluate(() => {
  const editor = FlowStudioEditor.editor;
  const at = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 10 });
  const box = editor.getDomNode().getBoundingClientRect();
  return { x: box.left + at.left + 3, y: box.top + at.top + at.height / 2 };
});
await page.mouse.move(point.x, point.y);
await page.waitForFunction(() => /Point/.test(Array.from(document.querySelectorAll('.monaco-hover')).map(n => n.textContent).join(' ')),
  null, { timeout: 15000 });
await page.mouse.move(5, 5);

// Check Flow checks a script the way the session runs it, and marks the line.
await page.click('#checkFlow');
await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getAllDecorations()
  .some(d => d.options.inlineClassName === 'flowstudio-flow-error' && d.range.startLineNumber === 2), null, { timeout: 60000 });
const marked = await page.evaluate(() => FlowStudioEditor.editor.getModel().getAllDecorations()
  .filter(d => d.options.inlineClassName === 'flowstudio-flow-error').map(d => d.range.startLineNumber));
assert.deepEqual(marked, [2], 'only the wrong let is marked');

// Reset from the console menu, which asks to confirm first.
await page.evaluate(() => FlowStudioTerminal.show('console'));
await page.click('#terminalMenuToggle');
await page.click('#terminalMenuReset');
await page.click('#terminalMenuReset');
await page.waitForFunction(() => /state reset/.test(document.querySelector('.terminal-transcript').textContent));
const state = await page.evaluate(async () => FlowStudioFlowSession.client.state());
assert.deepEqual(state.variables, []);

assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: Ctrl+Enter sends statements and moves on, values and definitions persist, Environment lists Flow variables, ' +
  'console prompt shares the session, selection runs alone, main() runs whole, reset clears');
