# FlowStudio native R kernel: length-framed, single-user persistent session.
# This is not a sandbox. Evaluated R code inherits the local user's permissions.
# stdin: E (execute), C (parse only) or I (inspect) + 8 lowercase hex digits + UTF-8 source.
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

evaluate_source <- function(source) {
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
    on.exit(unlink(output_file))
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

repeat {
    header <- read_exact(9L)
    if (is.null(header)) break
    header_text <- rawToChar(header)
    if (!grepl("^[ECI][0-9a-f]{8}$", header_text)) break
    length_text <- substr(header_text, 2L, 9L)
    length_value <- strtoi(length_text, base = 16L)
    if (is.na(length_value) || length_value > MAX_SOURCE ||
        (substr(header_text, 1L, 1L) == "I" && length_value != 0L)) break
    payload <- read_exact(length_value)
    if (is.null(payload)) break
    source <- if (length(payload) == 0L) "" else tryCatch(
        iconv(rawToChar(payload), from = "UTF-8", to = "UTF-8", sub = NA_character_),
        error = function(error) NA_character_
    )
    result <- if (substr(header_text, 1L, 1L) == "I") {
        inspect_workspace()
    } else if (is.na(source)) {
        list(success = FALSE, payload = charToRaw("Invalid UTF-8 source."))
    } else if (substr(header_text, 1L, 1L) == "C") {
        check_source(source)
    } else {
        evaluate_source(source)
    }
    length_header <- sprintf("%08x", length(result$payload))
    status <- if (result$success) "0" else "1"
    writeBin(c(charToRaw(paste0(status, length_header)), result$payload), protocol)
    flush(protocol)
}
