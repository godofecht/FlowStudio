import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  let executions = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/(run|eval)\//.test(request.url())) executions++;
  });
  const url = process.env.FLOWSTUDIO_URL || 'http://127.0.0.1:8751';
  await page.goto(url);
  await page.waitForFunction(() => !!globalThis.FlowStudioEditor);
  await page.click('#dockView-console');
  await page.evaluate(() => {
    const select = document.getElementById('language');
    select.value = 'python';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const input = page.locator('#consoleInput');
  for (const code of ['print("history_first")', 'print("history_second")']) {
    await input.fill(code);
    await input.press('Enter');
    await page.waitForFunction(() => !document.getElementById('consoleInput').disabled);
    assert.equal(await input.inputValue(), '');
  }
  const submitted = executions;
  assert.equal(submitted, 2);
  await input.fill('print');
  await input.press('Control+r');
  assert.equal(await input.inputValue(), 'print("history_second")');
  await input.press('Control+r');
  assert.equal(await input.inputValue(), 'print("history_first")');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  assert.equal(await input.inputValue(), 'print');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(executions, submitted);
  assert.equal(page.url().replace(/\/$/, ''), url.replace(/\/$/, ''));
  assert.deepEqual(errors, []);
  console.log('PASS: real native Python console execution and reverse history recall with clean runtime logs');
} finally { await browser.close(); }
