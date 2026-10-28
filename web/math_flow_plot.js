/* Render bounded mathematical Flow observations as a real local SVG line graph. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const MAX_SAMPLES = 130;
  const SERIES = Object.freeze({
    kineticEnergy: "Kinetic energy",
    maximumDivergence: "Maximum divergence",
    meanTemperature: "Mean temperature",
    temperatureVariance: "Temperature variance"
  });
  function prepare(result) {
    if (!result || result.ok !== true || !Array.isArray(result.observations))
      throw new TypeError("Successful mathematical Flow observations are required.");
    const rows = result.observations;
    if (rows.length < 2 || rows.length > MAX_SAMPLES)
      throw new RangeError("Observation series must contain 2–130 samples.");
    const metrics = ("kinetic_energy" in result)
      ? ["kineticEnergy", "maximumDivergence"]
      : ("temperature_variance" in result)
        ? ["temperatureVariance", "meanTemperature"] : null;
    if (!metrics) throw new TypeError("Unsupported mathematical Flow result.");
    const times = [];
    const values = Object.fromEntries(metrics.map(metric => [metric, []]));
    for (const row of rows) {
      if (!row || typeof row.time !== "number" || !Number.isFinite(row.time) ||
          (times.length && row.time <= times[times.length - 1]))
        throw new TypeError("Observation times must be finite and strictly increasing.");
      times.push(row.time);
      for (const metric of metrics) {
        if (typeof row[metric] !== "number" || !Number.isFinite(row[metric]))
          throw new TypeError("Observation values must be finite numbers.");
        values[metric].push(row[metric]);
      }
    }
    if (times[0] !== 0 || !Number.isFinite(result.time) ||
        Math.abs(times[times.length - 1] - result.time) > 1e-9 * Math.max(1, result.time))
      throw new TypeError("Observation endpoints do not match the simulation.");
    return Object.freeze({ times, values, metrics });
  }
  function coordinates(series, metric) {
    if (!series.metrics.includes(metric)) throw new TypeError("Unknown metric.");
    const values = series.values[metric], times = series.times;
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
    const scaledMinimum = minimum / scale;
    const range = (maximum / scale - scaledMinimum) || 0.1;
    const start = times[0], duration = times[times.length - 1] - start;
    const points = values.map((value, index) => [
      54 + 548 * (times[index] - start) / duration,
      200 - 172 * (value / scale - scaledMinimum) / range
    ]);
    return { points, minimum, maximum,
      path: points.map(([x, y], index) => (index ? "L" : "M") +
        x.toFixed(3) + "," + y.toFixed(3)).join(" ") };
  }
  function render(doc, host, result) {
    const series = prepare(result);
    const heading = doc.createElement("h3");
    heading.textContent = "Mathematical Flow · numerical observations";
    const label = doc.createElement("label");
    label.textContent = "Quantity ";
    const select = doc.createElement("select");
    select.setAttribute("aria-label", "Mathematical Flow plotted quantity");
    for (const metric of series.metrics) {
      const option = doc.createElement("option");
      option.value = metric;
      option.textContent = SERIES[metric];
      select.append(option);
    }
    label.append(select);
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 640 240");
    svg.setAttribute("role", "img");
    svg.setAttribute("width", "100%");
    svg.setAttribute("aria-label", "Numerical observation time series");
    function element(name, attributes, value) {
      const node = doc.createElementNS(NS, name);
      for (const [key, attribute] of Object.entries(attributes)) node.setAttribute(key, String(attribute));
      if (value !== undefined) node.textContent = value;
      svg.append(node);
      return node;
    }
    function draw() {
      svg.replaceChildren();
      const metric = select.value;
      const curve = coordinates(series, metric);
      svg.setAttribute("aria-label", SERIES[metric] + " over simulated time");
      element("line", { x1: 54, y1: 28, x2: 54, y2: 200, stroke: "#9db0cb" });
      element("line", { x1: 54, y1: 200, x2: 602, y2: 200, stroke: "#9db0cb" });
      element("path", { d: curve.path, fill: "none", stroke: "#8fb8ff", "stroke-width": 2 });
      element("text", { x: 54, y: 19, fill: "#e7edf8", "font-size": 12 },
        SERIES[metric] + " (" + curve.maximum.toPrecision(5) + " max)");
      element("text", { x: 54, y: 219, fill: "#9db0cb", "font-size": 11 }, "0 s");
      element("text", { x: 602, y: 219, fill: "#9db0cb", "font-size": 11, "text-anchor": "end" },
        series.times[series.times.length - 1].toPrecision(5) + " s");
      element("text", { x: 58, y: 194, fill: "#9db0cb", "font-size": 10 },
        curve.minimum.toPrecision(5));
    }
    select.addEventListener("change", draw);
    host.replaceChildren(heading, label, svg);
    host.hidden = false;
    draw();
    return series;
  }
  const api = Object.freeze({ prepare, coordinates, render });
  root.FlowStudioMathPlots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
