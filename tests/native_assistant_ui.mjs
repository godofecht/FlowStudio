/* Real Chromium acceptance for the Assistant: node tests/native_assistant_ui.mjs
 *
 * Starts ./build/flowstudio on a free loopback port with the fake provider
 * (tests/fixtures/fake_assistant.py), which drives the real FlowStudio MCP
 * server. No real model is called. Covers Ctrl+I and Ctrl+L, streaming,
 * tool lines, proposals as inline diffs with a review list, Apply and Copy
 * on a code block, Ctrl+K inline edits with per-change Accept and Reject
 * and one-step undo, Fix with Assistant from a compiler error, Stop, the
 * chat kept across a reload, and a clean browser console.
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

const shots = path.join(ROOT, 'build');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const errors = [];
const value = page => page.evaluate(() => FlowStudioEditor.editor.getModel().getValue());
const setSource = (page, text, selection = null) => page.evaluate(([text, selection]) => {
  const editor = FlowStudioEditor.editor;
  editor.getModel().setValue(text);
  if (selection) editor.setSelection(selection);
  editor.focus();
}, [text, selection]);
const inlineState = page => page.evaluate(() => FlowStudioInlineEdit.state());
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/status of (410|422|503)/.test(message.text())) errors.push('console: ' + message.text());
  });
  await page.goto(URL);
  await page.waitForFunction(() => globalThis.FlowStudioAssistant && globalThis.FlowStudioEditor && globalThis.FlowStudioLayout && globalThis.FlowStudioInlineEdit);
  await page.evaluate(() => FlowStudioAssistant.ready);
  assert.equal(await page.inputValue('#assistantProvider'), 'fake', 'the test provider is picked');

  // ---- Ctrl+I opens the Assistant with the file and selection as chips ----
  const source = 'function main() -> i32 {\n    let x: i32 = 1\n    return x\n}\n';
  await setSource(page, source, { startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 19 });
  await page.keyboard.press('Control+i');
  await page.waitForFunction(() => FlowStudioLayout.isVisible('right') && !document.getElementById('rpView-assistant').hidden);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'assistantInput', 'Ctrl+I focuses the input');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#assistantChips .as-chip')).some(chip => /Selection, 1 line/.test(chip.textContent)));
  const chips = await page.$$eval('#assistantChips .as-chip-label', nodes => nodes.map(node => node.textContent));
  assert.deepEqual(chips.slice(0, 2), ['untitled.flow', 'Selection, 1 line']);

  // ---- @ adds context from a menu ----
  await page.fill('#assistantInput', 'look at @sel');
  await page.dispatchEvent('#assistantInput', 'input');
  await page.waitForSelector('#assistantMentions:not([hidden]) .as-mention');
  assert.equal(await page.textContent('#assistantMentions .as-mention[aria-selected="true"] .as-mention-label'), 'Selection');
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#assistantInput'), 'look at ', '@ text is replaced by a chip');
  assert.ok(await page.isHidden('#assistantMentions'));
  // Removing the file chip leaves it out of the next message.
  await page.click('#assistantChips .as-chip[data-key="file"] .as-chip-remove');
  assert.equal(await page.$('#assistantChips .as-chip[data-key="file"]'), null);

  // ---- A request streams, calls MCP tools, and proposes an inline edit ----
  await page.fill('#assistantInput', 'PROPOSE a fix for this program');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#assistantStop:not([hidden])');
  await page.waitForSelector('.as-assistant[data-state="thinking"], .as-assistant[data-state="writing"], .as-assistant[data-state="working"]');
  await page.waitForSelector('#assistantReview .as-review-row', { timeout: 60000 });
  assert.equal(await page.$('#assistantDiff'), null, 'no modal diff');
  await page.waitForSelector('.monaco-editor .fs-diff-add');
  await page.waitForSelector('.monaco-editor .fs-diff-del');
  assert.equal(await value(page), source, 'nothing changes before Accept');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'assistantInput', 'a proposal does not steal focus');
  assert.match(await page.textContent('#assistantReview'), /untitled\.flow/);
  await page.screenshot({ path: path.join(shots, 'assistant-proposal.png') });
  await page.click('#assistantReview .as-review-accept');
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getValue().includes('twice(21)'));
  await page.waitForFunction(() => FlowStudioAssistant.decisions().at(-1)?.status === 'accepted');
  assert.equal(await page.$('.monaco-editor .fs-diff-add'), null, 'the diff closes after Accept');
  await page.waitForSelector('#assistantSend:not([hidden])', { timeout: 60000 });
  const tools = await page.$$eval('#assistantThread .as-tool', nodes => nodes.map(node => [node.textContent, node.dataset.state]));
  assert.deepEqual(tools.slice(0, 3), [['Read the editor', 'ok'], ['Checked flow code: ok', 'ok'], ['Proposed an edit to untitled.flow', 'ok']]);
  assert.ok(tools.some(([text]) => /Accepted the edit to untitled\.flow/.test(text)));
  assert.match(await page.textContent('#assistantThread'), /The check passed/);
  const user = await page.$$eval('#assistantThread .as-user', nodes => nodes.at(-1).querySelector('.as-user-context')?.textContent);
  assert.equal(user, 'selection', 'the removed file chip stayed out; the mentioned selection went');
  const sent = await page.evaluate(async () => (await fetch('/api/assistant/context/get', { method: 'POST', headers: { 'X-FlowStudio-Intent': 'run' } })).json());
  assert.equal(sent.proposals.at(-1).status, 'accepted');
  assert.equal(await page.$$eval('#assistantThread .as-code code span[class^="mtk"]', nodes => nodes.length > 0), true, 'code blocks are highlighted');

  // ---- Run on a code block runs it on the server ----
  const block = page.locator('#assistantThread .as-code').last();
  await block.getByRole('button', { name: 'Run' }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.as-run-output')).some(node => /twice 21 = 42/.test(node.textContent)), null, { timeout: 90000 });
  await page.screenshot({ path: path.join(shots, 'assistant-thread.png') });

  // ---- Copy and Apply on a code block ----
  await block.getByRole('button', { name: 'Copy' }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /function twice/);
  const other = 'function main() -> i32 {\n    println("hello")\n    return 0\n}\n';
  await setSource(page, other);
  await block.getByRole('button', { name: 'Apply' }).click();
  await page.waitForSelector('.monaco-editor .fs-review-bar');
  assert.equal(await value(page), other, 'Apply only shows a diff');
  assert.match(await page.textContent('#assistantStatus'), /Replaces the whole file/);
  await page.evaluate(() => FlowStudioEditor.editor.focus());
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getValue().includes('twice(21)'));
  assert.equal(await page.$('.monaco-editor .fs-review-bar'), null);
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await value(page), other, 'one undo takes the whole Apply back');
  await block.getByRole('button', { name: 'Apply' }).click();
  await page.waitForSelector('.monaco-editor .fs-review-bar');
  await page.evaluate(() => FlowStudioEditor.editor.focus());
  await page.keyboard.press('Escape');
  assert.ok(await page.$('.monaco-editor .fs-review-bar'), 'a stray Esc keeps an applied change under review');
  await page.keyboard.press('ControlOrMeta+Shift+Backspace');
  await page.waitForFunction(() => !document.querySelector('.monaco-editor .fs-review-bar'));
  assert.equal(await value(page), other, 'Reject all leaves the file alone');

  // ---- Ctrl+K: inline edit with per-change Reject and Accept, then undo ----
  const program = 'function main() -> i32 {\n    let a: i32 = 1\n    println("a =", a)\n    let b: i32 = 2\n    return a + b\n}\n';
  await setSource(page, program, { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 19 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.waitForSelector('#assistantInlineInput');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'assistantInlineInput', 'Ctrl+K focuses the prompt bar');
  assert.equal(await page.isHidden('#searchEverywhere'), true, 'Ctrl+K in the editor is not the command search');
  await page.keyboard.type('bump the numbers');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => ['thinking', 'writing'].includes(FlowStudioInlineEdit.state().bar));
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === 'review', null, { timeout: 60000 });
  const review = await inlineState(page);
  assert.deepEqual(review.session.hunks.map(hunk => [hunk.removed, hunk.added]),
    [[['    let a: i32 = 1'], ['    let a: i32 = 2']], [['    let b: i32 = 2'], ['    let b: i32 = 3']]]);
  assert.equal(await value(page), program, 'nothing changes before Accept');
  assert.equal(await page.$$eval('.monaco-editor .fs-hunk-bar', nodes => nodes.filter(node => node.style.display !== 'none').length), 2);
  await page.screenshot({ path: path.join(shots, 'assistant-inline.png') });
  await page.click('.fs-hunk-bar[data-hunk="1"] .fs-hunk-reject');
  await page.waitForFunction(() => document.querySelectorAll('.fs-hunk-bar').length === 1);
  await page.click('.fs-hunk-bar[data-hunk="2"] .fs-hunk-accept');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === null);
  assert.equal(await value(page), program.replace('let b: i32 = 2', 'let b: i32 = 3'), 'only the accepted change lands');
  await page.evaluate(() => FlowStudioEditor.editor.focus());
  await page.keyboard.press('ControlOrMeta+z');
  assert.equal(await value(page), program, 'Cmd+Z takes the accepted change back in one step');

  // ---- Ctrl+K again: Esc rejects everything, Tab accepts everything ----
  await setSource(page, program, { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 19 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('bump');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === 'review', null, { timeout: 60000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === null);
  assert.equal(await value(page), program, 'Esc rejects');
  await setSource(page, program, { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 19 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('bump');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === 'review', null, { timeout: 60000 });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === null);
  assert.equal(await value(page), program.replace('= 1', '= 2').replace('let b: i32 = 2', 'let b: i32 = 3'), 'Tab accepts all');

  // ---- A line the user changed during review is never overwritten ----
  await setSource(page, program, { startLineNumber: 2, startColumn: 1, endLineNumber: 4, endColumn: 19 });
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('bump');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === 'review', null, { timeout: 60000 });
  await page.evaluate(() => {
    const editor = FlowStudioEditor.editor;
    editor.executeEdits('user', [{ range: new FlowStudioMonaco.Range(2, 18, 2, 19), text: '7' }]);
    editor.focus();
  });
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === null);
  assert.equal(await value(page), program.replace('= 1', '= 7').replace('let b: i32 = 2', 'let b: i32 = 3'),
    'the typed line stays and only the untouched change lands');

  // ---- Fix with Assistant from a real compiler error ----
  const broken = 'function main() -> i32 {\n    let total: i32 = 4\n    println("total =", y)\n    return 0\n}\n';
  await setSource(page, broken, { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 5 });
  await page.click('#checkFlow');
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getLineDecorations(3)
    .some(item => item.options.inlineClassName === 'flowstudio-flow-error'), null, { timeout: 90000 });
  await page.evaluate(() => { const editor = FlowStudioEditor.editor; editor.setPosition({ lineNumber: 3, column: 26 }); editor.focus(); });
  await page.evaluate(() => FlowStudioEditor.editor.trigger('test', 'editor.action.quickFix', {}));
  const fix = page.locator('.action-widget .monaco-list-row', { hasText: 'Fix with Assistant' });
  await fix.first().waitFor({ timeout: 10000 });
  await fix.first().click();
  await page.waitForSelector('#assistantInlineInput');
  assert.match(await page.inputValue('#assistantInlineInput'), /Fix this error: .*y.* \(line 3\)/);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === 'review', null, { timeout: 60000 });
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForFunction(() => FlowStudioInlineEdit.state().bar === null);
  assert.equal(await value(page), broken.replace('", y)', '", total)'));

  // ---- Edits to two files: a review list with Accept per file ----
  await setSource(page, source);
  const firstId = await page.evaluate(() => FlowStudioApp.documents.active().id);
  const secondId = await page.evaluate(() => {
    const opened = FlowStudioApp.documents.open({ name: 'notes.flow', text: 'let second = 1\n', language: 'flow' });
    const id = (opened.document || opened).id;
    FlowStudioApp.activateDocument(id);
    return id;
  });
  await page.evaluate(id => FlowStudioApp.activateDocument(id), firstId);
  await page.fill('#assistantInput', 'PROPOSE2 both files');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#assistantReview .as-review-row').length === 2, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => FlowStudioApp.documents.active().id), firstId, 'a proposal for another file does not switch tabs');
  await page.screenshot({ path: path.join(shots, 'assistant-review.png') });
  await page.locator('#assistantReview .as-review-row').nth(1).locator('.as-review-accept').click();
  await page.waitForFunction(() => FlowStudioEditor.editor.getModel().getValue().startsWith('# reviewed by the assistant'));
  assert.equal(await page.evaluate(() => FlowStudioApp.documents.active().id), secondId);
  await page.locator('#assistantReview .as-review-row').first().locator('.as-review-reject').click();
  await page.waitForFunction(() => document.querySelectorAll('#assistantReview .as-review-row').length === 0);
  await page.waitForSelector('#assistantSend:not([hidden])', { timeout: 60000 });
  const statuses = await page.evaluate(() => FlowStudioAssistant.decisions().slice(-2).map(item => item.status).sort());
  assert.deepEqual(statuses, ['accepted', 'rejected']);
  await page.evaluate(id => FlowStudioApp.activateDocument(id), firstId);
  assert.equal(await value(page), source, 'the rejected file is unchanged');

  // ---- Stop ends a running job ----
  await page.fill('#assistantInput', 'SLEEP');
  await page.click('#assistantSend');
  await page.waitForFunction(() => /sleeping as pid/.test(document.getElementById('assistantThread').textContent));
  await page.click('#assistantStop');
  await page.waitForFunction(() => /Stopped\./.test(document.getElementById('assistantThread').textContent), null, { timeout: 20000 });
  await page.waitForSelector('#assistantSend:not([hidden])');

  // ---- The command palette lists the assistant commands ----
  const commands = await page.evaluate(() => Object.keys(FlowStudioApp.commands).filter(name => /ssistant/.test(name)));
  assert.deepEqual(commands.sort(), ['assistantExplain', 'assistantFixErrors', 'assistantInlineEdit', 'assistantTranslate', 'assistantWriteTest', 'openAssistant']);

  // ---- The chat is kept across a reload, and Ctrl+L opens it ----
  const before = await page.$$eval('#assistantThread .as-user', nodes => nodes.length);
  await page.reload();
  await page.waitForFunction(() => globalThis.FlowStudioAssistant && globalThis.FlowStudioEditor && globalThis.FlowStudioInlineEdit);
  await page.evaluate(() => FlowStudioAssistant.ready);
  await page.evaluate(() => FlowStudioEditor.editor.focus());
  await page.keyboard.press('ControlOrMeta+l');
  await page.waitForFunction(() => !document.getElementById('rpView-assistant').hidden && document.activeElement.id === 'assistantInput');
  assert.equal(await page.$$eval('#assistantThread .as-user', nodes => nodes.length), before, 'the chat survives a reload');

  // ---- Phone width ----
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'assistant-phone.png') });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'no sideways scroll at 390 px');

  await page.waitForTimeout(500);
  assert.deepEqual(errors, [], 'the browser console stays clean');
  console.log('native_assistant_ui: all checks passed');
} finally {
  await browser.close();
  if (server) server.kill('SIGTERM');
}
