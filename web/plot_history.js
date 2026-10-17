/* Browser-local plot history. No source code or image bytes reach the server. */
(function (root) {
  "use strict";
  const MAX_PLOTS = 60;
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
  function validate(file) {
    if (!file || typeof file.name !== "string" || !/\.png$/i.test(file.name) ||
        (file.type && file.type !== "image/png")) {
      throw new TypeError("Only local PNG plots are supported.");
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES) {
      throw new RangeError("PNG plot must be between 1 byte and 16 MiB.");
    }
    return true;
  }
  function createHistory(urls, limit = MAX_PLOTS) {
    if (!urls || typeof urls.createObjectURL !== "function" ||
        typeof urls.revokeObjectURL !== "function") throw new TypeError("Object URL provider required");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PLOTS)
      throw new RangeError("History limit must be 1–60.");
    const entries = [];
    let nextId = 1, selected = null, totalBytes = 0;
    function add(file) {
      validate(file);
      const url = urls.createObjectURL(file);
      const item = Object.freeze({id: nextId++, name: file.name.slice(0, 255), url, size: file.size});
      entries.push(item);
      totalBytes += item.size;
      selected = item.id;
      while (entries.length > limit || totalBytes > MAX_TOTAL_BYTES) {
        const oldest = entries.shift();
        totalBytes -= oldest.size;
        urls.revokeObjectURL(oldest.url);
      }
      return item;
    }
    function current() { return entries.find(x => x.id === selected) || null; }
    function select(id) {
      if (!entries.some(x => x.id === id)) return false;
      selected = id;
      return true;
    }
    function remove(id) {
      const index = entries.findIndex(x => x.id === id);
      if (index < 0) return false;
      const [item] = entries.splice(index, 1);
      totalBytes -= item.size;
      urls.revokeObjectURL(item.url);
      if (selected === id) selected = entries.length ? entries[Math.min(index, entries.length - 1)].id : null;
      return true;
    }
    function clear() {
      for (const item of entries) urls.revokeObjectURL(item.url);
      entries.length = 0;
      totalBytes = 0;
      selected = null;
    }
    return Object.freeze({add, current, select, remove, clear, entries: () => entries.slice()});
  }
  const api = Object.freeze({createHistory, validate, MAX_PLOTS, MAX_BYTES, MAX_TOTAL_BYTES});
  root.FlowStudioPlots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
