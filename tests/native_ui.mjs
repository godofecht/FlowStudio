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

  // Real idle-check acceptance: edit a valid Flow buffer, opt in, and let the
  // native strict compiler finish without an explicit Check Flow click.
  // Background diagnostics must not reposition the Monaco caret.
  await page.evaluate(() => {
    const source = document.getElementById('source');
    source.value = 'function main() -> i32 {\n    return 0\n}\n';
    source.dispatchEvent(new Event('input', { bubbles: true }));
    FlowStudioEditor.editor.setPosition({lineNumber: 3, column: 1});
  });
  await page.locator('#autoCheckFlow').check();
  await page.waitForFunction(() =>
    document.getElementById('resultStatus').textContent === 'Flow compile check passed.',
    null, {timeout: 90000});
  assert.equal(await page.evaluate(() => FlowStudioEditor.editor.getPosition().lineNumber), 3,
    'idle compiler diagnostics must preserve the user caret');
  assert.equal(await page.locator('#autoCheckFlow').isChecked(), true);
  await page.locator('#autoCheckFlow').uncheck();

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

  // Real Chromium -> Flow-owned server -> native Flow 2.0 and persistent Rscript.
  // Unlike the HTTP controller suite, this exercises the actual notebook DOM,
  // download/import controls, output rendering and fail-closed cell sequencing.
  {
    const {readFileSync} = await import('node:fs');
    const notebookContext = await browser.newContext({acceptDownloads:true, viewport:{width:1920,height:1500}});
    const notebookPage = await notebookContext.newPage();
    const notebookErrors = [];
    const notebookRequests = [];
    notebookPage.on('pageerror', error => notebookErrors.push(error.message));
    notebookPage.on('request', request => {
      if (request.method() === 'POST') notebookRequests.push(new URL(request.url()).pathname);
    });
    try {
      const response = await notebookPage.goto('http://127.0.0.1:8751/app/', {
        waitUntil:'domcontentloaded'
      });
      assert.equal(response.status(), 200);
      assert.equal(await notebookPage.evaluate(() =>
        globalThis.FlowStudioNativeFlow?.available?.() === true), true);
      // Physical Chromium regression on the served production notebook UI:
      // delay only File.text() completion; all decoding and DOM mutation use
      // the real controller. No interpreter or HTTP responses are mocked.
      const importIsolation = await notebookPage.evaluate(async () => {
        const source = document.getElementById('source');
        const qmdInput = document.getElementById('quartoFile');
        const ipynbInput = document.getElementById('notebookFile');
        const tick = String.fromCharCode(96).repeat(3);
        const qmd = tick + '{r}\ncat(31)\n' + tick + '\n';
        const ipynb = JSON.stringify({nbformat:4, nbformat_minor:4,
          metadata:{language_info:{name:'python'}},
          cells:[{cell_type:'code', source:'print(17)', metadata:{}, outputs:[]}]});
        function select(input, file) {
          const data = new DataTransfer();
          data.items.add(file);
          input.files = data.files;
          input.dispatchEvent(new Event('change', {bubbles:true}));
        }
        const originalConfirm = window.confirm;
        const originalText = File.prototype.text;
        let releaseStale, releasePending;
        window.confirm = () => true;
        File.prototype.text = function () {
          if (this.name === 'stale.qmd')
            return new Promise(resolve => { releaseStale = () => resolve(qmd); });
          if (this.name === 'pending.qmd')
            return new Promise(resolve => { releasePending = () => resolve(qmd); });
          return originalText.call(this);
        };
        try {
          select(qmdInput, new File([qmd], 'stale.qmd', {type:'text/markdown'}));
          if (!releaseStale) throw Error('Browser did not enter delayed Quarto read');
          select(ipynbInput, new File([ipynb], 'new.ipynb', {type:'application/json'}));
          for (let attempt = 0; attempt < 20 && !source.value.includes('print(17)'); attempt++)
            await new Promise(resolve => setTimeout(resolve, 10));
          const beforeRelease = source.value;
          releaseStale();
          await new Promise(resolve => setTimeout(resolve, 0));
          const latest = source.value;
          select(qmdInput, new File([qmd], 'pending.qmd', {type:'text/markdown'}));
          if (!releasePending) throw Error('Browser did not enter second delayed Quarto read');
          source.value = 'user_edit_must_survive = 42';
          source.dispatchEvent(new Event('input', {bubbles:true}));
          releasePending();
          await new Promise(resolve => setTimeout(resolve, 0));
          return {beforeRelease, latest, edited:source.value,
            notice:document.getElementById('notice').textContent};
        } finally {
          window.confirm = originalConfirm;
          File.prototype.text = originalText;
        }
      });
      assert.match(importIsolation.latest, /print\\(17\\)/,
        'late Quarto read must not overwrite newer Jupyter import');
      assert.equal(importIsolation.edited, 'user_edit_must_survive = 42');
      assert.match(importIsolation.notice, /editor changed during file read/);
      await notebookPage.locator('#rRuntime').selectOption('native');
      await notebookPage.locator('#language').selectOption('flow');
      const coupled = readFileSync(new URL('../examples/native_coupled_diffusion_2d.flow',
        import.meta.url), 'utf8').trimEnd();
      const cyclic = readFileSync(new URL('../examples/native_cyclic_network.flow',
        import.meta.url), 'utf8').trimEnd();
      const rOracle = [
        'flowstudio_ui_amplitude <- exp(-8 * 0.01 / (0.5^2) * 0.5)',
        'flowstudio_ui_exchange <- 3 - exp(-2 * 0.2 * 0.5)',
        'stopifnot(abs(flowstudio_ui_amplitude - 0.85214378896621135) < 1e-12,',
        '          abs(flowstudio_ui_exchange - 2.1812692469220183) < 1e-12)',
        "cat('r-coupled-oracle-ok\\n')"
      ].join('\n');
      const source = [
        '# %% [markdown]\nIndependent coupled PDE and cyclic transport acceptance.\n',
        '# %% [flow]\n' + coupled + '\n',
        '# %% [r]\n' + rOracle + '\n',
        '# %% [flow]\n' + cyclic + '\n',
        '# %% [r]\nstopifnot(abs(flowstudio_ui_exchange - 2.1812692469220183) < 1e-12,',
        '  length(flowstudio_ui_amplitude) == 1L)\ncat("r-persistent-ok\\n")\n'
      ].join('');
      // The legacy /app/ textarea can have zero layout height in headless
      // Chromium at this viewport. Dispatch the real input event on the
      // production DOM; execution, downloads and imports still use UI controls.
      const setNotebookSource = value => notebookPage.evaluate(text => {
        const editor = document.getElementById('source');
        editor.value = text;
        editor.dispatchEvent(new Event('input', {bubbles:true}));
      }, value);
      await setNotebookSource(source);
      await notebookPage.locator('#runNotebook').click();
      await notebookPage.waitForFunction(() =>
        /^Notebook (executed|stopped|execution failed)/.test(
          document.querySelector('#notice')?.textContent || ''),
        null, {timeout:90000});
      assert.equal(await notebookPage.locator('#notice').innerText(),
        'Notebook executed 4 cells.', JSON.stringify({
          requests:notebookRequests,
          output:await notebookPage.locator('#notebookOutput').innerText(),
          errors:notebookErrors
        }).slice(0,3000));
      assert.equal(await notebookPage.locator('#notebookOutput .notebook-cell').count(), 5);
      const output = await notebookPage.locator('#notebookOutput').innerText();
      assert.match(output, /Cell 2 \(flow\) — complete/);
      assert.match(output, /Cell 3 \(r\) — complete/);
      assert.match(output, /Cell 4 \(flow\) — complete/);
      assert.match(output, /Cell 5 \(r\) — complete/);
      assert.match(output, /r-coupled-oracle-ok/);
      assert.match(output, /r-persistent-ok/);
      assert.equal(notebookRequests.filter(route => route === '/api/run/flow').length, 2);
      assert.equal(notebookRequests.filter(route => route === '/api/run/r').length, 2);

      // The completion notice is published before the asynchronous native R
      // environment inspection finishes. Export must wait until the notebook
      // runner clears busy, rather than racing its explicit busy guard.
      await notebookPage.waitForFunction(() =>
        !document.querySelector('#runNotebook').disabled, null, {timeout:30000});

      // Real downloaded .fsnb must restore display snapshots without executing
      // any Flow or R code or pretending to restore interpreter state.
      // Diagnose a failed export at its actual boundary instead of timing out
      // on an absent browser download event with no application context.
      const exportPreflight = await notebookPage.evaluate(() => {
        const source = document.querySelector('#source').value;
        const language = document.querySelector('#language').value;
        try {
          const json = FlowStudioNotebookFormat.encodeBundle(source, language, [],
            FlowStudioSourceCells.parseCells);
          return {ok:true, bytes:new Blob([json]).size};
        } catch (error) {
          return {ok:false, error:String(error?.message || error)};
        }
      });
      assert.equal(exportPreflight.ok, true, JSON.stringify(exportPreflight));
      const downloadPromise = notebookPage.waitForEvent('download', {timeout:8000})
        .catch(async error => {
          const notice = await notebookPage.locator('#notice').innerText();
          throw new Error('FlowStudio .fsnb download missing; UI notice: ' + notice +
            '; preflight: ' + JSON.stringify(exportPreflight), {cause:error});
        });
      await notebookPage.locator('#saveFlowNotebook').click();
      const download = await downloadPromise;
      const bundle = JSON.parse(readFileSync(await download.path(), 'utf8'));
      assert.equal(bundle.source, source);
      assert.equal(bundle.language, 'flow');
      assert.equal(bundle.results.length, 4);
      const beforeImport = notebookRequests.length;
      await setNotebookSource('# %% [r]\nstop("must-not-run")\n');
      // Importing over a modified project is intentionally confirmation-gated.
      // Chromium dismisses dialogs by default, which would silently abort
      // the real import; explicitly accept the production safety prompt.
      let importConfirmed = false;
      notebookPage.once('dialog', async dialog => {
        assert.match(dialog.message(), /Discard unsaved editor changes/);
        importConfirmed = true;
        await dialog.accept();
      });
      await notebookPage.locator('#flowNotebookFile').setInputFiles({
        name:'complex-physical.fsnb', mimeType:'application/json',
        buffer:Buffer.from(JSON.stringify(bundle))
      });
      await notebookPage.waitForFunction(() =>
        document.querySelector('#notice')?.textContent.startsWith(
          'FlowStudio notebook imported with saved outputs; interpreter state was not restored.'),
        null, {timeout:30000});
      assert.equal(importConfirmed, true, 'Modified-source import must request confirmation');
      assert.equal(await notebookPage.locator('#source').inputValue(), source);
      assert.match(await notebookPage.locator('#notebookOutput').innerText(), /r-persistent-ok/);
      assert.equal(notebookRequests.length, beforeImport,
        'Import must never execute saved notebook source');

      // A failing native Flow cell must stop before the subsequent R side effect.
      const beforeFailureR = notebookRequests.filter(route => route === '/api/run/r').length;
      await setNotebookSource(
        '# %% [flow]\nfunction main() -> i32 { return 37 }\n' +
        '# %% [r]\nflowstudio_should_not_run <- TRUE\n');
      await notebookPage.locator('#runNotebook').click();
      await notebookPage.waitForFunction(() =>
        document.querySelector('#notice')?.textContent.startsWith(
          'Notebook stopped after 1 cells:'),
        null, {timeout:90000});
      assert.equal(await notebookPage.locator('#notebookOutput .notebook-cell').count(), 1);
      assert.match(await notebookPage.locator('#notebookOutput').innerText(),
        /Cell 1 \(flow\) — failed/);
      assert.equal(notebookRequests.filter(route => route === '/api/run/r').length,
        beforeFailureR);

      // Check the real persistent R workspace after the failure, not a mock.
      await setNotebookSource(
        '# %% [r]\n' +
        "stopifnot(!exists('flowstudio_should_not_run', inherits=TRUE))\n" +
        "cat('r-fail-closed-ok\\n')\n");
      await notebookPage.locator('#runNotebook').click();
      await notebookPage.waitForFunction(() =>
        document.querySelector('#notice')?.textContent === 'Notebook executed 1 cells.',
        null, {timeout:30000});
      assert.match(await notebookPage.locator('#notebookOutput').innerText(),
        /r-fail-closed-ok/);

      // The same real Rscript session must render a genuine captured plot in
      // the browser; a text-only notebook test cannot establish plotting.
      await notebookPage.locator('#language').selectOption('r');
      await setNotebookSource(
        "plot(c(1,2,3), c(3,1,4), type='l'); cat('native-plot-ui-ok\\n')\n");
      await notebookPage.locator('#run').click();
      await notebookPage.waitForFunction(() =>
        document.querySelector('#notice')?.textContent === 'r execution complete.',
        null, {timeout:60000});
      await notebookPage.locator(
        "#workspace img[alt^='R plot'], #workspace embed[aria-label^='R plot']"
      ).first().waitFor({timeout:30000});
      assert.deepEqual(notebookErrors, []);
      console.log('PASS: physical Chromium native Flow/R complex notebook, .fsnb roundtrip, stop-on-error and real R plot');
    } finally {
      await notebookContext.close();
    }
  }

  assert.deepEqual(errors, [], 'The affected flow must have clean runtime logs');
  console.log('PASS: Monaco editing, per-document undo, find/replace, native selection execution, commands, worker and narrow layout');
  await context.close();
} finally { await browser.close(); }
