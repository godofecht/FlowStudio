/* Run against a real, already running Flow server: npm run test:ui. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('http://127.0.0.1:8751');
  await page.waitForFunction(() => globalThis.FlowStudioEditor?.editor);
  assert.equal(await page.locator('#source').isVisible(), false);
  assert.equal(await page.locator('.monaco-editor').isVisible(), true);
  await mkdir('build/ui', { recursive: true });
  await page.screenshot({ path: 'build/ui/workbench.png' });

  // A user edit updates the document model and draft indicators.
  await page.evaluate(() => FlowStudioEditor.editor.focus());
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n# editor regression');
  assert.equal(await page.evaluate(() => FlowStudioApp.documents.active().dirty), true);
  const firstId = await page.evaluate(() => FlowStudioApp.documents.active().id);
  await page.locator('#newDocumentTab').click();
  await page.keyboard.insertText('second_buffer = 9');
  const secondId = await page.evaluate(() => FlowStudioApp.documents.active().id);
  await page.evaluate(id => FlowStudioApp.activateDocument(id), firstId);
  assert.match(await page.evaluate(() => document.getElementById('source').value), /editor regression/);
  await page.keyboard.press('ControlOrMeta+z');
  assert.doesNotMatch(await page.evaluate(() => document.getElementById('source').value), /editor regression/);
  await page.evaluate(id => FlowStudioApp.activateDocument(id), secondId);
  assert.equal(await page.evaluate(() => document.getElementById('source').value), 'second_buffer = 9');

  // Existing find/replace uses the visible Monaco selection and retains undo.
  await page.keyboard.press('ControlOrMeta+h');
  await page.locator('#editorFind').fill('second_buffer');
  await page.locator('#editorReplace').fill('answer');
  await page.locator('#replaceAll').click();
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getValue()), 'answer = 9');

  // Native Python executes the actual editor selection through the real router.
  await page.locator('#language').selectOption('python');
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'print("monaco-native-ok")\nraise RuntimeError("unselected")';
    source.dispatchEvent(new Event('input', { bubbles: true }));
    source.setSelectionRange(0, source.value.indexOf('\n'));
    source.focus();
  });
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.waitForFunction(() => document.getElementById('console').textContent.includes('monaco-native-ok'));
  await page.waitForFunction(() => !document.getElementById('run').disabled);
  assert.doesNotMatch(await page.locator('#console').innerText(), /RuntimeError/);

  // Exercise real Flow HTTP -> persistent CPython pause/step/continue from
  // the primary workspace. No mocked trace or browser-only interpreter.
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'live_value = 40\nlive_value += 2\nprint(live_value)\n';
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#tab-debug').click();
  await page.locator('#liveDebugBreakpoints').fill('2');
  await page.locator('#liveDebugStart').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Python debugger: paused'));
  assert.match(await page.locator('#liveDebugOutput').innerText(), /Line 2 in/);
  await page.locator('#liveDebugStep').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Line 3 in'));
  await page.locator('#liveDebugContinue').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Python debugger: done'));
  assert.match(await page.locator('#liveDebugOutput').innerText(), /Output:\n42/);

  // Actual native Chromium caret -> Flow HTTP -> persistent CPython one-shot
  // run-to-line. The target is executed, not emulated by editor navigation.
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'caret_a = 1\ncaret_b = caret_a + 1\ncaret_result = caret_b + 1\nprint(caret_result)\n';
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#liveDebugBreakpoints').fill('2');
  await page.locator('#liveDebugStart').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Line 2 in'));
  await page.evaluate(() => {
    const source = document.getElementById('source');
    const at = source.value.indexOf('print(caret_result)');
    source.setSelectionRange(at, at);
    source.dispatchEvent(new Event('select', { bubbles: true }));
  });
  assert.equal(await page.locator('#liveDebugRunToCursor').isDisabled(), false);
  await page.locator('#liveDebugRunToCursor').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Line 4 in'));
  assert.match(await page.locator('#liveDebugOutput').innerText(), /caret_result: int = 3/);
  await page.locator('#liveDebugContinue').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Python debugger: done'));

  // Actual native Chromium/Flow/CPython stack-frame navigation: select a
  // caller frame, then ensure switching editor documents cannot jump into
  // unrelated source while the native kernel remains paused.
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'def inner():\n    value = 40\n    return value\nanswer = inner()\nprint(answer)\n';
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#liveDebugBreakpoints').fill('3');
  await page.locator('#liveDebugStart').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Python debugger: paused') &&
    document.querySelectorAll('#liveDebugFrames button').length === 2);
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), 3);
  await page.locator('#liveDebugFrames button').nth(1).click();
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), 4);
  assert.equal(await page.locator('#liveDebugFrames button').nth(1).getAttribute('aria-current'), 'true');
  await page.locator('#newDocumentTab').click();
  await page.keyboard.insertText('unrelated = 1');
  const unrelatedLine = await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber);
  // The editor input event disables stale-frame controls immediately.
  // Playwright cannot click a disabled control; verify the actual controller
  // refuses the navigation as well as preserving the unrelated caret.
  assert.equal(await page.locator('#liveDebugFrames button').first().isDisabled(), true);
  assert.equal(await page.evaluate(() => FlowStudioWorkspacePanels.liveDebugPanel.selectFrame(0)), false);
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), unrelatedLine);
  await page.locator('#liveDebugStop').click();
  await page.waitForFunction(() =>
    document.getElementById('liveDebugOutput').textContent.includes('Python debugger: stopped'));
  assert.equal(await page.locator('#liveDebugFrames button').count(), 0);

  await page.locator('#commandLauncher').click();
  await page.locator('#commandQuery').fill('go to symbol');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#tab-outline').getAttribute('aria-selected'), 'true');
  await page.locator('#tab-files').click();
  await page.locator('#commandLauncher').click();
  await page.locator('#commandQuery').fill('zzzz-missing');
  assert.equal(await page.locator('#commandResults').innerText(), 'No matching commands.');
  await page.keyboard.press('Escape');
  await page.locator('#language').selectOption('flow');
  await page.evaluate(id => FlowStudioApp.activateDocument(id), firstId);

  // Compile-check a real Flow 2.0 source through native HTTP and flowc.
  // This must never execute the submitted source or use a browser-only parser.
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'function main() -> i32 {\n    return 0\n}\n';
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // The preceding command-palette interaction leaves a modal open in some
  // Chromium builds; close it before testing the real topbar control.
  await page.evaluate(() => document.getElementById('commandPalette').close());
  await page.locator('#checkFlow').click();
  await page.waitForFunction(() =>
    document.getElementById('resultStatus').textContent === 'Flow compile check passed.');
  assert.match(await page.locator('#flowDiagnostics').innerText(), /not executed|compile check/i);
  assert.equal(await page.locator('#flowDiagnostics').isVisible(), true);

  // Physical compiler-error acceptance: the upstream Flow 2.x parser must
  // report the checked temporary source's actual location, and Monaco must
  // navigate to it. This is not a fabricated browser-side parse diagnostic.
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'function main() -> i32 {\n    return ???\n}\n';
    source.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#checkFlow').click();
  await page.waitForFunction(() =>
    document.getElementById('resultStatus').textContent === 'Flow compile check failed; see diagnostics.');
  assert.match(await page.locator('#flowDiagnostics').innerText(), /parse error|unexpected/i);
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), 2);
  assert.ok(await page.locator('.flowstudio-flow-error').count() > 0,
    'real Flow compiler error should decorate the submitted Monaco source');
  // HTTP 422 is the expected, real strict-compiler rejection. Chromium emits
  // a console resource error for it; account for only this known response
  // without masking unrelated page errors from the rest of the acceptance.
  assert.ok(errors.some(message =>
    message === '422 http://127.0.0.1:8751/api/check/flow'));
  assert.ok(errors.every(message =>
    message === '422 http://127.0.0.1:8751/api/check/flow' ||
    /Failed to load resource:.*422/.test(message)), JSON.stringify(errors));
  errors.length = 0;

  // Exercise the worker path and wait beyond rendering and deferred callbacks.
  const workerResult = await page.evaluate(async () => {
    const worker = MonacoEnvironment.getWorker();
    let workerError = null;
    worker.onerror = event => { workerError = event.message; };
    worker.postMessage(null);
    const editor = FlowStudioEditor.editor;
    const point = editor.getModel().getPositionAt(0);
    editor.setPosition(point);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => setTimeout(resolve, 350));
    worker.terminate();
    if (workerError) throw new Error(workerError);
    return editor.getModel().getLanguageId();
  });
  assert.equal(workerResult, 'flow');
  await page.screenshot({ path: 'build/ui/workbench-tested.png' });
  // Examples open as real editor tabs and every buffer keeps its own content;
  // re-opening never collapses tabs onto the untitled Flow stub.
  await page.evaluate(() => localStorage.removeItem('flowstudio.savedProjects.v1'));
  await page.evaluate(() => document.getElementById('commandPalette').close());
  await page.click('#tab-examples');
  await page.locator('.example-card button.primary').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#docTabs .doc-tab').length >= 3);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('#docTabs .doc-tab')]
      .find(t => t.textContent.includes('analyse.R'));
    tab.click();
  });
  await page.waitForFunction(() =>
    FlowStudioApp.documents.active().text.startsWith('# Step 3'));
  assert.match(await page.evaluate(() => document.getElementById('source').value),
    /samples <- read\.csv\("data\/samples\.csv"\)/);
  // The open example becomes a saved project file on this device.
  await page.evaluate(() => FlowStudioWorkspacePanels.saveOpenProjects());
  assert.match(await page.locator('.saved-projects').innerText(), /Reopen project/);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#tab-examples');
  assert.match(await page.locator('.saved-projects').innerText(),
    /Python → data file → R analysis/,
    'saved projects reopen after a page reload');
  await page.setViewportSize({ width: 600, height: 850 });
  await page.waitForTimeout(500);
  const dimensions = await page.evaluate(() => ({
    editor: document.querySelector('.monaco-editor')?.clientWidth ?? 0,
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    host: document.querySelector('#monacoHost')?.clientWidth ?? 0
  }));
  assert.ok(dimensions.editor > 0 && dimensions.editor <= dimensions.viewport,
    'Monaco must fit the viewport: ' + JSON.stringify(dimensions));
  assert.equal(dimensions.document > dimensions.viewport, false,
    'The narrow workbench must not overflow: ' + JSON.stringify(dimensions));
  // Regression: the editor must shrink to a phone-width grid track, then expand.
  await page.setViewportSize({ width: 375, height: 740 });
  await page.waitForFunction(() => {
    const host = document.querySelector('#monacoHost');
    const editor = document.querySelector('.monaco-editor');
    return host && editor && Math.abs(editor.clientWidth - host.clientWidth) <= 2;
  });
  const phone = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    host: document.querySelector('#monacoHost').clientWidth,
    editor: document.querySelector('.monaco-editor').clientWidth
  }));
  assert.ok(phone.host > 0 && phone.host <= phone.viewport &&
    phone.editor > 0 && phone.editor <= phone.host && phone.document <= phone.viewport,
    'Monaco must fit a phone viewport: ' + JSON.stringify(phone));
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForFunction(() => {
    const host = document.querySelector('#monacoHost');
    const editor = document.querySelector('.monaco-editor');
    return host && editor && host.clientWidth > 600 && Math.abs(editor.clientWidth - host.clientWidth) <= 2;
  });
  await page.screenshot({ path: 'build/ui/workbench-narrow.png' });
  assert.deepEqual(errors, [], 'The affected flow must have clean runtime logs');
  console.log('PASS: Monaco editing, per-document undo, find/replace, native selection execution, commands, worker and narrow layout');
  await context.close();
} finally { await browser.close(); }
