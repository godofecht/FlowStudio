/* Real Chromium acceptance for Run and Debug and the Examples view against the
 * running native server: node tests/native_debugger_ui.mjs
 *
 * Flow debugging runs LLDB on a source-mapped build; it is skipped, and the
 * skip is printed, where LLDB with Python support is not installed. Python
 * and R debugging use the persistent kernels. */
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
await page.goto(URL);
await page.waitForFunction(() => globalThis.FlowStudioDebugger && FlowStudioDebugger.instance);

const state = () => page.evaluate(() => document.getElementById('debugStatus').dataset.state);
const waitState = (value, timeout = 60000) => page.waitForFunction(v =>
  document.getElementById('debugStatus').dataset.state === v, value, { timeout });
const waitLine = (line, timeout = 30000) => page.waitForFunction(n =>
  document.getElementById('debugStatus').textContent === 'Paused at line ' + n, line, { timeout });
const vars = async () => (await page.locator('#debugVariables .dbg-var').allTextContents()).join('|');

// ---- Flow under LLDB ------------------------------------------------------
const probe = await page.evaluate(async () => {
  const response = await fetch('/api/debug/flow/status', { method: 'POST', headers: { 'X-FlowStudio-Intent': 'run' } });
  try { return response.ok && (await response.json()).lldb === true; } catch (_) { return false; }
});
let flowChecked = false;
if (probe) {
  flowChecked = true;
  await page.locator('#tab-examples').click();
  await page.locator('.ex-chip[data-category="debug"]').click();
  await page.locator('.example-card[data-example-id="debug-flow"] .ex-debug').click();
  await waitState('paused');
  assert.equal(await page.locator('#debugStatus').textContent(), 'Paused at line 12');
  assert.match(await vars(), /total:?0\|i:?1/);
  assert.equal(await page.locator('#debugToolbar').isVisible(), true);
  assert.ok(await page.locator('.monaco-editor .dbg-line-current').count() > 0);
  await page.keyboard.press('F11');                               // into square()
  await waitLine(4);
  assert.deepEqual(await page.locator('#debugCallStack .dbg-frame-name').allTextContents(), ['square', 'main']);
  await page.locator('#debugConsoleInput').fill('n * 10');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /^10 {2}\(int\)$/m.test(document.getElementById('debugConsoleOutput').textContent));
  await page.locator('#debugContinue').click();                   // next loop iteration
  await waitLine(12);
  assert.match(await vars(), /total:?1\|i:?2/);
  // A gutter click removes the breakpoint; F5 then runs to the end.
  const gutter = await page.evaluate(() => {
    const editor = FlowStudioEditor.editor, layout = editor.getLayoutInfo();
    const box = document.getElementById('monacoHost').getBoundingClientRect();
    return { x: box.left + layout.glyphMarginLeft + layout.glyphMarginWidth / 2,
      y: box.top + editor.getTopForLineNumber(12) - editor.getScrollTop() + 10 };
  });
  await page.mouse.click(gutter.x, gutter.y);
  assert.equal(await page.locator('#debugBreakpoints .dbg-bp-row').count(), 0);
  await page.keyboard.press('F5');
  await waitState('done');
  assert.match(await page.locator('#debugConsoleOutput').textContent(), /total 14/);
  assert.equal(await page.locator('#debugToolbar').isHidden(), true);
} else {
  console.log('SKIP: Flow debugging (LLDB with Python support is not available here)');
}

// ---- Python: a breakpoint from the example, step out to the caller --------
await page.locator('#tab-examples').click();
await page.locator('.ex-chip[data-category="debug"]').click();
await page.locator('.example-card[data-example-id="debug-python"] .ex-debug').click();
await waitState('paused');
assert.equal(await page.locator('#debugStatus').textContent(), 'Paused at line 6');
assert.deepEqual(await page.locator('#debugCallStack .dbg-frame-name').allTextContents(), ['mean', '<module>']);
await page.keyboard.press('Shift+F11');
await page.waitForFunction(() => !/line 6/.test(document.getElementById('debugStatus').textContent));
await page.keyboard.press('Shift+F5');
await waitState('idle');

// ---- R: run to the breakpoint, evaluate, step, finish ---------------------
await page.locator('#tab-examples').click();
await page.locator('.example-card[data-example-id="debug-r"] .ex-debug').click();
await waitLine(5);
await page.locator('#debugConsoleInput').fill('mean(scores)');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /^79$/m.test(document.getElementById('debugConsoleOutput').textContent));
await page.keyboard.press('F10');
await waitLine(6);
await page.keyboard.press('F5');
await waitState('done');
assert.match(await page.locator('#debugConsoleOutput').textContent(), /average: 79/);

// ---- Examples: search, categories and a MathFlow simulation ---------------
await page.locator('#tab-examples').click();
await page.locator('.ex-chip[data-category="all"]').click();
const total = await page.locator('.curated-examples .example-card:not([hidden])').count();
assert.ok(total >= 40, `all examples listed (${total})`);
await page.locator('#examplesSearch').fill('navier smoke');
assert.equal(await page.locator('.curated-examples .example-card:not([hidden])').count(), 1);
await page.locator('.curated-examples .example-card:not([hidden]) .primary').click();
await page.waitForFunction(() => document.getElementById('mathFlowPlot').children.length > 0, null, { timeout: 90000 });
assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true', 'the simulation plot is shown');

// ---- Polyglot: a Flow program calls the live Python and R sessions ---------
await page.locator('#tab-examples').click();
await page.locator('#examplesSearch').fill('');
await page.locator('.ex-chip[data-category="polyglot"]').click();
await page.locator('.example-card[data-example-id="polyglot-flow-drives-both"] .primary').click();
await page.waitForFunction(() => /R: peak on day 36/.test(document.getElementById('console').textContent),
  null, { timeout: 120000 });
assert.match(await page.locator('#console').textContent(), /Python: mean infected share/);

assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: ' + (flowChecked ? 'Flow LLDB breakpoints, step into, evaluate, continue, gutter toggle; ' : '') +
  'Python breakpoint and step out; R run-to-breakpoint, evaluate and step; examples search, categories and MathFlow run; Flow calling Python and R from the gallery');
