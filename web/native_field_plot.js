/* Bounded SVG line plots from actual native Flow field stdout, not MathFlow/NumPy. */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const START = "FLOWSTUDIO_FIELD_V1";
  const END = "FLOWSTUDIO_FIELD_END";
  const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
  const COLORS = ["#73c8f0", "#f4b978", "#b3dc9b", "#d4a8ee"];

  function parse(output) {
    if (typeof output !== "string")
      throw new TypeError("Native Flow output must be text.");
    // Ordinary Flow programs may print large outputs without a plot frame.
    if (output.length > 131072) {
      // The marker must begin a logical line and end at a header separator.
      // Substrings inside ordinary large stdout must not become plot errors.
      if (!/(?:^|\\r?\\n)[^\\S\\r\\n]*FLOWSTUDIO_FIELD_V1(?=[ \\t\\r\\n]|$)/.test(output))
        return null;
      throw new TypeError("Native Flow output exceeds the field plot limit.");
    }
    const lines = output.split(/\r?\n/).map(line => line.trim());
    // A similarly prefixed user message is not a protocol frame.
    // Accept whitespace (including tabs) between the exact marker and sizes.
    const starts = lines.flatMap((line, i) =>
      (line === START || line.startsWith(START + " ") ||
       line.startsWith(START + "\t")) ? [i] : []);
    if (!starts.length) return null;
    if (starts.length !== 1) throw new TypeError("Multiple native field plot blocks.");
    const at = starts[0];
    const header = lines[at].split(/\s+/);
    if (header.length !== 3 || header[0] !== START ||
        !/^[1-9]\d*$/.test(header[1]) || !/^[1-9]\d*$/.test(header[2]))
      throw new TypeError("Invalid native field plot header.");
    const count = Number(header[1]), species = Number(header[2]);
    if (!Number.isSafeInteger(count) || count < 3 || count > 512 ||
        !Number.isSafeInteger(species) || species > 4)
      throw new RangeError("Native field plot dimensions exceed limits.");
    if (lines[at + species + 1] !== END ||
        lines.slice(at + species + 2).includes(END))
      throw new TypeError("Incomplete or repeated native field plot block.");
    const fields = [];
    const names = new Set();
    for (let i = 0; i < species; i++) {
      const row = lines[at + i + 1]?.split(/\s+/) || [];
      if (row.length !== count + 1 || !NAME.test(row[0]) || names.has(row[0]))
        throw new TypeError("Invalid native field name or cell count.");
      names.add(row[0]);
      const values = row.slice(1).map(value => {
        if (!NUMBER.test(value)) throw new TypeError("Invalid native field value.");
        const number = Number(value);
        if (!Number.isFinite(number) || Math.abs(number) > 1e6)
          throw new RangeError("Native field value exceeds finite plotting limits.");
        return number;
      });
      fields.push({name:row[0], values});
    }
    return Object.freeze({count, fields});
  }

  function render(doc, container, output) {
    const data = parse(output);
    if (!data) return false;
    const values = data.fields.flatMap(field => field.values);
    const minimum = Math.min(...values), maximum = Math.max(...values);
    // Equal-valued fields need a genuine axis range; otherwise the plotted
    // curve sits on the bottom axis while both extrema labels claim its value.
    const constant = minimum === maximum;
    const padding = constant ? Math.max(1, Math.abs(minimum)) * 0.05 : 0;
    const plotMinimum = minimum - padding, plotMaximum = maximum + padding;
    const span = plotMaximum - plotMinimum;
    // Subtract before dividing: normalizing large, nearly equal values first
    // can round both extrema to the same floating-point number.
    const fraction = value => (value - plotMinimum) / span;
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 640 260");
    svg.setAttribute("width", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("data-native-flow-field", "true");
    svg.setAttribute("aria-label", "Native Flow computed spatial fields: " +
      data.fields.map(field => field.name).join(", "));
    const axis = doc.createElementNS(NS, "path");
    axis.setAttribute("d", "M48,16 V214 H616");
    axis.setAttribute("stroke", "#8897a8");
    axis.setAttribute("fill", "none");
    svg.append(axis);
    // Numeric labels and the zero line are derived from executed field data,
    // not from a static example or an assumed [0, 1] concentration range.
    for (const [value, y] of [[plotMaximum, 24], [plotMinimum, 214]]) {
      const tick = doc.createElementNS(NS, "text");
      tick.setAttribute("x", "44");
      tick.setAttribute("y", String(y));
      tick.setAttribute("text-anchor", "end");
      tick.setAttribute("fill", "#aab6c6");
      tick.setAttribute("font-size", "11");
      tick.setAttribute("data-native-flow-axis-value", String(value));
      tick.textContent = value.toPrecision(5);
      svg.append(tick);
    }
    if (minimum < 0 && maximum > 0) {
      const zero = doc.createElementNS(NS, "line");
      zero.setAttribute("x1", "48");
      zero.setAttribute("x2", "616");
      const zeroY = String(214 - 190 * fraction(0));
      zero.setAttribute("y1", zeroY);
      zero.setAttribute("y2", zeroY);
      zero.setAttribute("stroke", "#8897a8");
      zero.setAttribute("stroke-dasharray", "4 4");
      zero.setAttribute("data-native-flow-zero-axis", "true");
      svg.append(zero);
    }
    for (const [index, field] of data.fields.entries()) {
      const path = doc.createElementNS(NS, "path");
      const points = field.values.map((value, i) => {
        const x = 48 + 568 * i / (data.count - 1);
        const y = 214 - 190 * fraction(value);
        return (i ? "L" : "M") + x.toFixed(3) + "," + y.toFixed(3);
      });
      path.setAttribute("d", points.join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", COLORS[index]);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("data-field-name", field.name);
      svg.append(path);
      const legend = doc.createElementNS(NS, "text");
      legend.setAttribute("x", String(52 + 135 * index));
      legend.setAttribute("y", "244");
      legend.setAttribute("fill", COLORS[index]);
      legend.setAttribute("font-size", "13");
      legend.textContent = field.name;
      svg.append(legend);
    }
    const title = doc.createElement("h3");
    title.textContent = "Native Flow fields · " + data.count + " cells";
    container.replaceChildren(title, svg);
    container.hidden = false;
    return true;
  }

  const api = Object.freeze({parse, render});
  root.FlowStudioNativeFieldPlots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
