/* Real Chromium + native Flow/R acceptance for Monaco $ completion. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8751', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.FlowStudioEditor?.editor));
  const run = await page.evaluate(async () => {
    const response = await fetch('/api/run/r', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' },
      body: 'analysis <- list(model=list(score=1.0, scale=2.0))'
    });
    return { status: response.status, body: await response.text() };
  });
  assert.equal(run.status, 200, run.body);
  const inspection = await page.evaluate(async () => {
    const response = await fetch('/api/inspect/r', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-FlowStudio-Intent': 'run' },
      body: ''
    });
    if (!response.ok) throw new Error('R inspector failed: ' + response.status);
    return response.json();
  });
  assert.ok(inspection.variables.some(variable => variable.name === 'analysis'),
    'real R inspector did not expose the created list');
  await page.locator('#language').selectOption('r');
  await page.evaluate(() => {
    const editor = globalThis.FlowStudioEditor.editor;
    editor.setValue('analysis$model$sc');
    editor.setPosition({ lineNumber: 1, column: editor.getModel().getLineMaxColumn(1) });
    editor.focus();
  });
  await page.keyboard.press('Control+Space');
  await page.waitForFunction(() => {
    const widget = document.querySelector('.suggest-widget');
    return widget && widget.textContent.includes('score');
  }, null, { timeout: 15000 });
  await page.locator('.suggest-widget .monaco-list-row').filter({ hasText: 'score' }).first().click();
  assert.equal(await page.evaluate(() => globalThis.FlowStudioEditor.editor.getValue()),
    'analysis$model$score');
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS: real R list inspection, native Monaco $ completion and correct member insertion');
} finally {
  await browser.close();
}
