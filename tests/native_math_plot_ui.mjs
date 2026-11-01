/* Actual Chromium + native FlowStudio HTTP + NumPy PDE + SVG rendering acceptance. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8751', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(globalThis.FlowStudioEditor?.editor &&
    globalThis.FlowStudioMathPlots?.render));
  for (const [source, metric, other] of [
    ['examples/heat_equation_smoke.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_dirichlet.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_neumann.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_mixed_boundaries.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_per_face_boundaries.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_dirichlet_profile.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_neumann_profile.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_robin.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_robin_profile.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_robin_transfer_profile.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_anisotropic.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_cross_diffusion.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_cross_diffusion_compact.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_nonlinear_reaction.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_power_reaction.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_unicode_radicals.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_inverse_trigonometry.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_piecewise_forcing.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_boolean_mask.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_cubic_reaction.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_saturating_reaction.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_composed_forcing.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_mean_field_feedback.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_mean_preserving_mixing.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_spatial_moments.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_spatial_integral.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/heat_transport_reaction.flow', 'temperatureVariance', 'meanTemperature'],
    ['examples/navier_stokes_smoke.flow', 'kineticEnergy', 'maximumDivergence']
  ]) {
    await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
      readFileSync(source, 'utf8'));
    await page.locator('#runMathFlow').click();
    await page.waitForFunction(expected => {
      const plot = document.querySelector('#mathFlowPlot');
      return plot && !plot.hidden && plot.querySelector('select')?.value === expected &&
        plot.querySelector('svg path')?.getAttribute('d')?.length > 20;
    }, metric, {timeout: 30000});
    assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true');
    const spatial = page.locator('#mathFlowPlot svg[data-mathflow-spatial="true"]');
    assert.equal(await spatial.count(), 1, 'Real spatial SVG must render');
    assert.ok(await spatial.locator('rect').count() >= 16 * 16, 'Actual sampled heatmap cells');
    assert.match(await spatial.getAttribute('aria-label'), /Spatial/);
    if (source === 'examples/heat_spatial_integral.flow') {
      const inspector = page.locator('#mathFlowPlot [data-mathflow-semantic="rk2"]');
      assert.equal(await inspector.count(), 1,
        'Executed spatial integral must expose the actual RK2 semantic trace');
      assert.equal(await inspector.locator('ol li').count(), 2,
        'Integrated Fourier forcing must appear alongside diffusion');
      assert.match(await inspector.textContent(), /forcing/);
      await inspector.locator('select[aria-label="Mathematical Flow semantic stage"]').selectOption('1');
      assert.match(await inspector.textContent(), /predictor/i);
    }
    if (source === 'examples/heat_mean_field_feedback.flow') {
      const inspector = page.locator('#mathFlowPlot [data-mathflow-semantic="rk2"]');
      assert.equal(await inspector.count(), 1, 'Nonlocal PDE must show live RK2 semantic inspector');
      assert.equal(await inspector.locator('ol li').count(), 2,
        'Measured diffusion and nonlocal mean-field contributions must be shown');
      assert.match(await inspector.textContent(), /meanField/);
      assert.match(await inspector.textContent(), /Nonlocal feedback/);
      await inspector.locator('select[aria-label="Mathematical Flow semantic stage"]').selectOption('1');
      assert.match(await inspector.textContent(), /predictor/i);
    }
    if (source === 'examples/heat_mean_preserving_mixing.flow') {
      const inspector = page.locator('#mathFlowPlot [data-mathflow-semantic="rk2"]');
      assert.equal(await inspector.count(), 1, 'Mean-conserving PDE must expose live RK2 terms');
      assert.equal(await inspector.locator('ol li').count(), 2);
      assert.match(await inspector.textContent(), /meanDeviation/);
      assert.match(await inspector.textContent(), /Mean-conserving relaxation/);
      await inspector.locator('select[aria-label="Mathematical Flow semantic stage"]').selectOption('1');
      assert.match(await inspector.textContent(), /predictor/i);
    }
    if (source === 'examples/heat_composed_forcing.flow') {
      const inspector = page.locator('#mathFlowPlot [data-mathflow-semantic="rk2"]');
      assert.equal(await inspector.count(), 1, 'Real RK2 semantic inspector must render');
      assert.equal(await inspector.locator('ol li').count(), 6,
        'All six actual signed equation terms must be inspected');
      assert.match(await inspector.textContent(), /decomposition residual/);
      assert.match(await inspector.textContent(), /forcing/);
      await inspector.locator('select[aria-label="Mathematical Flow semantic stage"]').selectOption('1');
      assert.match(await inspector.textContent(), /predictor/i);
      assert.match(await inspector.textContent(), /t = 0\.000100000 s/);
    }
    if (source === 'examples/navier_stokes_smoke.flow') {
      const inspector = page.locator('#mathFlowPlot [data-mathflow-semantic="navier-rk2"]');
      assert.equal(await inspector.count(), 1,
        'Real Navier-Stokes numerical semantic inspector must render');
      assert.equal(await inspector.locator('ol').first().locator('li').count(), 2,
        'Both measured momentum RHS contributions must be visible');
      assert.equal(await inspector.locator('ol').nth(1).locator('li').count(), 3,
        'All three actual pressure projections must be visible');
      assert.match(await inspector.textContent(), /decomposition residual/);
      assert.match(await inspector.textContent(), /pressure projection/);
      await inspector.locator('select[aria-label="Mathematical Flow semantic stage"]').selectOption('1');
      assert.match(await inspector.textContent(), /t = 0\.000100000 s/);
      assert.match(await inspector.textContent(), /Viscous redistribution/);
    }
    if (source === 'examples/heat_neumann.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Neumann"]');
      assert.equal(await note.count(), 1, 'Native plot must display Neumann metadata');
      assert.match(await note.textContent(), /0 K\/m/);
    }
    if (source === 'examples/heat_mixed_boundaries.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Mixed"]');
      assert.equal(await note.count(), 1, 'Native plot must display mixed-axis metadata');
      assert.match(await note.textContent(), /x Dirichlet 300 K; y Neumann 0 K\/m/);
    }
    if (source === 'examples/heat_per_face_boundaries.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Faces"]');
      assert.equal(await note.count(), 1, 'Native plot must display four-face metadata');
      assert.match(await note.textContent(),
        /x min Dirichlet 300 K; x max Neumann 0 K\/m; y min Neumann 0 K\/m; y max Neumann 0 K\/m/);
    }
    if (source === 'examples/heat_dirichlet_profile.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Faces"]');
      assert.equal(await note.count(), 1, 'Native plot must show executed face profile');
      assert.match(await note.textContent(), /x min Dirichlet profile 300K\+2K\*sin/);
      assert.match(await note.textContent(), /1K\*t\/1s/);
    }
    if (source === 'examples/heat_neumann_profile.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Faces"]');
      assert.equal(await note.count(), 1, 'Native plot must show executed Neumann profile');
      assert.match(await note.textContent(), /x min Neumann profile 2K\/m\*sin/);
      assert.match(await note.textContent(), /1K\/m\*t\/1s/);
    }
    if (source === 'examples/heat_robin_transfer_profile.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Faces"]');
      assert.equal(await note.count(), 1, 'Native plot must show executed variable Robin transfer length');
      const description = await note.textContent();
      assert.ok(description.includes('x min Robin ambient profile 300K+2K*sin'), description);
      assert.ok(description.includes('transfer length profile 0.2m+0.05m*sin'), description);
      assert.ok(description.includes('0.01m*t/1s'), description);
    }
    if (source === 'examples/heat_robin_profile.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Faces"]');
      assert.equal(await note.count(), 1, 'Native plot must display executed Robin profile');
      const description = await note.textContent();
      assert.ok(description.includes('x min Robin ambient profile 300K+2K*sin'), description);
      assert.ok(description.includes('1K*t/1s, transfer length 0.2 m'), description);
    }
    if (source === 'examples/heat_robin.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Faces"]');
      assert.equal(await note.count(), 1, 'Native plot must display Robin face metadata');
      assert.match(await note.textContent(),
        /x min Robin ambient 300 K, transfer length 0.2 m; x max Neumann 0 K\/m/);
    }
    if (source === 'examples/heat_dirichlet.flow') {
      const note = page.locator('#mathFlowPlot [data-mathflow-boundary="Dirichlet"]');
      assert.equal(await note.count(), 1, 'Native plot must display actual boundary metadata');
      assert.match(await note.textContent(), /300 K/);
    }
    if (metric === 'kineticEnergy') {
      assert.ok(await spatial.locator('line').count() > 0, 'Velocity vectors must be drawn');
      assert.ok(await spatial.locator('polygon').count() > 0, 'Velocity arrows need direction');
    }
    const path = await page.locator('#mathFlowPlot svg path').getAttribute('d');
    assert.ok(path.startsWith('M') && path.includes('L'), path);
    assert.ok(!/NaN|Infinity/.test(path));
    await page.locator('#mathFlowPlot select[aria-label="Mathematical Flow plotted quantity"]').selectOption(other);
    assert.match(await page.locator('#mathFlowPlot svg').first().getAttribute('aria-label'),
      /over simulated time/);
    assert.equal(await page.locator('#mathFlowPlot select[aria-label="Mathematical Flow plotted quantity"]').inputValue(), other);
  }
  // Real Monaco Run button -> native Flow-owned HTTP -> upstream Flow 2.0
  // compiler-generated RK4 for eight coupled reaction/diffusion states.
  // This deliberately exercises the actual browser interaction, not only
  // fetch() from the Playwright page or the separate mathematical frontend.
  await page.locator('#language').selectOption('flow');
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_coupled_evolution2d.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-coupled-evolution2d-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-coupled-evolution2d-ok/);

  // Execute the distinct-neighbor 3x3 periodic heat PDE via the actual
  // Monaco Run control and upstream Flow compiler, not the Python math route.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_evolution_heat3x3.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-evolution-heat3x3-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-evolution-heat3x3-ok/);

  // Execute the full 18-state two-species 3x3 periodic PDE via Monaco's
  // actual Run button, upstream Flow 2.0 compiler and production HTTP route.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_coupled_evolution3x3.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-coupled-evolution3x3-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-coupled-evolution3x3-ok/);

  // Full 35-cell, three-Fourier-mode 5x7 native advection-diffusion gate:
  // exercise actual Monaco Run -> Flow-owned HTTP -> upstream flowc, not a
  // mocked fetch or the separate NumPy mathematical frontend.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_advection_diffusion_2d.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-advection-diffusion2d-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-advection-diffusion2d-ok/);

  // 256-cell tensor-diffusion acceptance through the real Monaco Run
  // button, native Flow HTTP and upstream compiler. All 256 numerical
  // assertions execute inside the checked-in Flow main().
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_tensor_grid.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-tensor-grid-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-tensor-grid-ok/);

  // Both 32x32 species must be independently computed by the real Flow
  // compiler and HTTP runtime, with 2048 actual DOM cells and per-field scales.
  await page.locator('#mathFlowPlot svg[data-native-flow-grid="true"]')
    .waitFor({timeout: 30000});
  assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true');
  const nativeGridSvg = page.locator('#mathFlowPlot svg[data-native-flow-grid="true"]');
  assert.equal(await nativeGridSvg.getAttribute('data-native-flow-grid-scale'), 'per-field');
  const nativeGridCells = page.locator('#mathFlowPlot rect[data-grid-value]');
  assert.equal(await nativeGridCells.count(), 2048);
  const quarterMode = phase => {
    const remainder = ((phase % 4) + 4) % 4;
    return remainder === 0 ? 1 : remainder === 2 ? -1 : 0;
  };
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [7, 11],
                         [16, 16], [23, 19], [31, 31]]) {
    for (const field of ['T', 'V']) {
      const cell = page.locator('#mathFlowPlot rect[data-field-name="' + field +
        '"][data-grid-x="' + x + '"][data-grid-y="' + y + '"]');
      assert.equal(await cell.count(), 1);
      const actual = Number(await cell.getAttribute('data-grid-value'));
      const expected = field === 'T' ?
        300 + 7 * Math.exp(-69.632 * .025) * quarterMode(x + y) +
              3 * Math.exp(-53.248 * .025) * quarterMode(x - y) :
        5 + .8 * Math.exp(-32.768 * .025) * quarterMode(x + y) -
            .3 * Math.exp(-40.96 * .025) * quarterMode(x - y);
      assert.ok(Math.abs(actual - expected) < (field === 'T' ? .002 : .00002),
        'Real native 2D ' + field + ' heatmap differs at ' + x + ',' + y);
    }
  }

  // Two genuinely cross-coupled 32x32 anisotropic PDE species, computed
  // through Monaco Run -> native HTTP -> production Flow compiler. The two
  // displayed fields are checked against a 2x2 matrix-exponential oracle.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_coupled_tensor32.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-coupled-tensor32-ok'),
    null, { timeout: 80000 });
  await page.waitForFunction(() =>
    document.querySelectorAll('#mathFlowPlot rect[data-field-name="U"]').length === 1024 &&
    document.querySelectorAll('#mathFlowPlot rect[data-field-name="V"]').length === 1024,
    null, { timeout: 30000 });
  const coupledSvg = page.locator('#mathFlowPlot svg[data-native-flow-grid="true"]');
  assert.equal(await coupledSvg.getAttribute('data-native-flow-grid-scale'), 'per-field');
  assert.equal(await page.locator('#mathFlowPlot rect[data-grid-value]').count(), 2048);
  const exactCoupledMode = (u, v, decayU, decayV) => {
    const center = -(decayU + decayV) / 2 - .35;
    const difference = (decayV - decayU) / 2;
    const radius = Math.hypot(difference, .35);
    const factor = Math.exp(center * .025);
    const cosine = Math.cosh(radius * .025);
    const sine = Math.sinh(radius * .025) / radius;
    return [factor * (cosine * u + sine * (difference * u + .35 * v)),
            factor * (cosine * v + sine * (.35 * u - difference * v))];
  };
  const coupledBase = exactCoupledMode(300, 5, 0, 0);
  const coupledPlus = exactCoupledMode(7, .8, 69.632, 32.768);
  const coupledMinus = exactCoupledMode(3, -.3, 53.248, 40.96);
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [7, 11],
                         [16, 16], [23, 19], [31, 31]]) {
    for (const [field, index] of [['U', 0], ['V', 1]]) {
      const cell = page.locator('#mathFlowPlot rect[data-field-name="' + field +
        '"][data-grid-x="' + x + '"][data-grid-y="' + y + '"]');
      assert.equal(await cell.count(), 1);
      const actual = Number(await cell.getAttribute('data-grid-value'));
      const expected = coupledBase[index] +
        coupledPlus[index] * quarterMode(x + y) +
        coupledMinus[index] * quarterMode(x - y);
      assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < .002,
        'Coupled native 2D ' + field + ' heatmap differs at ' + x + ',' + y);
    }
  }

  // Physical Chromium -> Monaco Run -> production Flow 2.0 HTTP ->
  // actual 16x16 heterogeneous finite-volume solution and SVG heatmap.
  // Reassemble the conservative sparse Markov operator independently here,
  // and verify every rendered cell rather than only the success marker.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_variable_diffusion16.flow', 'utf8'));
  const variableHttpResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/run/flow') &&
    response.request().method() === 'POST', { timeout: 90000 });
  await page.locator('#run').click();
  const variableHttpReply = await variableHttpResponse;
  assert.equal(variableHttpReply.status(), 200);
  const variableHttpBody = await variableHttpReply.text();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-variable-diffusion16-ok'),
    null, { timeout: 80000 });
  await page.waitForFunction(() =>
    document.querySelectorAll('#mathFlowPlot rect[data-field-name="U"]').length === 256,
    null, { timeout: 30000 });
  const variableCells = await page.locator('#mathFlowPlot rect[data-field-name="U"]')
    .evaluateAll(nodes => nodes.map(node => ({
      x: Number(node.getAttribute('data-grid-x')),
      y: Number(node.getAttribute('data-grid-y')),
      value: Number(node.getAttribute('data-grid-value'))
    })));
  assert.equal(variableCells.length, 256);
  const variableIndex = (x, y) => ((x + 16) % 16) + 16 * ((y + 16) % 16);
  const variableQuarter = value => [1, 0, -1, 0][((value % 4) + 4) % 4];
  const variableConductivity = Array.from({length:256}, (_, i) =>
    (i % 16 >= 8 ? .75 : .25) + (Math.floor(i / 16) < 8 ? .05 : 0));
  const variableRows = Array.from({length:256}, (_, i) => {
    const x = i % 16, y = Math.floor(i / 16);
    const adjacent = [variableIndex(x-1, y), variableIndex(x+1, y),
      variableIndex(x, y-1), variableIndex(x, y+1)];
    const edges = adjacent.map(j => [j, .2 * 2 * variableConductivity[i] *
      variableConductivity[j] / (variableConductivity[i] + variableConductivity[j])]);
    return [[i, 1 - edges.reduce((sum, [, weight]) => sum + weight, 0)], ...edges];
  });
  let variableExpected = Array.from({length:256}, (_, i) => {
    const x = i % 16, y = Math.floor(i / 16);
    return 20 + 3 * variableQuarter(x) + 2 * variableQuarter(y) +
      1.5 * variableQuarter(x + y);
  });
  for (let step = 0; step < 48; step++)
    variableExpected = variableRows.map(row =>
      row.reduce((sum, [j, weight]) => sum + weight * variableExpected[j], 0));
  const variableSeen = new Set();
  for (const cell of variableCells) {
    assert.ok(Number.isInteger(cell.x) && cell.x >= 0 && cell.x < 16 &&
      Number.isInteger(cell.y) && cell.y >= 0 && cell.y < 16);
    const i = variableIndex(cell.x, cell.y);
    assert.ok(!variableSeen.has(i), 'Duplicate heterogeneous grid cell');
    variableSeen.add(i);
    assert.ok(Number.isFinite(cell.value) &&
      Math.abs(cell.value - variableExpected[i]) < .002,
      'Native variable-conductivity heatmap mismatch at ' + cell.x + ',' + cell.y);
  }
  assert.equal(variableSeen.size, 256);
  // The same physical Chromium Run must also transport all 256 computed
  // seed-9137 non-Fourier values. Keep this second oracle independent of
  // the native Flow generator and of the SVG's original Fourier field.
  const seededFrame = variableHttpBody.match(
    /FLOWSTUDIO_SEEDED_GRID_V1 16 16 1\r?\nS ([^\r\n]+)\r?\nFLOWSTUDIO_SEEDED_GRID_END/);
  assert.ok(seededFrame, 'Native seeded grid missing from real browser HTTP response');
  const seededBrowserValues = seededFrame[1].trim().split(/\s+/).map(Number);
  assert.equal(seededBrowserValues.length, 256);
  let seededBrowserExpected = Array.from({length:256}, (_, i) => {
    const x = i % 16, y = Math.floor(i / 16);
    return 1 + .1 * ((9137 + 71 * x + 113 * y + 17 * x * y) % 251);
  });
  for (let step = 0; step < 48; step++)
    seededBrowserExpected = variableRows.map(row =>
      row.reduce((sum, [j, weight]) => sum + weight * seededBrowserExpected[j], 0));
  for (let i = 0; i < 256; i++)
    assert.ok(Number.isFinite(seededBrowserValues[i]) &&
      Math.abs(seededBrowserValues[i] - seededBrowserExpected[i]) < .002,
      'Native seeded non-Fourier browser HTTP mismatch at cell ' + i);
  assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true');

  // Real physical Chromium -> Monaco Run -> production Flow compiler/HTTP.
  // Both 8x8 images are computed z=0 slices of a coupled 8x8x8 volume.
  // Every displayed voxel is checked against an independent Fourier matrix
  // evolution, rather than just checking the success marker or SVG presence.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_coupled_volume8.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-coupled-volume8-ok'),
    null, { timeout: 80000 });
  await page.waitForFunction(() =>
    document.querySelectorAll('#mathFlowPlot rect[data-field-name="U"]').length === 64 &&
    document.querySelectorAll('#mathFlowPlot rect[data-field-name="V"]').length === 64,
    null, { timeout: 30000 });
  let volumeMeans = [300, 5];
  const volumeAmplitudes = [[7, 3, 2], [.8, -.5, 1.1]];
  const volumeRates = [[.18, .14, .24], [.11, .12, .16]];
  for (let step = 0; step < 64; step++) {
    const [u, v] = volumeMeans;
    volumeMeans = [.97 * u + .03 * v, .03 * u + .97 * v];
    for (let mode = 0; mode < 3; mode++) {
      const a = (1 - .4 * volumeRates[0][mode]) * volumeAmplitudes[0][mode];
      const b = (1 - .4 * volumeRates[1][mode]) * volumeAmplitudes[1][mode];
      volumeAmplitudes[0][mode] = .97 * a + .03 * b;
      volumeAmplitudes[1][mode] = .03 * a + .97 * b;
    }
  }
  const quarter = n => [1, 0, -1, 0][((n % 4) + 4) % 4];
  for (const [species, name] of ['U', 'V'].entries()) {
    const actual = await page.locator('#mathFlowPlot rect[data-field-name="' + name + '"]')
      .evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-grid-value'))));
    assert.equal(actual.length, 64);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const modes = [quarter(x+y), quarter(y), quarter(x+y)];
      const expected = volumeMeans[species] +
        modes.reduce((sum, mode, i) => sum + volumeAmplitudes[species][i] * mode, 0);
      assert.ok(Number.isFinite(actual[y*8+x]) &&
        Math.abs(actual[y*8+x] - expected) < .002,
        'Native 3D slice mismatch at ' + name + '(' + x + ',' + y + ')');
    }
  }

  // Upstream field/boundary/laplacian syntax: physical Chromium Monaco Run,
  // native HTTP and compiler-generated 32-cell Dirichlet Euler solver.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_field_heat1d.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-field-heat1d-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-field-heat1d-ok/);

  // Unequal nonzero Dirichlet boundaries with 64 compiler-generated field
  // cells, independent sine-mode assertions and affine steady-state checks.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_field_affine64.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-field-affine64-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-field-affine64-ok/);

  // Two separate compiler-generated fields with unequal boundaries and
  // diffusion rates. Actual Monaco Run -> native HTTP -> pinned Flow 2.0.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_field_dual48.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-field-dual48-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-field-dual48-ok/);

  // Real Chromium Monaco -> Flow HTTP -> upstream compiler: three distinct
  // PDE fields with directed exchange, 288 numerical assertions and a
  // computed three-curve SVG. No browser-side numerical substitute.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_field_cyclic32.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-field-cyclic32-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(),
    /native-field-cyclic32-ok/);
  await page.waitForFunction(() =>
    document.querySelectorAll('#mathFlowPlot path[data-field-name]').length === 3,
    null, { timeout: 30000 });
  for (const name of ['U', 'V', 'W']) {
    const path = await page.locator(
      '#mathFlowPlot path[data-field-name="' + name + '"]').getAttribute('d');
    assert.ok(path && path.startsWith('M'), 'Missing computed native curve ' + name);
  }
  assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true');
  // Every SVG coordinate must agree with the independently checked-in
  // 128-step spectral/matrix-power reference, not merely render three paths.
  const cyclicSource = readFileSync('examples/native_field_cyclic32.flow', 'utf8');
  const cyclicReferences = {};
  for (const name of ['U', 'V', 'W']) {
    const reference = new RegExp(
      'let expected' + name + '128: array<f64, 32> = \\[([\\s\\S]*?)\\]'
    ).exec(cyclicSource);
    assert.ok(reference, 'Missing three-field spectral reference ' + name);
    cyclicReferences[name] = reference[1].split(',')
      .filter(value => value.trim()).map(Number);
    assert.equal(cyclicReferences[name].length, 32);
  }
  const cyclicValues = Object.values(cyclicReferences).flat();
  const cyclicMin = Math.min(...cyclicValues);
  const cyclicMax = Math.max(...cyclicValues);
  const cyclicAxes = await page.locator(
    '#mathFlowPlot svg[data-native-flow-field] text[data-native-flow-axis-value]'
  ).evaluateAll(nodes => nodes.map(node =>
    Number(node.getAttribute('data-native-flow-axis-value'))));
  assert.equal(cyclicAxes.length, 2);
  assert.ok(Math.abs(cyclicAxes[0] - cyclicMax) < 1e-4);
  assert.ok(Math.abs(cyclicAxes[1] - cyclicMin) < 1e-4);
  for (const name of ['U', 'V', 'W']) {
    const path = await page.locator(
      '#mathFlowPlot path[data-field-name="' + name + '"]').getAttribute('d');
    const points = [...path.matchAll(/[ML]([0-9.]+),([0-9.]+)/g)];
    assert.equal(points.length, 32);
    for (const [index, match] of points.entries()) {
      const expectedX = 48 + 568 * index / 31;
      const expectedY = 214 - 190 *
        (cyclicReferences[name][index] - cyclicMin) / (cyclicMax - cyclicMin);
      assert.ok(Math.abs(Number(match[1]) - expectedX) < 0.001);
      assert.ok(Math.abs(Number(match[2]) - expectedY) < 0.02,
        'Compiler-executed cyclic field differs from independent reference');
    }
  }

  // Actual Chromium Monaco Run of two compiler-backed PDE fields with
  // nonlinear Gray-Scott cross-coupling and 384 numerical cell assertions.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_field_grayscott64.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-field-grayscott64-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-field-grayscott64-ok/);
  // The plotted curves must come from the compiler-executed Flow stdout,
  // not the separate NumPy MathFlow interpreter or a canned browser figure.
  await page.locator('#mathFlowPlot svg[data-native-flow-field="true"]')
    .waitFor({timeout:30000});
  assert.equal(await page.locator('#mathFlowPlot path[data-field-name]').count(), 2);
  assert.equal(await page.locator('#tab-plots').getAttribute('aria-selected'), 'true');
  const grayscottSource = readFileSync('examples/native_field_grayscott64.flow', 'utf8');
  const references = {};
  for (const name of ['U', 'V']) {
    const expectedMatch = new RegExp(
      'let expected' + name + '256: array<f64, 64> = \\[([\\s\\S]*?)\\]'
    ).exec(grayscottSource);
    assert.ok(expectedMatch, 'Missing checked-in independent numerical reference');
    references[name] = expectedMatch[1].split(',')
      .filter(value => value.trim()).map(Number);
    assert.equal(references[name].length, 64);
  }
  const allValues = [...references.U, ...references.V];
  const minimum = Math.min(...allValues), maximum = Math.max(...allValues);
  // Verify browser-rendered axes reflect the compiler's computed field
  // values, rather than static chart labels or a MathFlow fixture.
  const nativeAxes = await page.locator(
    '#mathFlowPlot svg[data-native-flow-field] text[data-native-flow-axis-value]'
  ).evaluateAll(nodes => nodes.map(node =>
    Number(node.getAttribute('data-native-flow-axis-value'))));
  assert.equal(nativeAxes.length, 2);
  assert.ok(Math.abs(nativeAxes[0] - maximum) < 1e-4,
    'Native field maximum axis must match executed numerical output');
  assert.ok(Math.abs(nativeAxes[1] - minimum) < 1e-4,
    'Native field minimum axis must match executed numerical output');
  assert.equal(await page.locator(
    '#mathFlowPlot svg[data-native-flow-field] [data-native-flow-zero-axis]'
  ).count(), 0, 'Nonnegative Gray-Scott concentrations have no zero-crossing axis');
  const scale = Math.max(1, Math.abs(minimum), Math.abs(maximum));
  const span = maximum / scale - minimum / scale || 1;
  for (const name of ['U', 'V']) {
    const path = await page.locator(
      '#mathFlowPlot path[data-field-name="' + name + '"]').getAttribute('d');
    const points = [...path.matchAll(/[ML]([0-9.]+),([0-9.]+)/g)];
    assert.equal(points.length, 64, 'Every native Flow cell must be plotted');
    for (const [index, match] of points.entries()) {
      const expectedX = 48 + 568 * index / 63;
      const expectedY = 214 - 190 * (references[name][index] / scale -
        minimum / scale) / span;
      assert.ok(Math.abs(Number(match[1]) - expectedX) < 0.001);
      assert.ok(Math.abs(Number(match[2]) - expectedY) < 0.02,
        'Native SVG profile differs from independent PDE reference');
    }
  }

  // A rejected Flow buffer must not leave the previous PDE's curves
  // visible. Both checks use Monaco's real Run control and UI preflight.
  await page.evaluate(() => globalThis.FlowStudioEditor.editor.setValue('   '));
  await page.locator('#run').click();
  assert.equal(await page.locator('#mathFlowPlot svg[data-native-flow-field]').count(), 0,
    'Empty Flow preflight must discard stale native PDE curves');
  assert.equal(await page.locator('#mathFlowPlot').isHidden(), true);
  await page.evaluate(() => globalThis.FlowStudioEditor.editor.setValue('x'.repeat(131073)));
  await page.locator('#run').click();
  assert.equal(await page.locator('#mathFlowPlot svg[data-native-flow-field]').count(), 0,
    'Oversized Flow preflight must not resurrect a previous PDE plot');
  assert.equal(await page.locator('#mathFlowPlot').isHidden(), true);

  // Six-state nonlinear spatial SIR evolution: Monaco -> native Flow HTTP
  // -> compiler-generated RK4. The checked-in Flow main() verifies the
  // independent numerical reference and exact nonlinear limiting cases.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_spatial_sir2.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-spatial-sir2-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-spatial-sir2-ok/);
  assert.equal(await page.locator('#mathFlowPlot svg[data-native-flow-field]').count(), 0,
    'Successful ordinary Flow execution must not retain Gray-Scott curves');
  assert.equal(await page.locator('#mathFlowPlot').isHidden(), true);

  // Twelve-state nonlinear periodic SIR: actual Monaco Run -> native HTTP ->
  // compiler-generated RK4 and twelve independent numerical assertions.
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    readFileSync('examples/native_spatial_sir4.flow', 'utf8'));
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-spatial-sir4-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-spatial-sir4-ok/);

  // Real Monaco Run -> native Flow HTTP -> upstream Flow 2.0 compiler.
  // HTTP stages sources without a relative import root, so concatenate
  // exactly the checked-in modules as the production HTTP smoke does.
  const mathSourceFiles = [
    'src/math_dimensions.flow',
    'src/math_expression_ir.flow',
    'src/math_expression_source.flow',
    'src/math_expression_source_http_smoke.flow'
  ];
  const nativeMathSource = mathSourceFiles.map(path =>
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter(line => !line.startsWith('import .math_dimensions {') &&
        !line.startsWith('import .math_expression_ir {') &&
        !line.startsWith('import .math_expression_source {'))
      .map(line => line.replace(/^export /, '')).join('\n')
  ).join('\n');
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    nativeMathSource);
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-math-source-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-math-source-ok/);

  // Run the real checked-in native trigonometric IR, parser, static analysis
  // and scalar equation acceptance through Monaco and the Flow HTTP server.
  const nativeTrigFiles = [
    'src/math_dimensions.flow',
    'src/math_expression_ir.flow',
    'src/math_expression_source.flow',
    'src/math_equation.flow',
    'src/math_static.flow',
    'src/math_trigonometry_smoke.flow'
  ];
  const nativeTrigSource = nativeTrigFiles.map(path =>
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter(line => !line.startsWith('import .math_dimensions {') &&
        !line.startsWith('import .math_expression_ir {') &&
        !line.startsWith('import .math_expression_source {') &&
        !line.startsWith('import .math_equation {') &&
        !line.startsWith('import .math_static {'))
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => line.replace(/^export /, '')).join('\n')
  ).join('\n');
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    nativeTrigSource);
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-math-trigonometry-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-math-trigonometry-ok/);

  // The native workbench must also execute the new hyperbolic parser, typed
  // IR, static dimension checker and scalar equations through actual Flow HTTP.
  const nativeHyperbolicFiles = [
    'src/math_dimensions.flow',
    'src/math_expression_ir.flow',
    'src/math_expression_source.flow',
    'src/math_equation.flow',
    'src/math_static.flow',
    'src/math_hyperbolic_smoke.flow'
  ];
  const nativeHyperbolicSource = nativeHyperbolicFiles.map(path =>
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter(line => !line.startsWith('import .math_dimensions {') &&
        !line.startsWith('import .math_expression_ir {') &&
        !line.startsWith('import .math_expression_source {') &&
        !line.startsWith('import .math_equation {') &&
        !line.startsWith('import .math_static {'))
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => line.replace(/^export /, '')).join('\n')
  ).join('\n');
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    nativeHyperbolicSource);
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-math-hyperbolic-ok'),
    null, { timeout: 80000 });
  assert.match(await page.locator('#console').textContent(), /native-math-hyperbolic-ok/);

  // Physical Chromium -> Monaco Run -> native HTTP -> Flow 2.0 compiler.
  // Execute the full checked-in 16-constraint, three-unknown SI solver;
  // it includes rank-deficient prefixes, Unicode, contradictions and
  // bounded work. No mock interpreter or precomputed output is involved.
  const nativeVariableFiles = [
    'src/math_dimensions.flow',
    'src/math_expression_ir.flow',
    'src/math_expression_source.flow',
    'src/math_equation.flow',
    'src/math_static.flow',
    'src/math_dimension_triple.flow',
    'src/math_dimension_variable.flow',
    'src/math_dimension_variable_smoke.flow'
  ];
  // Strip indentation in this brace-delimited Flow source bundle. The
  // 128-KiB production HTTP cap is intentional; whitespace is not syntax.
  const nativeVariableSource = nativeVariableFiles.map(path =>
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter(line => !/^import \.math_(dimensions|expression_ir|expression_source|equation|static|dimension_triple|dimension_variable) \{/.test(line))
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => line.trimStart().replace(/^export /, '')).join('\n')
  ).join('\n');
  assert.ok(Buffer.byteLength(nativeVariableSource, 'utf8') < 128 * 1024);
  assert.match(nativeVariableSource, /system\.count = 16/);
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    nativeVariableSource);
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-math-variable-constraints-ok'),
    null, { timeout: 120000 });
  assert.match(await page.locator('#console').textContent(),
    /native-math-variable-constraints-ok/);

  // Real Chromium -> Monaco Run -> production HTTP -> upstream Flow 2.0.
  // Exercise the newly compiled four-unknown SI system, not a JS substitute.
  const nativeFourFiles = [
    'src/math_dimensions.flow',
    'src/math_expression_ir.flow',
    'src/math_expression_source.flow',
    'src/math_equation.flow',
    'src/math_static.flow',
    'src/math_dimension_four.flow',
    'src/math_dimension_four_smoke.flow'
  ];
  const nativeFourSource = nativeFourFiles.map(path =>
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter(line => !/^import \.math_(dimensions|expression_ir|expression_source|equation|static|dimension_four) \{/.test(line))
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => line.trimStart().replace(/^export /, '')).join('\n')
  ).join('\n');
  assert.ok(Buffer.byteLength(nativeFourSource, 'utf8') < 128 * 1024);
  assert.match(nativeFourSource, /function determinant4\(/);
  assert.match(nativeFourSource, /native-math-dimension-four-ok/);
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    nativeFourSource);
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-math-dimension-four-ok'),
    null, { timeout: 120000 });
  assert.match(await page.locator('#console').textContent(),
    /native-math-dimension-four-ok/);

  // Actual Chromium -> Monaco Run -> native HTTP -> Flow 2.0.
  // Run all 16 bounded four-unknown constraint assertions, including the
  // late contradiction, Unicode identifiers, rank deficiency and radicals.
  const nativeVariableFourFiles = [
    'src/math_dimensions.flow',
    'src/math_expression_ir.flow',
    'src/math_expression_source.flow',
    'src/math_equation.flow',
    'src/math_static.flow',
    'src/math_dimension_four.flow',
    'src/math_dimension_variable_four.flow',
    'src/math_dimension_variable_four_smoke.flow'
  ];
  const nativeVariableFourSource = nativeVariableFourFiles.map(path =>
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter(line => !/^import \.math_(dimensions|expression_ir|expression_source|equation|static|dimension_four|dimension_variable_four) \{/.test(line))
      // Preserve all executable tokens and assertions. Flow blocks are
      // brace-delimited, so one cosmetic indentation level can be removed
      // alongside comments/blank lines to respect the real 128 KiB limit.
      .filter(line => line.trim() && !line.trimStart().startsWith('#'))
      .map(line => line.trimStart().replace(/^export /, '')).join('\n')
  ).join('\n');
  assert.ok(Buffer.byteLength(nativeVariableFourSource, 'utf8') < 128 * 1024);
  assert.match(nativeVariableFourSource, /system\.count = 16/);
  assert.match(nativeVariableFourSource, /native-math-variable-four-constraints-ok/);
  await page.evaluate(text => globalThis.FlowStudioEditor.editor.setValue(text),
    nativeVariableFourSource);
  await page.locator('#run').click();
  await page.waitForFunction(() =>
    document.querySelector('#console')?.textContent?.includes('native-math-variable-four-constraints-ok'),
    null, { timeout: 120000 });
  assert.match(await page.locator('#console').textContent(),
    /native-math-variable-four-constraints-ok/);

  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS: native mathematical Flow HTTP, linear/nonlinear NumPy PDEs and actual SVG plots in Chromium');
} finally {
  await browser.close();
}
