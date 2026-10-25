# FlowStudio native R kernel: length-framed, single-user persistent session.
# This is not a sandbox. Evaluated R code inherits the local user's permissions.
# stdin: E (execute), C (parse), I (inspect), T (table), P (plot), K (packages) + 8 lowercase hex digits + UTF-8 payload.
# fd 3: 0/1 + 8 lowercase hex digits + bounded UTF-8 output.
MAX_SOURCE <- 131072L
MAX_OUTPUT <- 131072L
input <- file("stdin", open = "rb")
protocol <- file("/dev/fd/3", open = "wb")
workspace <- new.env(parent = globalenv())

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

evaluate_source <- function(source) {
    last_plot_svg <<- NULL
    last_plot_pdf <<- NULL
    last_plot_warning <<- NULL
    finish_plot <- begin_plot_capture()
    on.exit(finish_plot(), add = TRUE)
    output_file <- tempfile("flowstudio-r-")
    output_connection <- file(output_file, open = "wt", encoding = "UTF-8")
    original_sinks <- sink.number()
    success <- TRUE
    sink(output_connection)
    tryCatch(
        withCallingHandlers({
            expressions <- parse(text = source, keep.source = FALSE)
            for (expression in expressions) {
                value <- withVisible(eval(expression, envir = workspace))
                if (value$visible) print(value$value)
            }
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
    if (!grepl("^[ECITPK][0-9a-f]{8}$", header_text)) break
    length_text <- substr(header_text, 2L, 9L)
    length_value <- strtoi(length_text, base = 16L)
    if (is.na(length_value) || length_value > MAX_SOURCE ||
        (substr(header_text, 1L, 1L) %in% c("I", "P", "K") && length_value != 0L)) break
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
