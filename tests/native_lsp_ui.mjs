/* Real Chromium acceptance for the Flow language server in the editor,
 * against the running native server: node tests/native_lsp_ui.mjs
 *
 * Opens a Flow buffer, then checks hover, completion, F12, F2 rename,
 * Shift+Alt+F formatting and a typed type error, all answered by `flow lsp`
 * through /api/lsp/*. FLOWSTUDIO_LSP_BLOCK=1 answers those routes with 503,
 * which must make this test fail: it proves the checks need the server. */
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
page.on('dialog', dialog => dialog.accept());
if (process.env.FLOWSTUDIO_LSP_BLOCK === '1')
  await page.route('**/api/lsp/**', route => route.fulfill({ status: 503, body: 'blocked for this run' }));

const SOURCE = [
  'function add_one(x: i32) -> i32 {',
  '    return x + 1',
  '}',
  '',
  'function main() -> i32 {',
  '    let y: i32 = add_one(2)',
  '    let z: i32 = add_one(y)',
  '    return z',
  '}',
  ''].join('\n');

try {
  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioFlowLsp &&
    FlowStudioFlowLsp.state() !== 'idle' && FlowStudioFlowLsp.state() !== 'starting', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => FlowStudioFlowLsp.state()), 'ready', 'the Flow language server is not running');

  await page.evaluate(source => {
    const app = FlowStudioApp;
    const opened = app.documents.open({ name: 'lsp_demo.flow', path: 'lsp/lsp_demo.flow', text: source,
      baseline: source, language: 'flow' });
    app.activateDocument(opened.document.id);
  }, SOURCE);
  await page.waitForFunction(() => {
    const model = FlowStudioEditor.editor.getModel();
    return model && model.getLanguageId() === 'flow' && model.getValue().includes('add_one') &&
      FlowStudioFlowLsp.handles(model);
  });
  assert.equal(await page.evaluate(() => FlowStudioFlowLsp.uriFor(FlowStudioEditor.editor.getModel())),
    'file:///flowstudio/lsp/lsp_demo.flow');

  const point = (lineNumber, column) => page.evaluate(([lineNumber, column]) => {
    const editor = FlowStudioEditor.editor;
    editor.revealLineInCenter(lineNumber);
    const at = editor.getScrolledVisiblePosition({ lineNumber, column });
    const box = editor.getDomNode().getBoundingClientRect();
    return { x: box.left + at.left + 3, y: box.top + at.top + at.height / 2 };
  }, [lineNumber, column]);
  const caret = (lineNumber, column) => page.evaluate(([lineNumber, column]) => {
    FlowStudioEditor.editor.setPosition({ lineNumber, column });
    FlowStudioEditor.editor.focus();
  }, [lineNumber, column]);
  const value = () => page.evaluate(() => FlowStudioEditor.editor.getModel().getValue());
  const setValue = text => page.evaluate(text => FlowStudioEditor.editor.getModel().setValue(text), text);

  // Hover shows the typechecked signature.
  const hoverAt = await point(6, 19);
  await page.mouse.move(hoverAt.x, hoverAt.y);
  await page.waitForFunction(() => [...document.querySelectorAll('.monaco-hover')]
    .some(node => node.textContent.includes('function add_one(x: i32) -> i32')), null, { timeout: 10000 });
  assert.match(await page.locator('.monaco-hover').first().textContent(), /typechecked function/);
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');

  // Completion lists the local function exactly once, then inserts it.
  await caret(8, 13);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('add_');
  await page.keyboard.press('Control+Space');
  const row = page.locator('.suggest-widget .monaco-list-row', { hasText: 'add_one' });
  await row.first().waitFor({ timeout: 10000 });
  assert.equal(await row.count(), 1, 'one add_one item: the lexical Flow completion stays out of the way');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getLineContent(8) === '    return add_one');
  await setValue(SOURCE);

  // F12 jumps to the definition.
  await caret(6, 19);
  await page.keyboard.press('F12');
  await page.waitForFunction(() => FlowStudioEditor.editor.getPosition().lineNumber === 1, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().column), 1);

  // F2 renames every occurrence.
  await caret(1, 12);
  await page.keyboard.press('F2');
  const input = page.locator('.rename-box input');
  await input.waitFor({ timeout: 10000 });
  assert.equal(await input.inputValue(), 'add_one');
  await input.fill('increment');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const text = FlowStudioEditor.editor.getModel().getValue();
    return !text.includes('add_one') && text.split('increment').length === 4;
  }, null, { timeout: 10000 });

  // Shift+Alt+F formats the document.
  await setValue('function main() -> i32 {\nlet y: i32 = 1\n        return y\n}\n');
  await caret(1, 1);
  await page.keyboard.press('Shift+Alt+F');
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getValue() ===
    'function main() -> i32 {\n    let y: i32 = 1\n    return y\n}\n', null, { timeout: 10000 });

  // A typed type error becomes a marker from the server.
  await setValue(SOURCE);
  await page.evaluate(() => {
    FlowStudioEditor.editor.setSelection({ startLineNumber: 2, startColumn: 12, endLineNumber: 2, endColumn: 17 });
    FlowStudioEditor.editor.focus();
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('"one');   // the editor closes the quote
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getModel().getLineContent(2)), '    return "one"');
  await page.waitForFunction(() => FlowStudioMonaco.editor.getModelMarkers({ owner: 'flow-lsp' })
    .some(marker => /non-i32/.test(marker.message) && marker.startLineNumber === 2), null, { timeout: 10000 });
  await page.locator('.monaco-editor .squiggly-warning').first().waitFor({ timeout: 5000 });
  const markers = await page.evaluate(() => FlowStudioMonaco.editor.getModelMarkers({
    resource: FlowStudioEditor.editor.getModel().uri }).map(marker => marker.owner));
  assert.ok(markers.length >= 1 && markers.every(owner => owner === 'flow-lsp'), 'only the server marks problems: ' + markers);
  // Fixing it clears the marker.
  await setValue(SOURCE);
  await page.waitForFunction(() => FlowStudioMonaco.editor.getModelMarkers({ owner: 'flow-lsp' }).length === 0,
    null, { timeout: 10000 });

  assert.deepEqual(errors, [], 'browser console errors');
  console.log('PASS native_lsp_ui: hover, completion, F12, F2 rename, Shift+Alt+F format, diagnostics');
} finally {
  await browser.close();
}
