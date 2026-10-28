"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const plots = require("../web/math_flow_plot.js");

const heat = {
  ok: true, time: 0.1, temperature_variance: 0.1,
  observations: [
    {time: 0, temperatureVariance: 0.5, meanTemperature: 300},
    {time: 0.05, temperatureVariance: 0.3, meanTemperature: 300},
    {time: 0.1, temperatureVariance: 0.1, meanTemperature: 300}
  ]
};

test("heat time-series lowering generates finite SVG coordinates", () => {
  const prepared = plots.prepare(heat);
  assert.deepEqual(prepared.metrics, ["temperatureVariance", "meanTemperature"]);
  const curve = plots.coordinates(prepared, "temperatureVariance");
  assert.equal(curve.points.length, 3);
  assert.equal(curve.points[0][0], 54);
  assert.equal(curve.points.at(-1)[0], 602);
  assert.match(curve.path, /^M54\.000,/);
  assert.ok(!curve.path.includes("NaN"));
  assert.ok(!curve.path.includes("Infinity"));
  assert.ok(plots.coordinates(prepared, "meanTemperature").points.every(p => p.every(Number.isFinite)));
});

test("Navier–Stokes plot metrics are selected from actual solver result shape", () => {
  const data = plots.prepare({
    ok: true, time: 0.1, kinetic_energy: 1,
    observations: [
      {time: 0, kineticEnergy: 2, maximumDivergence: 0.0001},
      {time: 0.1, kineticEnergy: 1, maximumDivergence: 0.00001}
    ]
  });
  assert.deepEqual(data.metrics, ["kineticEnergy", "maximumDivergence"]);
  assert.ok(plots.coordinates(data, "maximumDivergence").path.startsWith("M"));
  assert.throws(() => plots.coordinates(data, "meanTemperature"), /Unknown metric/);
});

test("reject malformed, nonmonotonic, nonfinite and unbounded plot data", () => {
  for (const rows of [
    [], [heat.observations[0]],
    [heat.observations[0], {...heat.observations[1], time: 0}],
    [heat.observations[0], {...heat.observations[1], temperatureVariance: Infinity}],
    Array.from({length: 131}, (_, i) => ({time: i / 130, meanTemperature: 300, temperatureVariance: 1}))
  ]) assert.throws(() => plots.prepare({...heat, observations: rows}));
  assert.throws(() => plots.prepare({...heat, time: 0.2}), /endpoints/);
  assert.throws(() => plots.prepare({...heat, ok: false}));
});

test("finite extreme values cannot overflow SVG scaling", () => {
  const extreme = plots.prepare({
    ...heat,
    observations: [
      {time: 0, meanTemperature: 300, temperatureVariance: -1e308},
      {time: 0.05, meanTemperature: 300, temperatureVariance: 0},
      {time: 0.1, meanTemperature: 300, temperatureVariance: 1e308}
    ]
  });
  const path = plots.coordinates(extreme, "temperatureVariance").path;
  assert.ok(!/NaN|Infinity/.test(path), path);
});

test("bounded real spatial grids are validated before SVG rendering", () => {
  const sample = {
    ...heat,
    spatial: {
      grid: [2, 2], source_grid: [32, 32], extent: [1, 1],
      fields: {temperature: [[300, 301], [302, 303]]}
    }
  };
  const valid = plots.prepareSpatial(sample);
  assert.deepEqual(valid.grid, [2, 2]);
  assert.equal(valid.fields.temperature[1][1], 303);
  assert.throws(() => plots.prepareSpatial({...sample,
    spatial: {...sample.spatial, grid: [25, 2]}}), /Invalid bounded/);
  assert.throws(() => plots.prepareSpatial({...sample,
    spatial: {...sample.spatial, fields: {temperature: [[300, NaN], [302, 303]]}}}),
    /finite/);
  assert.throws(() => plots.prepareSpatial({...sample,
    spatial: {...sample.spatial, fields: {temperature: [[300, 301]]}}}), /finite/);
});
