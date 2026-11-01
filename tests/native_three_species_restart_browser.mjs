/* Real Chromium -> Flow-owned HTTP -> persistent R checkpoint/restart acceptance.
 * A separate persistent CPython stencil verifies all 3,072 cells at both phases.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const example = name => readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8').trimEnd();
const origin = 'http://127.0.0.1:8751';
const names = ['a', 'b', 'c'];
const marker = 'FLOWSTUDIO_THREE_RESTART_V1 ';

async function native(language, code) {
  const response = await fetch(origin + '/api/run/' + language, {
    method:'POST', headers:{'X-FlowStudio-Intent':'run'}, body:code,
    signal:AbortSignal.timeout(30000)
  });
  return {status:response.status, body:await response.text()};
}

function checkpoint(text, expectedPhase) {
  assert.ok(Buffer.byteLength(text, 'utf8') < 100000);
  const frames = text.split(/\r?\n/).filter(line => line.startsWith(marker));
  assert.equal(frames.length, 1, text.slice(0, 300));
  const parts = frames[0].slice(marker.length).split(' ');
  assert.equal(parts.length, 2);
  assert.equal(parts[0], String(expectedPhase));
  const cells = parts[1].split(',').map(Number);
  assert.equal(cells.length, 3072);
  assert.ok(cells.every(Number.isFinite));
  return Object.fromEntries(names.map((name, i) =>
    [name, cells.slice(i * 1024, (i + 1) * 1024)]));
}

async function verifyCheckpoint(result, phase) {
  const payload = JSON.stringify(result);
  const code = 'import json\n' +
    'checkpoint_actual = json.loads(' + JSON.stringify(payload) + ')\n' +
    'checkpoint_expected = integrate(initial_fields(), ' + (24 * phase) + ')\n' +
    'checkpoint_error = max(abs(a-b) for name, field in zip(NAMES, checkpoint_expected) ' +
    'for a,b in zip(checkpoint_actual[name], field))\n' +
    'assert checkpoint_error < 5e-11, checkpoint_error\n' +
    'print("chromium-restart-oracle-ok", checkpoint_error)\n';
  assert.ok(Buffer.byteLength(code, 'utf8') < 131072);
  const response = await native('python', code);
  assert.equal(response.status, 200, response.body.slice(0, 300));
  assert.match(response.body, /chromium-restart-oracle-ok/);
}

export async function runThreeSpeciesRestartBrowser({page, setNotebookSource, requests}) {
  const seed = await native('python', example('coupled_three_species_python.py'));
  assert.equal(seed.status, 200, seed.body.slice(0, 300));
  const fields = JSON.parse(seed.body);
  assert.deepEqual(Object.keys(fields).sort(), names);
  const assignments = names.map(name => {
    assert.equal(fields[name].length, 1024);
    assert.ok(fields[name].every(Number.isFinite));
    const code = 'flowstudio_three_initial_' + name + ' <- c(' +
      fields[name].map(value => value.toPrecision(17)).join(',') + ')';
    assert.ok(Buffer.byteLength(code, 'utf8') < 65536);
    return code;
  });
  const restart = example('coupled_three_species_restart_r.R');
  assert.ok(Buffer.byteLength(restart, 'utf8') < 65536);
  const cell = code => '# %% [r]\n' + code + '\n';
  const backup = [
    'assign("flowstudio_three_restart_backup",',
    '  lapply(get("flowstudio_three_restart_state", envir=.GlobalEnv, inherits=FALSE),',
    '    function(f) f + 0), envir=.GlobalEnv)',
    'assign("flowstudio_three_restart_snapshot_backup",',
    '  get("flowstudio_three_restart_snapshot", envir=.GlobalEnv, inherits=FALSE),',
    '  envir=.GlobalEnv)',
    'stopifnot(identical(flowstudio_three_restart_phase, 1L),',
    '  is.raw(flowstudio_three_restart_snapshot),',
    '  length(flowstudio_three_restart_snapshot) <= 65536L)'
  ].join('\n');
  const restore = [
    'assign("flowstudio_three_restart_state", flowstudio_three_restart_backup, envir=.GlobalEnv)',
    'assign("flowstudio_three_restart_snapshot",',
    '  flowstudio_three_restart_snapshot_backup, envir=.GlobalEnv)',
    'stopifnot(identical(flowstudio_three_restart_phase, 1L))'
  ].join('\n');
  const initial = [
    ...assignments.map(cell),
    cell('assign("flowstudio_three_restart_phase", 0L, envir=.GlobalEnv)'),
    cell(restart), cell(backup)
  ].join('');
  assert.ok(Buffer.byteLength(initial, 'utf8') < 2 * 1024 * 1024);
  await page.locator('#language').selectOption('flow');
  await page.locator('#rRuntime').selectOption('native');

  async function execute(source, expectedNotice, count) {
    await page.waitForFunction(() => !document.querySelector('#runNotebook').disabled);
    await setNotebookSource(source);
    await page.locator('#runNotebook').click();
    await page.waitForFunction(() =>
      /^Notebook (executed|stopped|execution failed)/.test(
        document.querySelector('#notice')?.textContent || ''),
      null, {timeout:120000});
    const notice = await page.locator('#notice').innerText();
    assert.ok(notice.startsWith(expectedNotice), JSON.stringify({notice,
      output:(await page.locator('#notebookOutput').innerText()).slice(-2500),
      routes:requests.slice(-10)}));
    assert.equal(await page.locator('#notebookOutput .notebook-cell').count(), count);
    await page.waitForFunction(() => !document.querySelector('#runNotebook').disabled,
      null, {timeout:30000});
  }

  const firstRequests = requests.length;
  await execute(initial, 'Notebook executed 6 cells.', 6);
  assert.deepEqual(requests.slice(firstRequests).filter(path => path.startsWith('/api/run/')),
    Array(6).fill('/api/run/r'));
  const firstText = await page.locator('#notebookOutput .notebook-cell').nth(4)
    .locator('pre').last().textContent();
  const first = checkpoint(firstText, 1);
  await verifyCheckpoint(first, 1);

  // Mass is unchanged by these two edits. Only byte-exact checkpoint
  // verification can reject the resumed trajectory before phase advances.
  const corruption = [
    'corrupt <- get("flowstudio_three_restart_state", envir=.GlobalEnv, inherits=FALSE)',
    'corrupt[[1L]][1L,1L] <- corrupt[[1L]][1L,1L] + 0.25',
    'corrupt[[1L]][1L,2L] <- corrupt[[1L]][1L,2L] - 0.25',
    'assign("flowstudio_three_restart_state", corrupt, envir=.GlobalEnv)'
  ].join('\n');
  await execute(cell(corruption) + cell(restart) +
    cell('assign("flowstudio_three_restart_unexpected", TRUE, envir=.GlobalEnv)'),
    'Notebook stopped after 2 cells:', 2);
  assert.match(await page.locator('#notebookOutput').innerText(), /restart checkpoint changed/);
  let state = await native('r', 'stopifnot(identical(flowstudio_three_restart_phase, 1L), ' +
    '!exists("flowstudio_three_restart_unexpected", envir=.GlobalEnv, inherits=FALSE)); ' +
    'cat("restart-rejection-ok\\n")');
  assert.equal(state.status, 200, state.body.slice(0, 300));
  assert.match(state.body, /restart-rejection-ok/);

  // Invalid serialized snapshots are also rejected without advancing.
  await execute(cell(restore + '\nassign("flowstudio_three_restart_snapshot", 1L, envir=.GlobalEnv)') +
    cell(restart), 'Notebook stopped after 2 cells:', 2);
  assert.match(await page.locator('#notebookOutput').innerText(), /restart checkpoint changed/);
  state = await native('r', 'stopifnot(identical(flowstudio_three_restart_phase, 1L)); ' +
    'cat("restart-snapshot-rejection-ok\\n")');
  assert.equal(state.status, 200, state.body.slice(0, 300));

  // A forbidden 25-step chunk fails the numerical resource budget before
  // modifying the saved phase, state or snapshot.
  const oversized = restart.replace('chunk_steps <- 24L', 'chunk_steps <- 25L');
  assert.notEqual(oversized, restart);
  await execute(cell(oversized), 'Notebook stopped after 1 cells:', 1);
  assert.match(await page.locator('#notebookOutput').innerText(), /restart resource limit exceeded/);

  const resumedSource = cell(restore) + cell(restart);
  await execute(resumedSource, 'Notebook executed 2 cells.', 2);
  const finalText = await page.locator('#notebookOutput .notebook-cell').nth(1)
    .locator('pre').last().textContent();
  const final = checkpoint(finalText, 2);
  await verifyCheckpoint(final, 2);

  // The saved notebook is an output snapshot, never a replay of kernel state.
  const download = page.waitForEvent('download', {timeout:15000});
  await page.locator('#saveFlowNotebook').click();
  const saved = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  assert.equal(saved.source, resumedSource);
  assert.equal(saved.results.length, 2);
  assert.match(saved.results[1].output, /FLOWSTUDIO_THREE_RESTART_V1 2 /);

  await execute(cell(restart) +
    cell('assign("flowstudio_three_restart_forbidden", TRUE, envir=.GlobalEnv)'),
    'Notebook stopped after 1 cells:', 1);
  assert.match(await page.locator('#notebookOutput').innerText(), /restart phase invalid/);
  state = await native('r', 'stopifnot(identical(flowstudio_three_restart_phase, 2L), ' +
    '!exists("flowstudio_three_restart_forbidden", envir=.GlobalEnv, inherits=FALSE)); ' +
    'cat("restart-final-phase-ok\\n")');
  assert.equal(state.status, 200, state.body.slice(0, 300));
  assert.match(state.body, /restart-final-phase-ok/);

  // A notebook snapshot must remain readable after the real R interpreter
  // has been destroyed. Reset must not disturb the independent Python oracle.
  const resetResponse = await fetch(origin + '/api/reset/r', {
    method:'POST', headers:{'X-FlowStudio-Intent':'run'}, body:'',
    signal:AbortSignal.timeout(30000)
  });
  const resetBody = await resetResponse.text();
  assert.equal(resetResponse.status, 200, resetBody.slice(0, 300));
  assert.match(resetBody, /R session reset/);
  const cleared = await native('r',
    'stopifnot(!exists("flowstudio_three_restart_phase", envir=.GlobalEnv, inherits=FALSE), ' +
    '!exists("flowstudio_three_restart_state", envir=.GlobalEnv, inherits=FALSE), ' +
    '!exists("flowstudio_three_restart_snapshot", envir=.GlobalEnv, inherits=FALSE)); ' +
    'cat("restart-reset-clean-ok\\n")');
  assert.equal(cleared.status, 200, cleared.body.slice(0, 300));
  assert.match(cleared.body, /restart-reset-clean-ok/);
  const pythonSurvived = await native('python',
    'assert callable(integrate) and len(initial_fields()) == 3\n' +
    'print("restart-python-isolated-ok")');
  assert.equal(pythonSurvived.status, 200, pythonSurvived.body.slice(0, 300));
  assert.match(pythonSurvived.body, /restart-python-isolated-ok/);

  const beforeImport = requests.length;
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#flowNotebookFile').setInputFiles({
    name:'three-species-restart.fsnb', mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(saved))
  });
  await page.waitForFunction(() =>
    document.querySelector('#notice')?.textContent.startsWith(
      'FlowStudio notebook imported with saved outputs; interpreter state was not restored.'),
    null, {timeout:30000});
  assert.equal(await page.locator('#source').inputValue(), resumedSource);
  assert.equal(await page.locator('#notebookOutput .notebook-cell').count(), 2);
  assert.match(await page.locator('#notebookOutput').innerText(), /FLOWSTUDIO_THREE_RESTART_V1 2 /);
  assert.equal(requests.length, beforeImport, 'Notebook import must not execute the R checkpoint');
}
