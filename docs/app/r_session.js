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
const INSPECT = `base::local({
  rows <- base::character(0)
  bytes <- 0L
  truncated <- FALSE
  encode <- function(value) utils::URLencode(base::substr(base::enc2utf8(value), 1L, 160L), reserved=TRUE)
  push <- function(depth, name, kind, shape, preview, more=FALSE) {
    row <- base::paste(depth, encode(name), encode(kind), encode(shape), encode(preview),
                 if (more) "1" else "0", sep="\t")
    size <- base::nchar(row, type="bytes")
    if (base::length(rows) >= 256L || bytes + size > 65000L) {
      truncated <<- TRUE
      base::return(FALSE)
    }
    rows <<- base::c(rows, row)
    bytes <<- bytes + size
    TRUE
  }
  describe <- function(name, value, depth) {
    plain <- !base::is.object(value)
    raw_type <- base::typeof(value)
    dimensions <- base::attr(value, "dim", exact=TRUE)
    shape <- if (base::is.integer(dimensions) && base::length(dimensions) > 0L &&
                 base::length(dimensions) <= 8L && base::all(!base::is.na(dimensions)) &&
                 base::all(dimensions >= 0L)) base::paste(dimensions, collapse=" x ") else ""
    classes <- base::attr(value, "class", exact=TRUE)
    # Exact base data.frames store row/column labels as ordinary attributes.
    # Reading their lengths avoids dispatching a user-defined dim() method.
    if (base::identical(classes, "data.frame") && base::identical(raw_type, "list")) {
      columns <- base::attr(value, "names", exact=TRUE)
      rownames <- base::attr(value, "row.names", exact=TRUE)
      if (base::is.character(columns) &&
          (base::is.integer(rownames) || base::is.character(rownames)) &&
          base::length(columns) <= 1000000L && base::length(rownames) <= 1000000L)
        shape <- base::paste(base::length(rownames), base::length(columns), sep=" x ")
    }
    kind <- if (base::is.character(classes) && base::length(classes) > 0L) {
      base::paste(utils::head(classes, 3L), collapse="/")
    } else if (base::nzchar(shape)) {
      base::paste0("matrix/array (", raw_type, ")")
    } else {
      raw_type
    }
    size <- if (plain && raw_type %in% base::c("logical", "integer", "double",
              "complex", "character", "raw", "list")) base::length(value) else NA_integer_
    preview <- if (!base::is.na(size) && size == 1L &&
                   base::is.null(base::attributes(value)) &&
                   raw_type %in% base::c("logical", "integer", "double", "character") &&
                   !base::is.na(value[1L]) &&
                   (raw_type != "double" || base::is.finite(value[1L]))) {
      base::substr(base::as.character(value[1L]), 1L, 120L)
    } else if (!base::is.na(size)) {
      base::paste0(raw_type, " [", size, "]")
    } else {
      base::paste0("<", raw_type, ">")
    }
    # Exact base data.frames expose names without reading their column values.
    # Do not invoke user-defined extraction or class methods for completion.
    frame <- base::identical(classes, "data.frame") && base::identical(raw_type, "list")
    columns <- if (frame) base::attr(value, "names", exact=TRUE) else NULL
    frame_names <- frame && base::is.character(columns) &&
      base::length(columns) == base::length(value) && !base::anyNA(columns)
    count <- if (depth < 2L && plain && base::identical(raw_type, "list"))
      base::min(size, 12L) else if (depth < 2L && frame_names)
      base::min(base::length(columns), 12L) else 0L
    more <- depth < 2L && ((plain && base::identical(raw_type, "list")) || frame_names) &&
      base::length(value) > count
    if (!push(depth, name, kind, shape, preview, more)) base::return(FALSE)
    if (count > 0L) {
      labels <- base::attr(value, "names", exact=TRUE)
      for (index in base::seq_len(count)) {
        if (base::length(rows) >= 256L) { truncated <<- TRUE; break }
        label <- base::paste0("[[", index, "]]")
        if (base::is.character(labels) && base::length(labels) >= index &&
            !base::is.na(labels[index]) && base::nzchar(labels[index]))
          label <- base::paste0(label, " ", base::substr(labels[index], 1L, 80L))
        if (frame) {
          if (!push(depth + 1L, label, "column", "", "<column>")) break
        } else if (!describe(label, value[[index]], depth + 1L)) break
      }
    }
    TRUE
  }
  names <- base::ls(envir=base::globalenv(), all.names=FALSE)
  if (base::length(names) > 128L) truncated <- TRUE
  for (name in utils::head(names, 128L)) {
    if (base::length(rows) >= 256L) { truncated <- TRUE; break }
    if (base::bindingIsActive(name, base::globalenv())) {
      if (!push(0L, name, "active binding", "", "<not evaluated>")) break
    } else {
      binding <- base::tryCatch(
        base::list(ok=TRUE, value=base::get(name, envir=base::globalenv(), inherits=FALSE)),
        error=function(e) base::list(ok=FALSE))
      if (!binding$ok) {
        if (!push(0L, name, "unavailable", "", "<failed binding>")) break
      } else if (!describe(name, binding$value, 0L)) break
    }
  }
  base::c(if (truncated) "@1" else "@0", rows)
})`;
function parseInspection(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 257 ||
      !["@0", "@1"].includes(rows[0]))
    throw Error("Invalid R environment response.");
  const variables = [], stack = [];
  for (const row of rows.slice(1)) {
    if (typeof row !== "string" || row.length > 4096)
      throw Error("Invalid R environment entry.");
    const fields = row.split("\t");
    if (fields.length !== 6 || !/^[012]$/.test(fields[0]) || !/^[01]$/.test(fields[5]))
      throw Error("Invalid R environment fields.");
    const depth = Number(fields[0]);
    const [name, type, shape, preview] = fields.slice(1, 5).map(decodeURIComponent);
    if (!name || name.length > 160 || type.length > 160 || shape.length > 160 ||
        preview.length > 160 || [name, type, shape, preview].some(x => x.includes("\0")))
      throw Error("Invalid R environment metadata.");
    const node = {name, type, shape:shape ? shape.split(" x ") : null, preview};
    if (fields[5] === "1") node.truncated = true;
    if (depth === 0) {
      if (variables.length >= 128) throw Error("R environment exceeds variable limit.");
      variables.push(node);
    } else {
      const parent = stack[depth - 1];
      if (!parent || !["list", "data.frame"].includes(parent.type))
        throw Error("Invalid R environment nesting.");
      if (!parent.children) parent.children = [];
      if (parent.children.length >= 12) throw Error("R environment exceeds child limit.");
      parent.children.push(node);
    }
    stack.length = depth;
    stack[depth] = node;
  }
  return {ok:true, variables, truncated:rows[0] === "@1"};
}
const HELP_NAME = /^[A-Za-z][A-Za-z0-9._]{0,79}(?:::[A-Za-z][A-Za-z0-9._]{0,79})?$/;
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9._]{0,119}$/;
function tableQuery(name) {
  return `local({
    v <- get(${JSON.stringify(name)}, envir=.GlobalEnv, inherits=FALSE)
    if (!(is.data.frame(v) || is.matrix(v))) stop("Select a data.frame or matrix")
    nr <- nrow(v); nc <- ncol(v)
    if (nc < 1L) stop("No tabular columns")
    take_r <- min(nr, 200L); take_c <- min(nc, 32L)
    cols <- colnames(v)
    if (is.null(cols)) cols <- paste0("Column ", seq_len(nc))
    cols <- cols[seq_len(take_c)]
    encode <- function(x) utils::URLencode(substr(as.character(x), 1L, 160L), reserved=TRUE)
    lines <- vapply(seq_len(take_r), function(i) {
      cells <- vapply(seq_len(take_c), function(j) {
        cell <- v[i, j, drop=TRUE]
        if (!length(cell) || is.na(cell[1L])) return("")
        encode(cell[1L])
      }, character(1))
      paste(cells, collapse="\\t")
    }, character(1))
    c(paste(nr, nc, sep="\\t"), paste(vapply(cols, encode, character(1)), collapse="\\t"), lines)
  })`;
}
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
  async function checkSyntax(code) {
    if (typeof code !== "string" || !code.trim() ||
        new TextEncoder().encode(code).length > MAX_SOURCE_BYTES)
      return {ok:false, output:"R source is empty or exceeds 64 KiB.", diagnostics:[]};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset.", diagnostics:[]};
      try {
        const r = await get();
        // parse() checks grammar only; it never evaluates the user's expressions.
        const query = 'local({ tryCatch({ parse(text=' + JSON.stringify(code) +
          ', keep.source=TRUE); c("ok") }, error=function(e) c(paste0("error\\t", utils::URLencode(conditionMessage(e), reserved=TRUE)))) })';
        const rows = await r.evalRRaw(query, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset.", diagnostics:[]};
        if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== "string" ||
            rows[0].length > 4096) throw Error("Invalid R syntax diagnostic response.");
        if (rows[0] === "ok") return {ok:true, diagnostics:[]};
        if (!rows[0].startsWith("error\t")) throw Error("Invalid R syntax diagnostic response.");
        const message = decodeURIComponent(rows[0].slice(6)).slice(0, 300);
        const match = message.match(/(?:<text>|[^\s:]+):(\d+):(\d+):/);
        return {ok:false, diagnostics:[{message, line:match ? Number(match[1]) : 1,
          column:match ? Number(match[2]) : 1}]};
      } catch (error) {
        return {ok:false, output:String(error).slice(0, 300), diagnostics:[]};
      }
    });
  }
  async function help(name) {
    if (typeof name !== "string" || name.length > 120 || !HELP_NAME.test(name))
      return {ok:false, output:"Enter an R help topic or package::topic."};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        const parts = name.split("::");
        const topic = parts.length === 2 ? parts[1] : parts[0];
        const packageArg = parts.length === 2 ? ", package=" + JSON.stringify(parts[0]) : "";
        // Read installed Rd help; do not evaluate the topic as an R expression.
        const query = 'local({ tryCatch({ h <- utils::help(' + JSON.stringify(topic) +
          packageArg + '); if (length(h) == 0L) stop("No installed help for this topic"); ' +
          'lines <- capture.output(tools::Rd2txt(utils:::.getHelpFile(h))); ' +
          'c("ok", utils::URLencode(substr(paste(lines, collapse="\\n"), 1L, 12000L), reserved=TRUE)) ' +
          '}, error=function(e) c("error", utils::URLencode(substr(conditionMessage(e), 1L, 300L), reserved=TRUE))) })';
        const rows = await r.evalRRaw(query, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(rows) || rows.length !== 2 ||
            rows.some(row => typeof row !== "string" || row.length > 36000) ||
            !["ok", "error"].includes(rows[0]))
          throw Error("Invalid R help response.");
        const value = decodeURIComponent(rows[1]);
        if (rows[0] === "error") return {ok:false, output:value.slice(0, 300)};
        if (value.length > 12000) throw Error("R help response exceeds limit.");
        return {ok:true, name, doc:value};
      } catch (error) { return {ok:false, output:String(error).slice(0, 300)}; }
    });
  }
  async function complete(prefix) {
    if (typeof prefix !== "string" || !/^[A-Za-z.][A-Za-z0-9._]{0,79}$/.test(prefix))
      return {ok:false, output:"Invalid R completion prefix."};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        // Search-path names only; no get(), eval(), active-binding reads or source execution.
        const query = 'local({ n <- unique(unlist(lapply(head(search(), 16L), function(p) ' +
          'ls(envir=as.environment(p), all.names=FALSE)), use.names=FALSE)); ' +
          'n <- n[nchar(n) <= 80L & grepl("^[A-Za-z.][A-Za-z0-9._]*$", n) & ' +
          'startsWith(n, ' + JSON.stringify(prefix) + ')]; head(sort(n), 64L) })';
        const items = await r.evalRRaw(query, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(items) || items.length > 64 ||
            !items.every(name => typeof name === "string" &&
              /^[A-Za-z.][A-Za-z0-9._]{0,79}$/.test(name) && name.startsWith(prefix)))
          throw Error("Invalid R completion response.");
        return {ok:true, items};
      } catch (error) { return {ok:false, output:String(error).slice(0, 300)}; }
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
        return parseInspection(rows);
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
  async function table(name) {
    if (typeof name !== "string" || !TABLE_NAME.test(name))
      return {ok:false, output:"Invalid R variable name."};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        const lines = await r.evalRRaw(tableQuery(name), "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(lines) || lines.length < 2 || lines.length > 202 ||
            lines.some(line => typeof line !== "string" || line.length > 16384))
          throw Error("Invalid R table response.");
        const counts = lines[0].split("\t");
        if (counts.length !== 2 || !counts.every(x => /^(0|[1-9][0-9]*)$/.test(x)))
          throw Error("Invalid R table dimensions.");
        const totalRows = Number(counts[0]), totalColumns = Number(counts[1]);
        if (!Number.isSafeInteger(totalRows) || !Number.isSafeInteger(totalColumns) ||
            totalColumns < 1 || totalColumns > 1000000 || totalRows < lines.length - 2)
          throw Error("Invalid R table dimensions.");
        const columns = lines[1].split("\t").map(decodeURIComponent);
        if (!columns.length || columns.length > 32 || columns.length !== Math.min(totalColumns, 32))
          throw Error("Invalid R table columns.");
        const rows = lines.slice(2).map(line => line.split("\t").map(decodeURIComponent));
        if (rows.some(row => row.length !== columns.length || row.some(x => x.length > 160)) ||
            columns.some(x => x.length > 160)) throw Error("Invalid R table cell.");
        const result = {columns, rows, totalRows, truncated:totalRows > 200 || totalColumns > 32};
        if (JSON.stringify(result).length > 1048576) throw Error("R table exceeds 1 MiB.");
        return {ok:true, table:result};
      } catch (error) { return {ok:false, output:String(error).slice(0, 300)}; }
    });
  }
  // Export only classless, non-missing atomic vectors. Never evaluate a variable name as source.
  async function exportVariable(name) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))
      return {ok:false, output:"Invalid shared Python/R variable name."};
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        const query = 'local({ n <- ' + JSON.stringify(name) +
          '; if (!base::exists(n, envir=.GlobalEnv, inherits=FALSE) || ' +
          'base::bindingIsActive(n, .GlobalEnv)) stop("Unknown or active R binding"); ' +
          'v <- base::get(n, envir=.GlobalEnv, inherits=FALSE); ' +
                     "if (base::is.data.frame(v)) { " +
           "if (!base::identical(base::class(v), \"data.frame\") || base::ncol(v) < 1L || " +
           "base::ncol(v) > 16L || base::nrow(v) > 128L || " +
           "!base::identical(base::rownames(v), base::as.character(base::seq_len(base::nrow(v))))) " +
           "stop(\"Only bounded plain R data.frames with default row names can be transferred\"); " +
           "cn <- base::names(v); " +
           "if (base::anyDuplicated(cn) || base::any(!base::grepl(\"^[A-Za-z][A-Za-z0-9_]{0,79}$\", cn))) " +
           "stop(\"Invalid R table column names\"); " +
           "out <- base::unlist(base::lapply(base::seq_along(v), function(i) { " +
           "col <- v[[i]]; ct <- base::typeof(col); " +
           "if (!base::is.null(base::attributes(col)) || " +
           "!(ct %in% c(\"double\",\"integer\",\"logical\",\"character\"))) " +
           "stop(\"Only plain atomic R table columns can be transferred\"); " +
           "if (ct %in% c(\"double\",\"integer\") && (base::any(base::is.infinite(col)) || " +
           "base::any(base::is.nan(col)) || " +
           "base::any(base::abs(col[!base::is.na(col)]) > 9007199254740991))) " +
           "stop(\"R table number is not finite or safe\"); " +
           "if (ct == \"character\" && " +
           "base::any(base::nchar(col[!base::is.na(col)], type=\"chars\") > 512L)) " +
           "stop(\"R table string exceeds limit\"); " +
           "formatted <- if (ct == \"double\") base::format(col, digits=17L, scientific=TRUE, trim=TRUE, decimal.mark=\".\") else base::as.character(col); " +
           "base::c(utils::URLencode(cn[[i]], reserved=TRUE), ct, " +
           "base::vapply(base::seq_along(col), function(j) if (base::is.na(col[[j]])) \"@NA@\" else " +
           "utils::URLencode(formatted[[j]], reserved=TRUE), character(1))) " +
           "}), use.names=FALSE); " +
           "base::c(\"@TABLE@\", base::as.character(base::ncol(v)), base::as.character(base::nrow(v)), out) " +
           "} else { " +
           't <- base::typeof(v); ' +
          'if (!is.null(base::attributes(v)) || !(t %in% c("double","integer","logical","character"))) ' +
          'stop("Only classless atomic R vectors can be transferred"); ' +
          'if (length(v) > 256L) stop("R vector exceeds limit"); ' +
          'if (t %in% c("double","integer") && ' +
          '(any(is.infinite(v)) || (t == "double" && any(is.nan(v))) || ' +
          'any(abs(v[!is.na(v)]) > 9007199254740991))) stop("R number is not finite or safe"); ' +
          'if (t == "character" && any(nchar(v[!is.na(v)], type="chars") > 512L)) stop("R string exceeds limit"); ' +
          's <- if (t == "double") format(v, digits=17L, scientific=TRUE, trim=TRUE, decimal.mark=".") else as.character(v); ' +
          'c(t, vapply(seq_along(v), function(i) if (is.na(v[[i]])) "@NA@" else ' +
          'utils::URLencode(s[[i]], reserved=TRUE), character(1))) } })';
        const rows = await r.evalRRaw(query, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(rows) || !rows.length ||
            !rows.every(row => typeof row === "string" && row.length <= 2048))
          throw Error("Invalid R transfer response.");
        const decode = (raw, type) => {
          if (raw === "@NA@") return null;
          const decoded = decodeURIComponent(raw);
          if (type === "boolean") {
            if (!["TRUE", "FALSE"].includes(decoded)) throw Error("Invalid R logical value.");
            return decoded === "TRUE";
          }
          if (type === "number") {
            if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(decoded))
              throw Error("Invalid R numeric value.");
            return Number(decoded);
          }
          return decoded;
        };
        let packet;
        if (rows[0] === "@TABLE@") {
          if (rows.length < 5 || !/^[1-9][0-9]?$/.test(rows[1]) ||
              !/^(?:0|[1-9][0-9]{0,2})$/.test(rows[2]))
            throw Error("Invalid R table dimensions.");
          const count = Number(rows[1]), size = Number(rows[2]);
          if (count > 16 || size > 128 || rows.length !== 3 + count * (2 + size))
            throw Error("Invalid R table response size.");
          let offset = 3;
          const columns = [];
          for (let i = 0; i < count; i++) {
            const columnName = decodeURIComponent(rows[offset++]);
            const rawType = rows[offset++];
            if (!["double", "integer", "logical", "character"].includes(rawType))
              throw Error("Unsupported R table column type.");
            const type = rawType === "logical" ? "boolean" :
              rawType === "character" ? "string" : "number";
            const values = rows.slice(offset, offset + size).map(raw => decode(raw, type));
            offset += size;
            columns.push({name:columnName, type, values});
          }
          packet = global.FlowStudioVariableTransfer.validate({kind:"table", columns});
        } else {
          if (rows.length > 257 ||
              !["double", "integer", "logical", "character"].includes(rows[0]))
            throw Error("Invalid R transfer response.");
          const type = rows[0] === "logical" ? "boolean" :
            rows[0] === "character" ? "string" : "number";
          const values = rows.slice(1).map(raw => decode(raw, type));
          packet = global.FlowStudioVariableTransfer.validate({kind:"vector", type, values});
        }
        return {ok:true, value:packet};
      } catch (error) { return {ok:false, output:String(error.message || error).slice(0, 300)}; }
    });
  }
  async function importVariable(name, packet) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name))
      return {ok:false, output:"Invalid shared Python/R variable name."};
    try { global.FlowStudioVariableTransfer.validate(packet); }
    catch (error) { return {ok:false, output:String(error.message || error).slice(0, 300)}; }
    const generation = epoch;
    return schedule(async () => {
      if (generation !== epoch) return {ok:false, output:"R session reset."};
      try {
        const r = await get();
        const atom = (value, type) => value === null
          ? {number:"NA_real_", boolean:"NA", string:"NA_character_"}[type]
          : type === "number" ? String(value) :
          type === "boolean" ? (value ? "TRUE" : "FALSE") :
          'utils::URLdecode(' + JSON.stringify(encodeURIComponent(value)) + ')';
        const empty = {number:"base::numeric(0L)", boolean:"base::logical(0L)", string:"base::character(0L)"};
        const vector = (values, type) => values.length ?
          "base::c(" + values.map(value => atom(value, type)).join(",") + ")" : empty[type];
        const expression = packet.kind === "table"
          ? "base::as.data.frame(base::structure(base::list(" +
            packet.columns.map(col => vector(col.values, col.type)).join(",") +
            "), names=base::c(" + packet.columns.map(col => JSON.stringify(col.name)).join(",") +
            ")), optional=TRUE, stringsAsFactors=FALSE)"
          : packet.kind === "scalar" ? atom(packet.values[0], packet.type) :
            vector(packet.values, packet.type);
        const query = 'local({ n <- ' + JSON.stringify(name) +
          '; if (base::exists(n, envir=.GlobalEnv, inherits=FALSE) && ' +
          '(base::bindingIsActive(n, .GlobalEnv) || base::bindingIsLocked(n, .GlobalEnv))) ' +
          'stop("Cannot replace active or locked R binding"); ' +
          'base::assign(n, ' + expression + ', envir=.GlobalEnv); c("ok") })';
        const rows = await r.evalRRaw(query, "string[]");
        if (generation !== epoch) return {ok:false, output:"R session reset."};
        if (!Array.isArray(rows) || rows.length !== 1 || rows[0] !== "ok")
          throw Error("R transfer assignment did not acknowledge success.");
        return {ok:true};
      } catch (error) { return {ok:false, output:String(error.message || error).slice(0, 300)}; }
    });
  }
  function reset() {
    epoch++;
    if (runtime) { try { runtime.close(); } catch (_) { /* already closed */ } }
    runtime = null;
    loading = null;
  }
  return Object.freeze({run, checkSyntax, help, complete, inspect, packages, installPackage, table, exportVariable, importVariable, reset});
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
const api = Object.freeze({create, renderImages, CDN, INSPECT, parseInspection});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioRSession = api;
})(globalThis);
