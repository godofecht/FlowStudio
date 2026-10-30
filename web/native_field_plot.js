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
    if (typeof output !== "string" || output.length > 131072)
      throw new TypeError("Native Flow output exceeds the field plot limit.");
    const lines = output.split(/\r?\n/).map(line => line.trim());
    const starts = lines.flatMap((line, i) => line.startsWith(START) ? [i] : []);
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
    const scale = Math.max(1, Math.abs(minimum), Math.abs(maximum));
    const lo = minimum / scale, hi = maximum / scale;
    const span = hi - lo || 1;
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
    for (const [index, field] of data.fields.entries()) {
      const path = doc.createElementNS(NS, "path");
      const points = field.values.map((value, i) => {
        const x = 48 + 568 * i / (data.count - 1);
        const y = 214 - 190 * ((value / scale - lo) / span);
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
