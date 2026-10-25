# FlowStudio native R kernel: length-framed, single-user persistent session.
# This is not a sandbox. Evaluated R code inherits the local user's permissions.
# stdin: E (execute), C (parse), I (inspect), T (table), P (plot), K (packages), L (load), N (install), V (update), U (remove), B (debug start), S (debug step), F (debug continue/target line), W (evaluate while paused), D (debug stop), Q (debug status) + 8 lowercase hex digits + UTF-8 payload.
# fd 3: 0/1 + 8 lowercase hex digits + bounded UTF-8 output.
MAX_SOURCE <- 131072L
MAX_OUTPUT <- 131072L
input <- file("stdin", open = "rb")
protocol <- file("/dev/fd/3", open = "wb")
workspace <- new.env(parent = globalenv())
# A cooperative top-level expression debugger. It never invokes browser(),
# which would consume the framed IPC stdin and corrupt the persistent kernel.
debug_expressions <- NULL
debug_lines <- integer(0)
debug_index <- 1L
debug_state <- "idle"
# Persistent user-owned library; never install into the system R libraries.
user_library <- file.path(tools::R_user_dir("FlowStudio", which = "data"), "library")
if (dir.exists(user_library)) .libPaths(c(user_library, .libPaths()))

read_exact <- function(count) {
    value <- raw(0)
    while (length(value) < count) {
        chunk <- readBin(input, what = "raw", n = count - length(value))
        if (length(chunk) == 0L) return(NULL)
        value <- c(value, chunk)
    }
    value
}


# R's built-in PDF device works without X11, Cairo, or third-party packages.
# Open it before evaluating source; close it before exposing a bounded snapshot.
last_plot_svg <- NULL
last_plot_pdf <- NULL
last_plot_warning <- NULL
begin_plot_capture <- function() {
    path <- tempfile("flowstudio-r-plot-", fileext = ".pdf")
    grDevices::pdf(file = path, width = 7, height = 5, onefile = TRUE)
    device <- as.integer(grDevices::dev.cur())
    plotted <- FALSE
    previous_hook <- getHook("plot.new")
    setHook("plot.new", function() { plotted <<- TRUE }, action = "append")
    function() {
        setHook("plot.new", previous_hook, action = "replace")
        devices <- grDevices::dev.list()
        if (!is.null(devices) && device %in% devices) {
            try(grDevices::dev.off(which = device), silent = TRUE)
        }
        on.exit(unlink(path), add = TRUE)
        if (!plotted) return(invisible(NULL))
        if (!file.exists(path)) {
            last_plot_warning <<- "Native R PDF file was not produced."
            return(invisible(NULL))
        }
        bytes <- file.info(path)$size
        if (!is.finite(bytes) || bytes <= 0) {
            last_plot_warning <<- "Native R PDF file was empty."
            return(invisible(NULL))
        }
        if (bytes > 60000L) {
            last_plot_warning <<- "Native R PDF exceeds the 60 KiB capture limit."
            return(invisible(NULL))
        }
        reader <- file(path, open = "rb")
        raw <- readBin(reader, what = "raw", n = as.integer(bytes))
        close(reader)
        if (length(raw) < 4L || !identical(raw[1:4], charToRaw("%PDF"))) {
            last_plot_warning <<- "Native R PDF capture was invalid."
            return(invisible(NULL))
        }
        last_plot_pdf <<- paste(sprintf("%02x", as.integer(raw)), collapse = "")
        invisible(NULL)
    }
}

evaluate_source <- function(source, expressions_override = NULL) {
    last_plot_svg <<- NULL
    last_plot_pdf <<- NULL
    last_plot_warning <<- NULL
    finish_plot <- begin_plot_capture()
    on.exit(finish_plot(), add = TRUE)
    output_file <- tempfile("flowstudio-r-")
    output_connection <- file(output_file, open = "wt", encoding = "UTF-8")
    original_sinks <- sink.number()
    success <- TRUE
    error_stack <- character(0)
    sink(output_connection)
    tryCatch(
        withCallingHandlers({
            expressions <- if (is.null(expressions_override))
                parse(text = source, keep.source = FALSE) else expressions_override
            for (expression in expressions) {
                value <- withVisible(eval(expression, envir = workspace))
                if (value$visible) print(value$value)
            }
        }, error = function(error) {
            # Capture frames before tryCatch unwinds the failing R call stack.
            # Deparse syntax only: never print/evaluate user objects or arguments.
            error_stack <<- tryCatch({
                internal <- c("eval", "withVisible", "tryCatch", "tryCatchList",
                              "tryCatchOne", "doTryCatch", "withCallingHandlers",
                              "evaluate_source", "parse", "stop", "h",
                              ".handleSimpleError", "signalCondition")
                frames <- vapply(sys.calls(), function(call) {
                    if (!is.call(call)) return("")
                    head <- call[[1L]]
                    name <- if (is.symbol(head)) as.character(head) else ""
                    if (name %in% internal) return("")
                    text <- paste(deparse(call, nlines = 1L,
                                          width.cutoff = 100L), collapse = " ")
                    substr(text, 1L, 180L)
                }, character(1L), USE.NAMES = FALSE)
                tail(frames[nzchar(frames)], 16L)
            }, error = function(unused) character(0))
        }, warning = function(warning) {
            cat("Warning: ", conditionMessage(warning), "\n", sep = "")
            invokeRestart("muffleWarning")
        }, message = function(message) {
            cat("Message: ", conditionMessage(message), "\n", sep = "")
            invokeRestart("muffleMessage")
        }),
        error = function(error) {
            success <<- FALSE
            cat("Error: ", conditionMessage(error), "\n", sep = "")
            if (length(error_stack)) {
                cat("R call stack (most recent last):\n")
                for (frame in error_stack) cat("  ", frame, "\n", sep = "")
            }
        },
        finally = {
            while (sink.number() > original_sinks) sink()
            close(output_connection)
        }
    )
    # Keep the plot finalizer registered above; default on.exit() replaces it.
    on.exit(unlink(output_file), add = TRUE)
    file_size <- file.info(output_file)$size
    reader <- file(output_file, open = "rb")
    bytes <- readBin(reader, what = "raw", n = MAX_OUTPUT - 64L)
    close(reader)
    output <- if (length(bytes) == 0L) "" else tryCatch(
        iconv(rawToChar(bytes), from = "UTF-8", to = "UTF-8", sub = ""),
        error = function(error) "[Output contains invalid binary data]"
    )
    if (is.na(output)) output <- "[Output contains invalid UTF-8]"
    if (file_size > length(bytes)) output <- paste0(output, "\n[Output truncated]")
    if (nchar(output, type = "bytes") == 0L) {
        output <- if (success) "(No output)" else "Execution failed."
    }
    list(success = success, payload = charToRaw(enc2utf8(output)))
}

# This debugger deliberately steps over one complete top-level R expression at
# a time. Calls within that expression are NOT interruptible or inspectable.
# Keep parsed language objects, not deparsed/reconstructed source, so evaluation
# retains the actual R AST and the persistent user workspace.
debug_reply <- function(success = TRUE, output = "", executed_line = NULL) {
    next_line <- if (identical(debug_state, "paused") &&
                     debug_index <= length(debug_lines)) debug_lines[[debug_index]] else NULL
    line_json <- function(value) if (is.null(value) || is.na(value)) "null" else as.character(value)
    json <- paste0('{"state":', json_quote(debug_state),
                   ',"next_line":', line_json(next_line),
                   ',"executed_line":', line_json(executed_line),
                   ',"index":', debug_index,
                   ',"total":', length(debug_lines),
                   ',"output":', json_quote(substr(output, 1L, 2048L)), "}")
    if (nchar(json, type = "bytes") > 20000L)
        json <- '{"state":"error","next_line":null,"executed_line":null,"index":0,"total":0,"output":"Debug output exceeds limit."}'
    list(success = success, payload = charToRaw(enc2utf8(json)))
}

debug_start <- function(source) {
    if (identical(debug_state, "paused"))
        return(debug_reply(FALSE, "Stop the paused R debug session before starting another."))
    # Parsing is nonexecuting. A syntax failure must leave no pending work.
    debug_expressions <<- NULL
    debug_lines <<- integer(0)
    debug_index <<- 1L
    debug_state <<- "idle"
    parsed <- tryCatch(parse(text = source, keep.source = TRUE),
                       error = function(error) error)
    if (inherits(parsed, "error"))
        return(debug_reply(FALSE, paste0("R syntax error: ", conditionMessage(parsed))))
    if (length(parsed) > 1024L)
        return(debug_reply(FALSE, "R debugger supports at most 1024 top-level expressions."))
    refs <- attr(parsed, "srcref", exact = TRUE)
    debug_lines <<- vapply(seq_along(parsed), function(index) {
        if (length(refs) < index || is.null(refs[[index]])) return(NA_integer_)
        as.integer(refs[[index]][[1L]])
    }, integer(1L), USE.NAMES = FALSE)
    debug_expressions <<- parsed
    debug_state <<- if (length(parsed)) "paused" else "done"
    debug_reply()
}

debug_step <- function() {
    if (!identical(debug_state, "paused"))
        return(debug_reply(FALSE, "No paused R expression is available."))
    line <- debug_lines[[debug_index]]
    # Execute exactly one parsed expression, preserving all existing R evaluation,
    # warning, stdout, error and plot-capture behavior.
    expression <- as.expression(list(debug_expressions[[debug_index]]))
    result <- evaluate_source("", expressions_override = expression)
    debug_index <<- debug_index + 1L
    debug_state <<- if (!result$success) "error" else if (
        debug_index > length(debug_expressions)) "done" else "paused"
    debug_reply(result$success, rawToChar(result$payload), line)
}

# Explicit debugger-console evaluation in the real paused workspace. Unlike
# syntax checks, this intentionally runs user R code and may mutate bindings,
# write files or call functions. The session is local-only and not sandboxed.
# Only one complete parsed expression is accepted per request; errors leave
# the pending debug expression and source position unchanged.
debug_evaluate <- function(source) {
    if (!identical(debug_state, "paused"))
        return(debug_reply(FALSE, "No paused R expression is available."))
    if (!nzchar(trimws(source)) || nchar(source, type = "bytes") > 4096L)
        return(debug_reply(FALSE, "R debugger evaluation requires 1 to 4096 bytes of source."))
    parsed <- tryCatch(parse(text = source, keep.source = FALSE),
                       error = function(error) error)
    if (inherits(parsed, "error"))
        return(debug_reply(FALSE, paste0("R syntax error: ", conditionMessage(parsed))))
    if (length(parsed) != 1L)
        return(debug_reply(FALSE, "R debugger evaluation requires exactly one expression."))
    result <- evaluate_source("", expressions_override = parsed)
    debug_reply(result$success, rawToChar(result$payload))
}

# Continue real top-level R expressions, optionally stopping before a later
# expression whose source reference starts on one of up to 64 specified lines.
# Breakpoint lines are parsed as data, never evaluated as R expressions.
debug_continue <- function(target_line) {
    if (!identical(debug_state, "paused"))
        return(debug_reply(FALSE, "No paused R expression is available."))
    stop_index <- length(debug_expressions) + 1L
    if (nzchar(target_line)) {
        if (nchar(target_line, type = "bytes") > 447L ||
            !grepl("^[1-9][0-9]{0,5}(,[1-9][0-9]{0,5}){0,63}$", target_line))
            return(debug_reply(FALSE, "Target must contain 1 to 64 positive source lines (comma-separated)."))
        lines <- as.integer(strsplit(target_line, ",", fixed = TRUE)[[1L]])
        future <- which(seq_along(debug_lines) > debug_index &
                        !is.na(debug_lines) & debug_lines %in% lines)
        if (!length(future))
            return(debug_reply(FALSE, "No later top-level expression starts on any requested line."))
        stop_index <- future[[1L]]
    }
    output <- character(0)
    last_line <- NULL
    truncated <- FALSE
    while (identical(debug_state, "paused") && debug_index < stop_index) {
        last_line <- debug_lines[[debug_index]]
        expression <- as.expression(list(debug_expressions[[debug_index]]))
        result <- evaluate_source("", expressions_override = expression)
        debug_index <<- debug_index + 1L
        debug_state <<- if (!result$success) "error" else if (
            debug_index > length(debug_expressions)) "done" else "paused"
        chunk <- rawToChar(result$payload)
        if (!identical(chunk, "(No output)")) {
            if (length(output) < 16L || !result$success) {
                output <- c(output, chunk)
            } else {
                truncated <- TRUE
            }
        }
        if (!result$success) break
    }
    if (truncated) output <- c(output, "[Earlier output truncated]")
    debug_reply(!identical(debug_state, "error"),
                paste(output, collapse = "\n"), last_line)
}

debug_stop <- function() {
    debug_expressions <<- NULL
    debug_lines <<- integer(0)
    debug_index <<- 1L
    debug_state <<- "idle"
    debug_reply()
}

# Check actual R grammar in the persistent interpreter without evaluating
# expressions or touching the workspace. Keep parser source positions for the IDE.
check_source <- function(source) {
    diagnostic <- tryCatch({
        parse(text = source, keep.source = TRUE)
        NULL
    }, error = function(error) conditionMessage(error))
    if (is.null(diagnostic)) {
        return(list(success = TRUE,
                    payload = charToRaw("R syntax valid; source was not executed.")))
    }
    # Parser errors may contain user source; bound the IPC response.
    bytes <- charToRaw(enc2utf8(paste0("R syntax error: ", diagnostic)))
    if (length(bytes) > MAX_OUTPUT - 64L) {
        bytes <- bytes[seq_len(MAX_OUTPUT - 64L)]
    }
    list(success = FALSE, payload = bytes)
}

# JSON encoding is deliberately dependency-free: jsonlite is not required.
# Never serialize R values, call print(), or dispatch user-defined methods.
json_quote <- function(value) {
    points <- utf8ToInt(enc2utf8(value))
    escaped <- vapply(points, function(point) {
        if (point == 34L) return('\\"')
        if (point == 92L) return('\\\\')
        if (point < 32L) return(sprintf("\\u%04x", point))
        intToUtf8(point)
    }, character(1), USE.NAMES = FALSE)
    paste0('"', paste0(escaped, collapse = ""), '"')
}

# Plot retrieval is read-only and never evaluates source. JSON stays bounded.
plot_snapshot <- function() {
    svg <- if (is.null(last_plot_svg)) "null" else json_quote(last_plot_svg)
    pdf <- if (is.null(last_plot_pdf)) "null" else json_quote(last_plot_pdf)
    warning <- if (is.null(last_plot_warning)) "null" else json_quote(last_plot_warning)
    json <- paste0('{"svg":', svg, ',"pdf":', pdf, ',"warning":', warning, "}")
    if (nchar(json, type = "bytes") > 131000L) {
        json <- '{"svg":null,"pdf":null,"warning":"Native R plot JSON exceeds the IPC limit."}'
    }
    list(success = TRUE, payload = charToRaw(enc2utf8(json)))
}

# Read the real installed R package database without evaluating workspace code.
# Return at most 1000 packages and 65 KiB of dependency-free JSON.
package_snapshot <- function() {
    matrix <- utils::installed.packages()[, c("Package", "Version"), drop = FALSE]
    if (nrow(matrix) > 1L) matrix <- matrix[order(matrix[, 1L]), , drop = FALSE]
    entries <- character(0)
    used <- 64L
    truncated <- FALSE
    for (index in seq_len(nrow(matrix))) {
        if (length(entries) >= 1000L) { truncated <- TRUE; break }
        name <- matrix[index, 1L]
        version <- matrix[index, 2L]
        if (is.na(name) || is.na(version) ||
            nchar(name, type = "bytes") > 100L ||
            nchar(version, type = "bytes") > 100L ||
            !grepl("^[A-Za-z][A-Za-z0-9.]*$", name)) {
            truncated <- TRUE
            next
        }
        entry <- paste0('{"name":', json_quote(name),
                        ',"version":', json_quote(version), "}")
        length_bytes <- nchar(entry, type = "bytes") + 1L
        if (used + length_bytes > 65000L) { truncated <- TRUE; break }
        entries <- c(entries, entry)
        used <- used + length_bytes
    }
    json <- paste0('{"packages":[', paste(entries, collapse = ","),
                   '],"truncated":', if (truncated) "true" else "false", "}")
    list(success = TRUE, payload = charToRaw(enc2utf8(json)))
}

# Attach an already-installed package to the persistent R session. Unlike
# installation this requires no network, and only an explicit package name is
# accepted. Package startup code executes with the user's local permissions.
load_installed_package <- function(name) {
    if (!grepl("^[A-Za-z][A-Za-z0-9.]{0,79}$", name) ||
        grepl("..", name, fixed = TRUE) || endsWith(name, ".")) {
        return(list(success = FALSE, payload = charToRaw("Invalid R package name.")))
    }
    tryCatch({
        suppressPackageStartupMessages(
            base::library(package = name, character.only = TRUE,
                          quietly = TRUE, warn.conflicts = FALSE))
        list(success = TRUE,
             payload = charToRaw(enc2utf8(paste0("Loaded installed R package ", name, "."))))
    }, error = function(error) {
        # Report the actual missing-package/load failure without losing the kernel.
        message <- substr(conditionMessage(error), 1L, 1024L)
        list(success = FALSE, payload = charToRaw(enc2utf8(message)))
    })
}

# Explicit installation is a privileged local action: CRAN packages can run
# native code as the user. Only a package name is accepted, never source code,
# a URL, path, repository or arbitrary installation arguments.
install_cran_package <- function(name) {
    if (!grepl("^[A-Za-z][A-Za-z0-9.]{0,79}$", name) ||
        grepl("..", name, fixed = TRUE) || endsWith(name, ".")) {
        return(list(success = FALSE, payload = charToRaw("Invalid R package name.")))
    }
    tryCatch({
        available <- utils::installed.packages()[, "Package"]
        if (name %in% available) {
            return(list(success = TRUE, payload = charToRaw(enc2utf8(
                paste0("R package ", name, " is already installed; no download performed.")))))
        }
        if (!dir.exists(user_library) &&
            !dir.create(user_library, recursive = TRUE, showWarnings = FALSE)) {
            stop("Could not create the FlowStudio user R library.")
        }
        if (!dir.exists(user_library) || file.access(user_library, 2L) != 0L)
            stop("FlowStudio user R library is not writable.")
        .libPaths(c(user_library, .libPaths()))
        previous_timeout <- getOption("timeout")
        on.exit(options(timeout = previous_timeout), add = TRUE)
        options(timeout = 120L)
        # The test harness supplies an offline file:// CRAN repository through
        # its own process environment; HTTP callers cannot select repositories.
        test_mode <- identical(Sys.getenv("FLOWSTUDIO_R_TEST_MODE"), "1")
        mirror <- "https://cloud.r-project.org"
        if (test_mode) {
            local_mirror <- Sys.getenv("FLOWSTUDIO_R_TEST_REPO")
            if (startsWith(local_mirror, "file://")) mirror <- local_mirror
        }
        suppressWarnings(utils::install.packages(
            pkgs = name, lib = user_library,
            repos = c(CRAN = mirror),
            type = if (test_mode) "source" else getOption("pkgType"),
            dependencies = NA, quiet = TRUE, Ncpus = 1L))
        installed <- utils::installed.packages(lib.loc = user_library)
        if (!(name %in% installed[, "Package"]))
            stop("CRAN did not install the requested package. Check connectivity, build tools and system dependencies.")
        list(success = TRUE, payload = charToRaw(enc2utf8(
            paste0("Installed R package ", name, " in the FlowStudio user library."))))
    }, error = function(error) {
        list(success = FALSE, payload = charToRaw(enc2utf8(
            substr(conditionMessage(error), 1L, 1024L))))
    })
}


# Update an existing user-library package only when CRAN advertises a newer
# version. Never overwrite system libraries or packages loaded in this kernel.
# Package installation runs third-party code as the local user; no rollback is
# promised if an external package installer fails partway through.
update_cran_package <- function(name) {
    if (!grepl("^[A-Za-z][A-Za-z0-9.]{0,79}$", name) ||
        grepl("..", name, fixed = TRUE) || endsWith(name, ".")) {
        return(list(success = FALSE, payload = charToRaw("Invalid R package name.")))
    }
    tryCatch({
        if (!dir.exists(user_library))
            stop("R package is not installed in the FlowStudio user library; system packages cannot be updated.")
        installed <- utils::installed.packages(lib.loc = user_library)
        index <- match(name, installed[, "Package"])
        if (is.na(index))
            stop("R package is not installed in the FlowStudio user library; system packages cannot be updated.")
        if (paste0("package:", name) %in% search() || name %in% loadedNamespaces())
            stop("R package is loaded in the native session; reset the R session before updating it.")
        if (file.access(user_library, 2L) != 0L)
            stop("FlowStudio user R library is not writable.")
        old_version <- installed[index, "Version"]
        test_mode <- identical(Sys.getenv("FLOWSTUDIO_R_TEST_MODE"), "1")
        mirror <- "https://cloud.r-project.org"
        if (test_mode) {
            local_mirror <- Sys.getenv("FLOWSTUDIO_R_TEST_REPO")
            if (startsWith(local_mirror, "file://")) mirror <- local_mirror
        }
        package_type <- if (test_mode) "source" else getOption("pkgType")
        previous_timeout <- getOption("timeout")
        on.exit(options(timeout = previous_timeout), add = TRUE)
        options(timeout = 120L)
        repository <- utils::available.packages(
            repos = c(CRAN = mirror), type = package_type, cacheOK = FALSE)
        remote_index <- match(name, repository[, "Package"])
        if (is.na(remote_index))
            stop("R package is unavailable from the configured CRAN repository.")
        remote_version <- repository[remote_index, "Version"]
        if (utils::compareVersion(remote_version, old_version) <= 0L)
            return(list(success = TRUE, payload = charToRaw(enc2utf8(
                paste0("R package ", name, " is up to date at ", old_version, ".")))))
        suppressWarnings(utils::install.packages(
            pkgs = name, lib = user_library, repos = c(CRAN = mirror),
            type = package_type, dependencies = NA, quiet = TRUE, Ncpus = 1L))
        after <- utils::installed.packages(lib.loc = user_library)
        after_index <- match(name, after[, "Package"])
        if (is.na(after_index) ||
            utils::compareVersion(after[after_index, "Version"], remote_version) < 0L)
            stop("R package update did not complete. Check connectivity, build tools and the user library.")
        list(success = TRUE, payload = charToRaw(enc2utf8(paste0(
            "Updated R package ", name, " from ", old_version, " to ",
            after[after_index, "Version"], " in the FlowStudio user library."))))
    }, error = function(error) {
        list(success = FALSE, payload = charToRaw(enc2utf8(
            substr(conditionMessage(error), 1L, 1024L))))
    })
}

# Remove only packages installed into FlowStudio's own user library.
# Never remove base/site libraries, and refuse loaded namespaces to avoid
# deleting package files that the persistent R process is still using.
remove_user_package <- function(name) {
    if (!grepl("^[A-Za-z][A-Za-z0-9.]{0,79}$", name) ||
        grepl("..", name, fixed = TRUE) || endsWith(name, ".")) {
        return(list(success = FALSE, payload = charToRaw("Invalid R package name.")))
    }
    tryCatch({
        if (!dir.exists(user_library)) {
            stop("R package is not installed in the FlowStudio user library; system packages cannot be removed.")
        }
        installed <- utils::installed.packages(lib.loc = user_library)
        if (!(name %in% installed[, "Package"])) {
            stop("R package is not installed in the FlowStudio user library; system packages cannot be removed.")
        }
        if (paste0("package:", name) %in% search() || name %in% loadedNamespaces()) {
            stop("R package is loaded in the native session; reset the R session before removing it.")
        }
        if (file.access(user_library, 2L) != 0L) {
            stop("FlowStudio user R library is not writable.")
        }
        utils::remove.packages(pkgs = name, lib = user_library)
        remaining <- utils::installed.packages(lib.loc = user_library)
        if (name %in% remaining[, "Package"]) {
            stop("R package removal did not complete.")
        }
        list(success = TRUE, payload = charToRaw(enc2utf8(
            paste0("Removed R package ", name, " from the FlowStudio user library."))))
    }, error = function(error) {
        list(success = FALSE, payload = charToRaw(enc2utf8(
            substr(conditionMessage(error), 1L, 1024L))))
    })
}

# Inspect only ordinary R lists, not S3/S4 objects or arbitrary methods.
# Two child levels, twelve entries per container and 256 total child nodes.
# The same bounded metadata schema is consumed by the native Python tree UI.
inspect_value <- function(name, value, depth, budget) {
    kind <- typeof(value)
    plain <- !is.object(value)
    size <- "null"
    if (plain && kind %in% c("logical", "integer", "double", "complex",
                             "character", "raw", "list")) {
        size <- as.character(base::length(value))
    }
    dimensions <- "null"
    shape <- attr(value, "dim", exact = TRUE)
    if (is.integer(shape) && length(shape) > 0L &&
        length(shape) <= 8L && all(!is.na(shape)) && all(shape >= 0L)) {
        dimensions <- paste0("[", paste(shape, collapse = ","), "]")
    }
    fields <- paste0('"name":', json_quote(substr(name, 1L, 160L)),
                     ',"type":', json_quote(substr(kind, 1L, 100L)),
                     ',"size":', size, ',"dimensions":', dimensions)
    if (depth < 2L && plain && identical(kind, "list")) {
        count <- base::length(value)
        take <- min(count, 12L)
        labels <- attr(value, "names", exact = TRUE)
        children <- character(0)
        partial <- count > take
        if (take > 0L) for (index in seq_len(take)) {
            if (budget$nodes >= 256L) {
                partial <- TRUE
                break
            }
            budget$nodes <- budget$nodes + 1L
            label <- paste0("[[", index, "]]")
            if (!is.null(labels) && length(labels) >= index &&
                !is.na(labels[index]) && nzchar(labels[index])) {
                label <- paste0(label, " ", substr(labels[index], 1L, 120L))
            }
            children <- c(children, inspect_value(label, value[[index]],
                                                  depth + 1L, budget))
        }
        fields <- paste0(fields, ',"children":[', paste(children, collapse = ","), ']')
        if (partial) {
            fields <- paste0(fields, ',"truncated":true')
            budget$truncated <- TRUE
        }
    }
    paste0("{", fields, "}")
}

inspect_workspace <- function() {
    names <- ls(envir = workspace, all.names = TRUE)
    entries <- character(0)
    used <- 35L
    truncated <- FALSE
    budget <- new.env(parent = emptyenv())
    budget$nodes <- 0L
    budget$truncated <- FALSE
    for (name in names) {
        if (length(entries) >= 128L) {
            truncated <- TRUE
            break
        }
        if (bindingIsActive(name, workspace)) {
            # Reading an active binding could execute arbitrary user code.
            entry <- paste0('{"name":', json_quote(substr(name, 1L, 160L)),
                            ',"type":"active binding","size":null,"dimensions":null}')
        } else {
            # Existing limitation: forcing a lazy promise may have side effects.
            # A failed promise must not break inspection or the IPC process.
            binding <- tryCatch(
                list(ok = TRUE, value = get(name, envir = workspace, inherits = FALSE)),
                error = function(error) list(ok = FALSE)
            )
            entry <- if (binding$ok) {
                inspect_value(name, binding$value, 0L, budget)
            } else {
                paste0('{"name":', json_quote(substr(name, 1L, 160L)),
                       ',"type":"unavailable","size":null,"dimensions":null}')
            }
        }
        additional <- nchar(entry, type = "bytes") + if (length(entries)) 1L else 0L
        if (used + additional > 65000L) {
            truncated <- TRUE
            break
        }
        entries <- c(entries, entry)
        used <- used + additional
    }
    json <- paste0('{"variables":[', paste(entries, collapse = ","),
                   '],"truncated":', if (truncated || budget$truncated) "true" else "false", "}")
    list(success = TRUE, payload = charToRaw(enc2utf8(json)))
}


# Bounded read-only previews from the persistent R workspace. Restrict access
# to exact base data.frames and classless atomic matrices; never eval a name.
table_snapshot <- function(name) {
    if (!grepl("^[A-Za-z][A-Za-z0-9._]{0,119}$", name) ||
        grepl("\\.\\.", name) || grepl("\\.$", name)) {
        return(list(success = FALSE, payload = charToRaw("Invalid R table name.")))
    }
    if (!exists(name, envir = workspace, inherits = FALSE) ||
        bindingIsActive(name, workspace)) {
        return(list(success = FALSE, payload = charToRaw("R table not found or active binding.")))
    }
    value <- tryCatch(get(name, envir = workspace, inherits = FALSE),
                      error = function(error) NULL)
    if (is.null(value)) {
        return(list(success = FALSE, payload = charToRaw("R table unavailable.")))
    }
    shape <- attr(value, "dim", exact = TRUE)
    frame <- identical(typeof(value), "list") &&
             identical(attr(value, "class", exact = TRUE), "data.frame")
    matrix <- !is.object(value) &&
              typeof(value) %in% c("logical", "integer", "double", "character") &&
              is.integer(shape) && length(shape) == 2L &&
              all(!is.na(shape)) && all(shape >= 0L)
    if (!frame && !matrix) {
        return(list(success = FALSE, payload = charToRaw("Select a plain data.frame or atomic matrix.")))
    }
    if (frame) {
        total_columns <- length(unclass(value))
        if (total_columns < 1L) {
            return(list(success = FALSE, payload = charToRaw("R table has no columns.")))
        }
        columns_data <- unclass(value)
        first_column <- columns_data[[1L]]
        total_rows <- length(if (is.object(first_column)) unclass(first_column) else first_column)
        labels <- attr(value, "names", exact = TRUE)
    } else {
        total_rows <- shape[[1L]]
        total_columns <- shape[[2L]]
        if (total_columns < 1L) {
            return(list(success = FALSE, payload = charToRaw("R matrix has no columns.")))
        }
        dim_names <- attr(value, "dimnames", exact = TRUE)
        labels <- if (is.list(dim_names) && !is.object(dim_names) &&
                      length(dim_names) == 2L && is.character(dim_names[[2L]]) &&
                      !is.object(dim_names[[2L]])) dim_names[[2L]] else NULL
    }
    take_columns <- min(total_columns, 32L)
    take_rows <- min(total_rows, 200L)
    label <- function(index) {
        if (is.character(labels) && !is.object(labels) && length(labels) >= index &&
            !is.na(labels[[index]]) && nzchar(labels[[index]])) {
            return(substr(labels[[index]], 1L, 160L))
        }
        paste0("Column ", index)
    }
    cell_text <- function(row, column) {
        if (frame) {
            values <- columns_data[[column]]
            if (is.object(values)) {
                levels <- attr(values, "levels", exact = TRUE)
                if (!identical(attr(values, "class", exact = TRUE), "factor") ||
                    typeof(values) != "integer" || !is.character(levels) ||
                    is.object(levels)) {
                    return("[unsupported column]")
                }
                plain <- unclass(values)
                if (length(plain) < row) return("[invalid column]")
                code <- plain[[row]]
                if (is.na(code)) return("")
                if (code < 1L || code > length(levels)) return("[invalid factor]")
                return(substr(levels[[code]], 1L, 160L))
            }
            if (length(values) < row) return("[invalid column]")
            if (!typeof(values) %in% c("logical", "integer", "double", "character")) {
                return("[unsupported column]")
            }
            cell <- values[[row]]
        } else {
            cell <- value[row, column]
        }
        if (is.na(cell)) return("")
        substr(as.character(cell), 1L, 160L)
    }
    column_json <- vapply(seq_len(take_columns), function(i) json_quote(label(i)),
                          character(1), USE.NAMES = FALSE)
    rows <- character(0)
    used <- sum(nchar(column_json, type = "bytes")) + 128L
    truncated <- total_rows > take_rows || total_columns > take_columns
    if (take_rows > 0L) for (row in seq_len(take_rows)) {
        fields <- vapply(seq_len(take_columns),
                         function(column) json_quote(cell_text(row, column)),
                         character(1), USE.NAMES = FALSE)
        entry <- paste0("[", paste(fields, collapse = ","), "]")
        if (used + nchar(entry, type = "bytes") + 1L > 65000L) {
            truncated <- TRUE
            break
        }
        rows <- c(rows, entry)
        used <- used + nchar(entry, type = "bytes") + 1L
    }
    json <- paste0('{"columns":[', paste(column_json, collapse = ","),
                   '],"rows":[', paste(rows, collapse = ","),
                   '],"totalRows":', total_rows,
                   ',"truncated":', if (truncated) "true" else "false", "}")
    list(success = TRUE, payload = charToRaw(enc2utf8(json)))
}

repeat {
    header <- read_exact(9L)
    if (is.null(header)) break
    header_text <- rawToChar(header)
    if (!grepl("^[ECITPKLNUVBSFDQW][0-9a-f]{8}$", header_text)) break
    length_text <- substr(header_text, 2L, 9L)
    length_value <- strtoi(length_text, base = 16L)
    if (is.na(length_value) || length_value > MAX_SOURCE ||
        (substr(header_text, 1L, 1L) %in% c("I", "P", "K", "S", "D", "Q") && length_value != 0L)) break
    payload <- read_exact(length_value)
    if (is.null(payload)) break
    source <- if (length(payload) == 0L) "" else tryCatch(
        iconv(rawToChar(payload), from = "UTF-8", to = "UTF-8", sub = NA_character_),
        error = function(error) NA_character_
    )
    result <- if (substr(header_text, 1L, 1L) == "I") {
        inspect_workspace()
    } else if (substr(header_text, 1L, 1L) == "P") {
        plot_snapshot()
    } else if (substr(header_text, 1L, 1L) == "K") {
        tryCatch(package_snapshot(), error = function(error)
            list(success = FALSE, payload = charToRaw("R package inventory unavailable.")))
    } else if (is.na(source)) {
        list(success = FALSE, payload = charToRaw("Invalid UTF-8 source."))
    } else if (identical(debug_state, "paused") &&
               substr(header_text, 1L, 1L) %in% c("E", "L", "N", "V", "U")) {
        list(success = FALSE, payload = charToRaw(
            "R debugger is paused; finish or stop before executing other code."))
    } else if (substr(header_text, 1L, 1L) == "L") {
        load_installed_package(source)
    } else if (substr(header_text, 1L, 1L) == "N") {
        install_cran_package(source)
    } else if (substr(header_text, 1L, 1L) == "V") {
        update_cran_package(source)
    } else if (substr(header_text, 1L, 1L) == "U") {
        remove_user_package(source)
    } else if (substr(header_text, 1L, 1L) == "B") {
        debug_start(source)
    } else if (substr(header_text, 1L, 1L) == "S") {
        debug_step()
    } else if (substr(header_text, 1L, 1L) == "F") {
        debug_continue(source)
    } else if (substr(header_text, 1L, 1L) == "W") {
        debug_evaluate(source)
    } else if (substr(header_text, 1L, 1L) == "D") {
        debug_stop()
    } else if (substr(header_text, 1L, 1L) == "Q") {
        debug_reply()
    } else if (substr(header_text, 1L, 1L) == "C") {
        check_source(source)
    } else if (substr(header_text, 1L, 1L) == "T") {
        tryCatch(table_snapshot(source), error = function(error)
            list(success = FALSE, payload = charToRaw("R table snapshot failed.")))
    } else {
        evaluate_source(source)
    }
    length_header <- sprintf("%08x", length(result$payload))
    status <- if (result$success) "0" else "1"
    writeBin(c(charToRaw(paste0(status, length_header)), result$payload), protocol)
    flush(protocol)
}
