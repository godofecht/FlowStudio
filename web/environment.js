/* FlowStudio environment inspection: browser-side rendering only.
 * Expects the JSON schema returned by /api/inspect/{python,r}.
 */
(function (root) {
  "use strict";

  const MAX_VARIABLES = 200;
  const MAX_NAME = 256;
  const MAX_PREVIEW = 160;

  function normalize(payload) {
    if (!payload || !Array.isArray(payload.variables)) {
      throw new TypeError("Invalid environment response");
    }
    return payload.variables.slice(0, MAX_VARIABLES).map(item => ({
      name: String(item.name ?? "").slice(0, MAX_NAME),
      type: String(item.type ?? "").slice(0, MAX_NAME),
      preview: String(item.preview ?? "").slice(0, MAX_PREVIEW)
    }));
  }

  function render(container, payload, doc = document) {
    const variables = normalize(payload);
    const table = doc.createElement("table");
    table.className = "environment-table";
    table.setAttribute("aria-label", "Session variables");

    const heading = doc.createElement("thead");
    const headerRow = doc.createElement("tr");
    for (const title of ["Name", "Type", "Value"]) {
      const th = doc.createElement("th");
      th.textContent = title;
      th.scope = "col";
      headerRow.append(th);
    }
    heading.append(headerRow);
    table.append(heading);

    const body = doc.createElement("tbody");
    for (const item of variables) {
      const row = doc.createElement("tr");
      for (const key of ["name", "type", "preview"]) {
        const cell = doc.createElement("td");
        cell.textContent = item[key];
        cell.title = item[key];
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    container.replaceChildren(table);
    return variables.length;
  }

  async function inspect(language, fetcher = fetch) {
    if (language !== "python" && language !== "r") {
      throw new RangeError("Only Python and R have persistent environments");
    }
    const response = await fetcher("/api/inspect/" + language, {
      method: "POST",
      headers: {"X-FlowStudio-Intent": "run"}
    });
    if (!response.ok) {
      throw new Error("Inspection failed (HTTP " + response.status + "): " +
        (await response.text()).slice(0, 300));
    }
    return normalize(await response.json());
  }

  async function reset(language, fetcher = fetch) {
    if (language !== "python" && language !== "r") {
      throw new RangeError("Only Python and R have persistent environments");
    }
    const response = await fetcher("/api/reset/" + language, {
      method: "POST",
      headers: {"X-FlowStudio-Intent": "run"}
    });
    if (!response.ok) {
      throw new Error("Session reset failed (HTTP " + response.status + ")");
    }
    return response.text();
  }

  const api = Object.freeze({normalize, render, inspect, reset});
  root.FlowStudioEnvironment = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
