/* Real Chromium acceptance for the Assistant panel: node tests/native_assistant_ui.mjs
 *
 * Starts ./build/flowstudio on a free loopback port with the fake provider
 * (tests/fixtures/fake_assistant.py), which drives the real FlowStudio MCP
 * server. Covers Ctrl+I, streaming, tool lines, a proposal diff with Accept,
 * Run on a code block, Stop, and a clean browser console.
 * Set FLOWSTUDIO_URL to use a server you started with FLOWSTUDIO_ASSISTANT_FAKE. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

let server = null;
let URL = process.env.FLOWSTUDIO_URL;
if (!URL) {
  const port = await freePort();
  URL = 'http://127.0.0.1:' + port + '/';
  server = spawn(path.join(ROOT, 'build', 'flowstudio'), [], { cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, FLOWSTUDIO_PORT: String(port), FLOWSTUDIO_ASSISTANT_FAKE: path.join(ROOT, 'tests', 'fixtures', 'fake_assistant.py'),
      FLOWSTUDIO_ASSISTANT_TIMEOUT: '120' } });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL + 'health')).ok) break; } catch (_) { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/status of (410|422|503)/.test(message.text())) errors.push('console: ' + message.text());
  });
  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioAssistant && globalThis.FlowStudioEditor && globalThis.FlowStudioLayout);
  await page.evaluate(() => FlowStudioAssistant.ready);
  assert.equal(await page.inputValue('#assistantProvider'), 'fake', 'the test provider is picked');

  // ---- Ctrl+I opens the Assistant with the selection as context ----
  const source = 'function main() -> i32 {\n    let x: i32 = 1\n    return x\n}\n';
  await page.evaluate(text => {
    const editor = FlowStudioEditor.editor;
    editor.getModel().setValue(text);
    editor.setSelection({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 19 });
    editor.focus();
  }, source);
  await page.keyboard.press('Control+i');
  await page.waitForFunction(() => FlowStudioLayout.isVisible('right') && !document.getElementById('rpView-assistant').hidden);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'assistantInput', 'Ctrl+I focuses the input');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.as-chip')).some(chip => !chip.hidden && /Selection, 1 line/.test(chip.textContent)));

  // ---- A request streams, calls MCP tools, and proposes an edit ----
  await page.fill('#assistantInput', 'PROPOSE a fix for this program');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#assistantStop:not([hidden])');
  await page.waitForSelector('#assistantDiff[open]', { timeout: 60000 });
  await page.waitForSelector('#assistantDiff .monaco-diff-editor', { timeout: 10000 });
  const title = await page.textContent('#assistantDiffTitle');
  assert.match(title, /Proposed edit to untitled\.flow/);
  await page.screenshot({ path: path.join(ROOT, 'build', 'assistant-diff.png') });
  await page.click('#assistantAccept');
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getValue().includes('twice(21)'));
  assert.equal(await page.evaluate(() => FlowStudioAssistant.decisions().at(-1).status), 'accepted');
  await page.waitForSelector('#assistantSend:not([hidden])', { timeout: 60000 });
  const tools = await page.$$eval('#assistantThread .as-tool', nodes => nodes.map(node => [node.textContent, node.dataset.state]));
  assert.deepEqual(tools.slice(0, 3), [['Read the editor', 'ok'], ['Checked flow code: ok', 'ok'], ['Proposed an edit to untitled.flow', 'ok']]);
  assert.ok(tools.some(([text]) => /Accepted the edit to untitled\.flow/.test(text)));
  const said = await page.textContent('#assistantThread');
  assert.match(said, /The check passed/);
  // The MCP tool saw the editor: the snapshot reached the server.
  const context = await page.evaluate(async () => (await fetch('/api/assistant/context/get', { method: 'POST', headers: { 'X-FlowStudio-Intent': 'run' } })).json());
  assert.equal(context.proposals.at(-1).status, 'accepted');

  // ---- Run on a code block runs it on the server ----
  const block = page.locator('#assistantThread .as-code').last();
  await block.getByRole('button', { name: 'Run' }).click();
  await page.waitForFunction(() => /twice 21 = 42/.test(document.querySelector('#assistantThread .as-code:last-of-type .as-run-output')?.textContent || '') ||
    Array.from(document.querySelectorAll('.as-run-output')).some(node => /twice 21 = 42/.test(node.textContent)), null, { timeout: 90000 });
  await page.screenshot({ path: path.join(ROOT, 'build', 'assistant-thread.png') });

  // ---- Stop ends a running job ----
  await page.fill('#assistantInput', 'SLEEP');
  await page.click('#assistantSend');
  await page.waitForFunction(() => /sleeping as pid/.test(document.getElementById('assistantThread').textContent));
  await page.click('#assistantStop');
  await page.waitForFunction(() => /Stopped\./.test(document.getElementById('assistantThread').textContent), null, { timeout: 20000 });
  await page.waitForSelector('#assistantSend:not([hidden])');

  // ---- The command palette lists the assistant commands ----
  const commands = await page.evaluate(() => Object.keys(FlowStudioApp.commands).filter(name => /ssistant/.test(name)));
  assert.deepEqual(commands.sort(), ['assistantExplain', 'assistantFixErrors', 'assistantTranslate', 'assistantWriteTest', 'openAssistant']);

  await page.waitForTimeout(500);
  assert.deepEqual(errors, [], 'the browser console stays clean');
  console.log('native_assistant_ui: all checks passed');
} finally {
  await browser.close();
  if (server) server.kill('SIGTERM');
}
