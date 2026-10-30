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

  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('PASS: native mathematical Flow HTTP, linear/nonlinear NumPy PDEs and actual SVG plots in Chromium');
} finally {
  await browser.close();
}
