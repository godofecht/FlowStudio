/* Browser-local R session backed by the released webR WebAssembly runtime.
 * The webR package owns its internal worker; no R code is sent to FlowStudio's server.
 */
(function (global) {
"use strict";
const CDN = "https://webr.r-wasm.org/v0.6.0/webr.mjs";
const MAX_SOURCE_BYTES = 65536;
const MAX_OUTPUT = 131072;
const MAX_PLOTS = 8;
const R_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9.]{0,79}$/;
const PACKAGE_LIST = `local({
  p <- utils::installed.packages()[, c("Package", "Version"), drop=FALSE]
  n <- min(nrow(p), 1000L)
  if (n == 0L) character(0) else vapply(seq_len(n), function(i) {
    paste(utils::URLencode(p[i, 1L], reserved=TRUE),
          utils::URLencode(p[i, 2L], reserved=TRUE), sep="\\t")
  }, character(1))
})`;
const INSPECT = `local({
  n <- head(ls(envir=.GlobalEnv, all.names=FALSE), 100L)
  vapply(n, function(k) {
    v <- get(k, envir=.GlobalEnv, inherits=FALSE)
    fields <- c(k, paste(head(class(v), 3L), collapse="/"),
      paste(dim(v), collapse=" x "),
      substr(paste(capture.output(str(v, max.level=0L, give.attr=FALSE)), collapse=" "), 1L, 160L))
    paste(vapply(fields, utils::URLencode, character(1), reserved=TRUE), collapse="\\t")
  }, character(1))
})`;
function create({load = () => import(CDN)} = {}) {
  let runtime = null, loading = null, epoch = 0;
  let serial = Promise.resolve();
  function schedule(work) {
    const next = serial.then(work);
    serial = next.catch(() => {});
    return next;
  }
  async function get() {
    if (runtime) return runtime;
    if (!loading) {
      const generation = epoch;
      const initializing = (async () => {
        const {WebR, ChannelType} = await load();
        const instance = new WebR({channelType: ChannelType.PostMessage});
        try {
          await instance.init();
          if (generation !== epoch) throw Error("R session was reset during initialization.");
          runtime = instance;
          return instance;
        } catch (error) {
          try { await instance.close(); } catch (_) { /* preserve original initialization error */ }
          throw error;
        }
      })();
      const guarded = initializing.catch(error => {
        if (loading === guarded) loading = null;
        throw error;
      });
      loading = guarded;
    }
    return loading;
  }
  async function run(code) {
    if (typeof code !== "string" || !code.trim() ||
        new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
      return {ok:false, output:"R source is empty or exceeds 64 KiB.", images:[]};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset.", images:[]};
      let shelter = null;
      try {
        const r = await get();
        shelter = await new r.Shelter();
        const result = await shelter.captureR(code, {withAutoprint:true});
        let output = "", failed = false;
        for (const entry of result.output || []) {
          if (entry.type === "error") failed = true;
          const value = typeof entry.data === "string" ? entry.data : String(entry.data);
          const line = value + "\n";
          output += line.slice(0, Math.max(0, MAX_OUTPUT - output.length));
        }
        const images = Array.isArray(result.images) ? result.images.slice(0, MAX_PLOTS) : [];
        if (Array.isArray(result.images)) {
          for (const discarded of result.images.slice(MAX_PLOTS)) discarded.close?.();
        }
        if (generation !== epoch) {
          for (const image of images) image.close?.();
          return {ok:false, output:"R session reset.", images:[]};
        }
        return {ok:!failed, output:output || "(no output)", images};
      } catch (error) {
        return {ok:false, output:String(error).slice(0, MAX_OUTPUT), images:[]};
      } finally {
        if (shelter) await shelter.purge().catch(() => {});
      }
    });
  }
  async function inspect() {
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        const rows = await r.evalRRaw(INSPECT, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(rows) || rows.length > 100) throw Error("Invalid R environment response.");
        const variables = rows.map(row => {
          if (typeof row !== "string" || row.length > 4096) throw Error("Invalid R environment entry.");
          const fields = row.split("\t");
          if (fields.length !== 4) throw Error("Invalid R environment fields.");
          const [name, type, shape, preview] = fields.map(decodeURIComponent);
          return {name, type, shape:shape ? shape.split(" x ") : null, preview};
        });
        return {ok:true, variables};
      } catch (error) { return {ok:false, output:String(error).slice(0, 300)}; }
    });
  }
  async function packages() {
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        const rows = await r.evalRRaw(PACKAGE_LIST, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(rows) || rows.length > 1000)
          throw Error("Invalid R package inventory.");
        const entries = rows.map(row => {
          if (typeof row !== "string" || row.length > 512) throw Error("Invalid R package entry.");
          const fields = row.split("\t");
          if (fields.length !== 2) throw Error("Invalid R package fields.");
          const [name, version] = fields.map(decodeURIComponent);
          if (!R_PACKAGE_NAME.test(name) || name.includes("..") || name.endsWith(".") ||
              !version || version.length > 80) throw Error("Invalid R package metadata.");
          return {name, version};
        });
        return {ok:true, packages:entries};
      } catch (error) { return {ok:false, output:String(error).slice(0, 300)}; }
    });
  }
  async function installPackage(name) {
    if (typeof name !== "string" || !R_PACKAGE_NAME.test(name) ||
        name.includes("..") || name.endsWith("."))
      return {ok:false, output:"Enter a valid R package name (no versions, URLs or paths)."};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        await r.installPackages([name]);
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        return {ok:true};
      } catch (error) { return {ok:false, output:String(error).slice(0, 300)}; }
    });
  }
  function reset() {
    epoch++;
    if (runtime) { try { runtime.close(); } catch (_) { /* already closed */ } }
    runtime = null;
    loading = null;
  }
  return Object.freeze({run, inspect, packages, installPackage, reset});
}
function renderImages(target, images, document) {
  if (!Array.isArray(images) || !images.length) return 0;
  const holder = document.createElement("div");
  holder.setAttribute("aria-label", "R plots");
  let rendered = 0;
  for (const bitmap of images.slice(0, MAX_PLOTS)) {
    try {
      if (!Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) ||
          bitmap.width < 1 || bitmap.height < 1 ||
          bitmap.width > 4096 || bitmap.height > 4096) continue;
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "R plot " + (rendered + 1));
      canvas.style.maxWidth = "100%";
      canvas.style.height = "auto";
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.drawImage(bitmap, 0, 0);
      holder.append(canvas);
      rendered++;
    } finally { bitmap.close?.(); }
  }
  for (const bitmap of images.slice(MAX_PLOTS)) bitmap.close?.();
  if (rendered) target.replaceChildren(holder);
  return rendered;
}
const api = Object.freeze({create, renderImages, CDN});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioRSession = api;
})(globalThis);
