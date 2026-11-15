/* Figures drawn by Flow programs.
 *
 * plot, scatter and hist in src/flowstudio.flow print each figure as one
 * line: a record separator (U+001E), FLOWSTUDIO-PLOT, another record
 * separator, then the SVG. take() removes those lines from the output,
 * hands the figures to the Plots pane and leaves a short note in their
 * place, so the console shows text and the pane shows the figure.
 */
(function (root) {
"use strict";

const FRAME = /\u001eFLOWSTUDIO-PLOT\u001e([^\n]*)\n?/g;
const MAX_PER_RUN = 24;
const MAX_SVG_CHARS = 60000;

/* {text, plots}: the output without frames, and the SVG of each frame
 * that is a whole, bounded SVG document. */
function extract(output) {
  const text = String(output == null ? "" : output);
  const plots = [];
  let dropped = 0;
  const rest = text.replace(FRAME, (_, svg) => {
    const body = svg.trim();
    const valid = body.length <= MAX_SVG_CHARS && /^<svg[\s>]/.test(body) && body.endsWith("</svg>");
    if (!valid || plots.length >= MAX_PER_RUN) {
      dropped++;
      return "\u0000DROPPED\u0000";
    }
    plots.push(body);
    return "\u0000PLOT" + (plots.length - 1) + "\u0000";
  });
  return { text: rest, plots, dropped };
}

/* The output with each figure moved to the Plots pane. */
function take(output, options = {}) {
  const found = extract(output);
  if (!found.plots.length && !found.dropped) return String(output == null ? "" : output);
  const pane = options.pane || (root.FlowStudioPlotPane && root.FlowStudioPlotPane.attach(options.document));
  const labels = found.plots.map(svg => {
    if (!pane) return null;
    const label = pane.label("Flow");
    return pane.add({ kind: "svg", data: svg, label }).length ? label : null;
  });
  if (pane && labels.some(Boolean)) {
    const doc = options.document || root.document;
    const tab = doc && doc.getElementById("tab-plots");
    if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
  }
  return found.text.replace(/\u0000(?:PLOT(\d+)|DROPPED)\u0000/g, (_, index) => {
    if (index === undefined) return "(A Flow plot was too large to show.)\n";
    const label = labels[Number(index)];
    return label ? "(" + label + " is in the Plots pane.)\n" : "(The Plots pane is not available.)\n";
  });
}

const api = Object.freeze({ FRAME, MAX_PER_RUN, MAX_SVG_CHARS, extract, take });
root.FlowStudioFlowPlots = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
