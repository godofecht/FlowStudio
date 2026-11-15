/* Real Chromium acceptance for Flow imports between project files, against
 * the running native server: node tests/native_lsp_project_ui.mjs
 *
 * A project folder in the browser's private file system holds lib/util.flow,
 * main.flow (which imports it) and script.flow (no main(), imports it too).
 * Opened through the explorer, hover, completion, F12, Shift+F12 and
 * diagnostics must reach across the files through `flow lsp`. F12 into
 * util.flow happens before util.flow has a tab. An unsaved edit in util.flow
 * must change what main.flow sees. FLOWSTUDIO_LSP_BLOCK=1 answers the
 * language server routes with 503, which must make this test fail. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751/';
const FOLDER = 'lsp-imports-' + Math.random().toString(36).slice(2, 8);
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];

const UTIL = [
  '# Adds one to x.',
  'export function add_one(x: i32) -> i32 {',
  '    return x + 1',
  '}',
  ''].join('\n');
const MAIN = [
  'import "lib/util.flow"',
  '',
  'function main() -> i32 {',
  '    let y: i32 = add_one(2)',
  '    return y',
  '}',
  ''].join('\n');
const SCRIPT = [
  'import "lib/util.flow"',
  '',
  'let base: i32 = 40',
  'let total: i32 = add_one(base)',
  'println(total)',
  ''].join('\n');

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(folder => {
    globalThis.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(folder, { create: true });
    };
  }, FOLDER);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/status of (410|422|503)/.test(message.text())) errors.push('console: ' + message.text());
  });
  page.on('dialog', dialog => dialog.accept());
  if (process.env.FLOWSTUDIO_LSP_BLOCK === '1')
    await page.route('**/api/lsp/**', route => route.fulfill({ status: 503, body: 'blocked for this run' }));

  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioEditor?.editor && globalThis.FlowStudioWorkspaceExplorer &&
    globalThis.FlowStudioFlowLsp && !['idle', 'starting'].includes(FlowStudioFlowLsp.state()), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => FlowStudioFlowLsp.state()), 'ready', 'the Flow language server is not running');

  await page.evaluate(async ([folder, files]) => {
    const root = await navigator.storage.getDirectory();
    const proj = await root.getDirectoryHandle(folder, { create: true });
    const lib = await proj.getDirectoryHandle('lib', { create: true });
    const write = async (dir, name, text) => {
      const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writer.write(text);
      await writer.close();
    };
    await write(lib, 'util.flow', files.util);
    await write(proj, 'main.flow', files.main);
    await write(proj, 'script.flow', files.script);
  }, [FOLDER, { util: UTIL, main: MAIN, script: SCRIPT }]);

  const row = rel => page.locator(`#explorer .ex-row[data-rel="${rel}"]`);
  const tab = name => page.locator('#docTabs [role="tab"]', { hasText: name }).first();
  const label = () => page.locator('#fileLabel').textContent();
  const setText = text => page.evaluate(text => FlowStudioEditor.editor.getModel().setValue(text), text);
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
  const position = () => page.evaluate(() => {
    const at = FlowStudioEditor.editor.getPosition();
    return [at.lineNumber, at.column];
  });
  const hoverText = async (lineNumber, column, wanted) => {
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    const at = await point(lineNumber, column);
    await page.mouse.move(at.x, at.y);
    await page.waitForFunction(wanted => [...document.querySelectorAll('.monaco-hover')]
      .some(node => node.textContent.includes(wanted)), wanted, { timeout: 10000 });
    const text = await page.evaluate(() => [...document.querySelectorAll('.monaco-hover')]
      .map(node => node.textContent).join('\n'));
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    return text;
  };
  const markers = () => page.evaluate(() => FlowStudioMonaco.editor.getModelMarkers({
    owner: 'flow-lsp', resource: FlowStudioEditor.editor.getModel().uri })
    .map(marker => [marker.startLineNumber, marker.message]));
  const waitForMarker = message => page.waitForFunction(message => FlowStudioMonaco.editor.getModelMarkers({
    owner: 'flow-lsp', resource: FlowStudioEditor.editor.getModel().uri }).some(marker => marker.message === message),
  message, { timeout: 10000 });

  // ---- open the project and main.flow through the explorer ---------------
  await page.locator('#explorer [data-action="openFolder"]').click();
  await row('main.flow').waitFor({ timeout: 10000 });
  await row('main.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('add_one(2)') &&
    FlowStudioFlowLsp.handles(FlowStudioEditor.editor.getModel()));
  assert.equal(await page.evaluate(() => FlowStudioFlowLsp.uriFor(FlowStudioEditor.editor.getModel())),
    `file:///flowstudio/${FOLDER}/main.flow`);
  await page.waitForFunction(folder => FlowStudioFlowLsp.projectFiles().includes(
    `file:///flowstudio/${folder}/lib/util.flow`), FOLDER, { timeout: 10000 });

  // ---- hover on an imported function -----------------------------------
  const hover = await hoverText(4, 20, 'function add_one(x: i32) -> i32');
  assert.match(hover, /typechecked function/);
  assert.ok(hover.includes(`file:///flowstudio/${FOLDER}/lib/util.flow`), hover);
  assert.ok(!/flowstudio-lsp-|\/var\/folders|\/tmp\//.test(hover), 'no server path reaches the page: ' + hover);

  // ---- no unbound-call warning: the import resolved -------------------
  await page.waitForTimeout(1200);
  assert.deepEqual(await markers(), [], 'main.flow has no problems once util.flow is found');

  // ---- completion offers the imported function ------------------------
  await caret(4, 25);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');      // add_one(2) -> add_(2)
  await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget .monaco-list-row', { hasText: 'add_one' }).first().waitFor({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await setText(MAIN);

  // ---- F12 opens util.flow, which has no tab yet -----------------------
  assert.equal(await page.locator('#docTabs [role="tab"]', { hasText: 'util.flow' }).count(), 0,
    'util.flow starts without a tab');
  await caret(4, 20);
  await page.keyboard.press('F12');
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('export function add_one'), null, { timeout: 10000 });
  assert.match(await label(), new RegExp(FOLDER + '/lib/util\\.flow'));
  await page.waitForFunction(() => FlowStudioEditor.editor.getPosition().lineNumber === 2, null, { timeout: 5000 });
  assert.deepEqual(await position(), [2, 17], 'F12 lands on the name in util.flow');

  // ---- Shift+F12 in util.flow finds the use in main.flow ---------------
  // With one use besides the declaration, Monaco goes straight to it.
  await page.waitForFunction(() => FlowStudioFlowLsp.handles(FlowStudioEditor.editor.getModel()));
  await caret(2, 20);
  await page.keyboard.press('Shift+F12');
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('add_one(2)'), null, { timeout: 10000 });
  assert.match(await label(), new RegExp(FOLDER + '/main\\.flow'));
  assert.deepEqual(await position(), [4, 18], 'Shift+F12 lands on the call in main.flow');
  await tab('util.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('export function add_one'));

  // ---- an unsaved edit in util.flow reaches main.flow -------------------
  await setText(UTIL.replace('add_one', 'add_two'));
  await tab('main.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('add_one(2)'));
  await waitForMarker("unbound call 'add_one'");
  assert.deepEqual((await markers()).map(([line]) => line), [4]);
  // Putting the name back clears it again.
  await tab('util.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('add_two'));
  await setText(UTIL);
  await tab('main.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('add_one(2)'));
  await page.waitForFunction(() => FlowStudioMonaco.editor.getModelMarkers({ owner: 'flow-lsp',
    resource: FlowStudioEditor.editor.getModel().uri }).length === 0, null, { timeout: 10000 });

  // ---- a script without main(): lines still map -------------------------
  await row('script.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('let base') &&
    FlowStudioFlowLsp.handles(FlowStudioEditor.editor.getModel()));
  const scriptHover = await hoverText(4, 20, 'function add_one(x: i32) -> i32');
  assert.ok(scriptHover.includes('lib/util.flow'), scriptHover);
  // F12 on a top-level variable lands on its own line in the script.
  await caret(4, 28);
  await page.keyboard.press('F12');
  await page.waitForFunction(() => FlowStudioEditor.editor.getPosition().lineNumber === 3, null, { timeout: 10000 });
  assert.deepEqual(await position(), [3, 5], 'F12 on base lands on its let');
  // F12 on the imported call goes to util.flow.
  await caret(4, 20);
  await page.keyboard.press('F12');
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('export function add_one'), null, { timeout: 10000 });
  assert.deepEqual(await position(), [2, 17]);
  // A problem on a moved statement is marked on its real line.
  await tab('script.flow').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getValue().includes('let base'));
  await setText(SCRIPT.replace('add_one(base)', 'add_three(base)'));
  await waitForMarker("unbound call 'add_three'");
  assert.deepEqual((await markers()).map(([line]) => line), [4], 'the marker sits on the script line');
  await setText(SCRIPT);

  assert.deepEqual(errors, [], 'browser console errors');
  console.log('PASS native_lsp_project_ui: imports across project files (hover, completion, F12, Shift+F12, diagnostics, scripts)');
} finally {
  await browser.close();
}
