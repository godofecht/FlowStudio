/* Real Chromium notebook acceptance against the Flow-owned localhost router.
 * Seed/oracle use persistent native Python; browser cells execute native Flow/R.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const example = name => readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8').trimEnd();
const origin = 'http://127.0.0.1:8751';

async function python(code) {
  const response = await fetch(origin + '/api/run/python', {
    method:'POST', headers:{'X-FlowStudio-Intent':'run'}, body:code,
    signal:AbortSignal.timeout(30000)
  });
  return {status:response.status, body:await response.text()};
}

export async function runThreeSpeciesBrowser({page, setNotebookSource, requests}) {
  const seed = await python(example('coupled_three_species_python.py'));
  assert.equal(seed.status, 200, seed.body.slice(0, 300));
  const fields = JSON.parse(seed.body);
  assert.deepEqual(Object.keys(fields).sort(), ['a', 'b', 'c']);
  const assignments = ['a', 'b', 'c'].map(name => {
    assert.equal(fields[name].length, 1024);
    assert.ok(fields[name].every(Number.isFinite));
    const code = 'flowstudio_three_initial_' + name + ' <- c(' +
      fields[name].map(value => value.toPrecision(17)).join(',') + ')';
    assert.ok(Buffer.byteLength(code, 'utf8') <= 65536);
    return code;
  });
  const source = [
    '# %% [flow]\n' + example('native_cyclic_network.flow') + '\n',
    ...assignments.map(code => '# %% [r]\n' + code + '\n'),
    '# %% [r]\n' + example('coupled_three_species_r.R') + '\n'
  ].join('');
  assert.ok(Buffer.byteLength(source, 'utf8') < 2 * 1024 * 1024);
  await page.locator('#language').selectOption('flow');
  await page.locator('#rRuntime').selectOption('native');
  const before = requests.length;
  await setNotebookSource(source);
  await page.locator('#runNotebook').click();
  await page.waitForFunction(() =>
    /^Notebook (executed|stopped|execution failed)/.test(
      document.querySelector('#notice')?.textContent || ''),
    null, {timeout:120000});
  assert.equal(await page.locator('#notice').innerText(), 'Notebook executed 5 cells.');
  assert.equal(await page.locator('#notebookOutput .notebook-cell').count(), 5);
  assert.deepEqual(requests.slice(before).filter(route => route.startsWith('/api/run/')),
    ['/api/run/flow', '/api/run/r', '/api/run/r', '/api/run/r', '/api/run/r']);
  const finalOutput = await page.locator('#notebookOutput .notebook-cell pre').last().textContent();
  const frame = finalOutput.split(/\r?\n/).filter(line => line.startsWith('FLOWSTUDIO_THREE_R_V1 '));
  assert.equal(frame.length, 1);
  const values = frame[0].slice('FLOWSTUDIO_THREE_R_V1 '.length).split(',').map(Number);
  assert.equal(values.length, 3072);
  assert.ok(values.every(Number.isFinite));
  const result = Object.fromEntries(['a', 'b', 'c'].map((name, i) =>
    [name, values.slice(i * 1024, (i + 1) * 1024)]));
  const verification = 'import json\nprint("chromium-three-species-oracle-ok", verify_result(json.loads(' +
    JSON.stringify(JSON.stringify(result)) + ')))';
  assert.ok(Buffer.byteLength(verification, 'utf8') < 131072);
  const checked = await python(verification);
  assert.equal(checked.status, 200, checked.body.slice(0, 400));
  assert.match(checked.body, /chromium-three-species-oracle-ok/);
  const image = page.locator('#notebookOutput .notebook-cell img').last();
  await image.waitFor({timeout:30000});
  assert.match(await image.getAttribute('src'), /^data:image\/png;base64,iVBORw0KGgo/);
  assert.equal(await image.evaluate(node => node.naturalWidth > 0 && node.naturalHeight > 0), true);

  await page.waitForFunction(() => !document.querySelector('#runNotebook').disabled);
  const downloadPromise = page.waitForEvent('download', {timeout:15000});
  await page.locator('#saveFlowNotebook').click();
  const saved = JSON.parse(readFileSync(await (await downloadPromise).path(), 'utf8'));
  assert.equal(saved.source, source);
  assert.equal(saved.results.length, 5);
  assert.equal(saved.results[4].plots.length, 1);
  assert.match(saved.results[4].plots[0].png, /^iVBORw0KGgo/);
  assert.match(saved.results[4].output, /FLOWSTUDIO_THREE_R_V1/);

  // The real R kernel must reject corrupted field data and stop before a
  // later cell can mutate its persistent environment.
  await setNotebookSource([
    '# %% [r]\nflowstudio_three_initial_a[1] <- NaN\n',
    '# %% [r]\n' + example('coupled_three_species_r.R') + '\n',
    '# %% [r]\nflowstudio_three_unexpected <- TRUE\n'
  ].join(''));
  await page.locator('#runNotebook').click();
  await page.waitForFunction(() =>
    document.querySelector('#notice')?.textContent.startsWith('Notebook stopped after 2 cells:'),
    null, {timeout:90000});
  assert.equal(await page.locator('#notebookOutput .notebook-cell').count(), 2);
  assert.match(await page.locator('#notebookOutput').innerText(), /three-species input must be finite/);
  const noSideEffect = await page.evaluate(async () => {
    const response = await fetch('/api/run/r', {method:'POST',
      headers:{'X-FlowStudio-Intent':'run'},
      body:"stopifnot(!exists('flowstudio_three_unexpected', inherits=TRUE)); cat('three-stop-ok\\n')"});
    return {status:response.status, body:await response.text()};
  });
  assert.equal(noSideEffect.status, 200);
  assert.match(noSideEffect.body, /three-stop-ok/);

  // Portable restoration must not execute the saved five-cell source.
  const beforeImport = requests.length;
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#flowNotebookFile').setInputFiles({
    name:'three-species-physical.fsnb', mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(saved))
  });
  await page.waitForFunction(() =>
    document.querySelector('#notice')?.textContent.startsWith(
      'FlowStudio notebook imported with saved outputs; interpreter state was not restored.'),
    null, {timeout:30000});
  assert.equal(await page.locator('#source').inputValue(), source);
  assert.equal(await page.locator('#notebookOutput .notebook-cell').count(), 5);
  assert.equal(await page.locator('#notebookOutput .notebook-cell img').count(), 1);
  assert.equal(requests.length, beforeImport, 'Import must not re-execute the PDE');
}
