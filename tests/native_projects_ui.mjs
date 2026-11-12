/* Real Chromium acceptance for projects, the app Preview with hot reload,
 * debugger inline values and the layout manager, against the running native
 * server: node tests/native_projects_ui.mjs
 *
 * The Preview steps need emcc for `flow wasm`; where it is missing they are
 * skipped and the skip is printed. */
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
await page.waitForFunction(() => globalThis.FlowStudioProjects && globalThis.FlowStudioAppPreview &&
  globalThis.FlowStudioDebugger && FlowStudioDebugger.instance && globalThis.FlowStudioLayout);
const tabs = () => page.evaluate(() => FlowStudioApp.documents.list().map(d => d.path || d.name));

// ---- Layout: the side panel starts hidden and the editor gets the width ----
assert.equal(await page.evaluate(() => FlowStudioLayout.isVisible('right')), false);
await page.keyboard.press('Control+b');
assert.equal(await page.evaluate(() => FlowStudioLayout.isVisible('sidebar')), false, 'Ctrl+B hides the sidebar');
await page.keyboard.press('Control+b');
assert.equal(await page.evaluate(() => FlowStudioLayout.isVisible('sidebar')), true);

// ---- A new graphics project replaces the untitled buffer ----
await page.evaluate(() => FlowStudioApp.commands.newProject());
await page.waitForSelector('#newProjectDialog[open]');
await page.locator('.np-template[data-template="flow-app"]').click();
const name = 'accept-app-' + Date.now();
await page.fill('#npName', name);
await page.click('#npCreate');
await page.waitForFunction(n => FlowStudioProjects.current() && FlowStudioProjects.current().name === n, name);
await page.waitForFunction(() => FlowStudioApp.documents.list().some(d => d.name === 'app.flow'));
assert.deepEqual(await tabs(), [name + '/app.flow'], 'only the new project is open');
assert.equal(await page.textContent('#projectName'), name);

// ---- Run opens the Preview; an edit hot-reloads it ----
const probe = await page.evaluate(async () => {
  const r = await fetch('/api/app/build', { method: 'POST', headers: { 'X-FlowStudio-Intent': 'run' },
    body: 'import "stdlib/gfx.flow"\nfunction main() -> i32 {\n    return 0\n}\n' });
  return r.json();
});
let previewChecked = false;
if (probe.ok) {
  previewChecked = true;
  await page.click('#run');
  await page.waitForFunction(() => document.getElementById('previewDot').dataset.state === 'live', null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => FlowStudioLayout.isVisible('right')), true, 'the side panel opened');
  const ballPixels = () => page.evaluate(() => {
    const frame = document.querySelector('#previewStage iframe.pv-frame:not(.pv-loading)');
    const canvas = frame && frame.contentDocument && frame.contentDocument.getElementById('canvas');
    if (!canvas) return -1;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 240 && data[i + 1] > 180 && data[i + 1] < 210 && data[i + 2] < 110) count++;
    return count;
  });
  await page.waitForFunction(() => {
    const frame = document.querySelector('#previewStage iframe.pv-frame');
    return Boolean(frame && frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.dataset.gfx === 'true');
  }, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  assert.ok(await ballPixels() > 100, 'the app draws its amber ball');
  const builds = await page.evaluate(() => FlowStudioAppPreview.builds());
  await page.evaluate(() => {
    const model = FlowStudioEditor.editor.getModel();
    model.setValue(model.getValue().replace('const BALL_R: i32 = 250', 'const BALL_R: i32 = 60'));
  });
  await page.waitForFunction(b => FlowStudioAppPreview.builds() > b, builds, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#previewStage iframe').length === 1, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  assert.equal(await ballPixels(), 0, 'the reloaded build draws the new colour');
  // A broken edit keeps the running build and links to the line.
  await page.evaluate(() => {
    const model = FlowStudioEditor.editor.getModel();
    model.setValue(model.getValue().replace('gfx_clear(g, 18, 20, 26)', 'gfx_clear(g, 18, 20)'));
  });
  await page.waitForSelector('#previewError:not([hidden]) .pv-error-row', { timeout: 30000 });
  assert.equal(await page.locator('#previewStage iframe').count(), 1, 'the last good build stays');
  await page.locator('.pv-error-row').first().click();
  assert.match(await page.textContent('#cursor'), /^Ln 31, Col 26$/);
} else {
  console.log('SKIP: app Preview (flow wasm unavailable: ' + String(probe.log || '').split('\n')[0] + ')');
}

// ---- Switching to an example closes this project's tabs ----
page.on('dialog', dialog => dialog.accept());
await page.click('#tab-examples');
await page.locator('.ex-chip[data-category="debug"]').click();
await page.locator('.example-card[data-example-id="debug-flow"] .example-file-btn').first().click();
const dialog = await page.waitForSelector('#projectDialog[open]', { timeout: 4000 }).catch(() => null);
if (dialog) await page.locator('#projectDialogActions button', { hasText: 'Discard' }).click();
await page.waitForFunction(() => FlowStudioProjects.current() && FlowStudioProjects.current().name === 'debug-flow');
await page.waitForFunction(() => FlowStudioApp.documents.list().length === 1);
assert.deepEqual(await tabs(), ['debug-flow/debug_me.flow']);
assert.equal(await page.evaluate(() => FlowStudioAppPreview.running()), false, 'the app stopped with its project');

// ---- Debug from the toolbar: inline values follow the program ----
const probeLldb = await page.evaluate(async () => {
  const r = await fetch('/api/debug/flow/status', { method: 'POST', headers: { 'X-FlowStudio-Intent': 'run' } });
  try { return r.ok && (await r.json()).lldb === true; } catch (_) { return false; }
});
if (probeLldb) {
  await page.evaluate(() => {
    const dbg = FlowStudioDebugger.instance, model = FlowStudioEditor.editor.getModel();
    dbg.breakpoints.clear(model); dbg.breakpoints.toggle(model, 12);
  });
  await page.click('#runDebug');
  await page.waitForFunction(() => document.getElementById('debugStatus').dataset.state === 'paused', null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => FlowStudioTerminal.view), 'debug', 'the Debug Console is shown');
  const inline = () => page.evaluate(() => Array.from(document.querySelectorAll('.monaco-editor .dbg-inline-value'))
    .map(node => getComputedStyle(node, '::after').content));
  await page.waitForFunction(() => document.querySelectorAll('.monaco-editor .dbg-inline-value').length > 0);
  assert.ok((await inline()).includes('"total = 0, i = 1"'), 'line 12 shows its values');
  await page.keyboard.press('F10');
  await page.waitForFunction(() => /line 13/.test(document.getElementById('debugStatus').textContent));
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.monaco-editor .dbg-inline-value'))
    .some(node => getComputedStyle(node, '::after').content === '"total = 1, i = 1"'));
  await page.keyboard.press('Shift+F5');
  await page.waitForFunction(() => document.querySelectorAll('.monaco-editor .dbg-inline-value').length === 0);
} else {
  console.log('SKIP: Flow debugging (LLDB with Python support is not available here)');
}

// ---- Narrow windows collapse the side panes instead of squeezing the editor ----
await page.evaluate(() => FlowStudioLayout.show('right'));
await page.setViewportSize({ width: 900, height: 800 });
await page.waitForTimeout(200);
const solved = await page.evaluate(() => FlowStudioLayout.solved());
assert.ok(solved.editor >= 360, 'editor keeps 360px: ' + solved.editor);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const phone = await page.evaluate(() => FlowStudioLayout.solved());
assert.deepEqual([phone.show.sidebar, phone.show.right], [false, false]);
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll');
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => FlowStudioLayout.hide('right'));

assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: new project replaces open tabs, ' + (previewChecked ? 'Preview build, hot reload and kept build on error, ' : '') +
  'example switch closes the previous project, ' + (probeLldb ? 'debug toolbar with inline values, ' : '') + 'layout collapse at 900 and 390');
