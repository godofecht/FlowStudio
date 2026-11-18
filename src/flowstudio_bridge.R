# flowstudio bridge for the persistent R session.
#
#   py("sum(range(10))")          # evaluate Python, get the value back in R
#   py$rows                       # read a Python variable
#   py$scores <- c(72, 88, 95)    # assign one
#   flow("kernel.flow")           # compile and run Flow, returns its output
#
# Python runs in FlowStudio's persistent Python session. Values come back as
# R source and go to Python as JSON. A Python Frame, pandas DataFrame or list
# of dicts arrives as a data.frame. The functions live outside the user
# workspace, so they do not show in the Environment.
#
# Transport: "Q" + 8 hex digits + target + format + source on fd 3; the reply
# arrives on stdin as "0"/"1" + 8 hex digits + text.

.bridge_call <- function(target, format, source) {
    body <- charToRaw(enc2utf8(paste0(target, format, source)))
    writeBin(c(charToRaw(sprintf("Q%08x", length(body))), body), protocol)
    flush(protocol)
    header <- read_exact(9L)
    if (is.null(header)) stop("FlowStudio bridge closed", call. = FALSE)
    header_text <- rawToChar(header)
    size <- strtoi(substr(header_text, 2L, 9L), base = 16L)
    text <- if (size > 0L) rawToChar(read_exact(size)) else ""
    Encoding(text) <- "UTF-8"
    list(ok = substr(header_text, 1L, 1L) == "0", text = text)
}

py <- structure(function(source) {
    reply <- .bridge_call("p", "r", source)
    if (!reply$ok) stop(paste0("Python error:\n", reply$text), call. = FALSE)
    result <- eval(parse(text = reply$text, keep.source = FALSE), envir = baseenv())
    if (nzchar(result$output)) cat(result$output)
    if (is.null(result$value)) invisible(NULL) else result$value
}, class = c("flowstudio_python", "function"))

`$.flowstudio_python` <- function(x, name) x(name)

`$<-.flowstudio_python` <- function(x, name, value) {
    json <- .to_json(value)
    source <- paste0(name, ' = __import__("flowstudio")._from_json(__import__("json").loads(',
                     json_quote(json), '))')
    reply <- .bridge_call("p", "r", source)
    if (!reply$ok) stop(paste0("Python error:\n", reply$text), call. = FALSE)
    x
}

print.flowstudio_python <- function(x, ...) {
    cat("<FlowStudio Python session>\n")
    invisible(x)
}

# ---- R values as JSON for Python -----------------------------------------

.json_atoms <- function(x) {
    if (is.factor(x)) x <- as.character(x)
    if (inherits(x, c("Date", "POSIXt"))) x <- as.character(x)
    if (is.logical(x)) return(ifelse(is.na(x), "null", ifelse(x, "true", "false")))
    if (is.integer(x)) return(ifelse(is.na(x), "null", as.character(x)))
    if (is.double(x)) {
        out <- sprintf("%.17g", x)
        out[is.nan(x)] <- "NaN"
        out[is.na(x) & !is.nan(x)] <- "null"
        out[!is.na(x) & is.infinite(x) & x > 0] <- "Infinity"
        out[!is.na(x) & is.infinite(x) & x < 0] <- "-Infinity"
        return(out)
    }
    if (is.complex(x)) x <- as.character(x)
    if (is.character(x)) {
        out <- vapply(x, function(item) if (is.na(item)) "null" else json_quote(item),
                      character(1), USE.NAMES = FALSE)
        return(out)
    }
    NULL
}

.to_json <- function(value) {
    if (is.null(value)) return("null")
    if (is.data.frame(value)) {
        columns <- vapply(value, function(column) {
            atoms <- .json_atoms(column)
            if (is.null(atoms)) atoms <- json_quote(paste(class(column), collapse = "/"))
            paste0("[", paste(atoms, collapse = ","), "]")
        }, character(1), USE.NAMES = FALSE)
        names_json <- paste(vapply(names(value), json_quote, character(1)), collapse = ",")
        return(paste0('{"__frame__":true,"names":[', names_json, '],"columns":[',
                      paste(columns, collapse = ","), "]}"))
    }
    if (is.matrix(value) && is.atomic(value)) {
        rows <- vapply(seq_len(nrow(value)), function(i)
            paste0("[", paste(.json_atoms(value[i, ]), collapse = ","), "]"), character(1))
        return(paste0('{"__matrix__":[', paste(rows, collapse = ","), "]}"))
    }
    if (is.atomic(value)) {
        atoms <- .json_atoms(value)
        if (is.null(atoms)) return(json_quote(paste(class(value), collapse = "/")))
        keys <- names(value)
        if (!is.null(keys) && all(nzchar(keys)))
            return(paste0("{", paste0(vapply(keys, json_quote, character(1)), ":", atoms,
                                      collapse = ","), "}"))
        if (length(value) == 1L) return(atoms)
        return(paste0("[", paste(atoms, collapse = ","), "]"))
    }
    if (is.list(value) && !is.object(value)) {
        items <- vapply(value, .to_json, character(1), USE.NAMES = FALSE)
        keys <- names(value)
        if (!is.null(keys) && all(nzchar(keys)))
            return(paste0("{", paste0(vapply(keys, json_quote, character(1)), ":", items,
                                      collapse = ","), "}"))
        return(paste0("[", paste(items, collapse = ","), "]"))
    }
    shown <- paste(utils::capture.output(print(value)), collapse = "\n")
    paste0('{"__repr__":', json_quote(substr(shown, 1L, 8000L)), "}")
}

# ---- R values as text for Flow -------------------------------------------

.to_text <- function(value) {
    if (is.null(value)) return("")
    if (is.data.frame(value)) {
        connection <- textConnection("csv_lines", "w", local = TRUE)
        on.exit(close(connection))
        utils::write.csv(value, connection, row.names = FALSE, na = "NA")
        return(paste(textConnectionValue(connection), collapse = "\n"))
    }
    if (is.factor(value)) value <- as.character(value)
    if (is.logical(value) && is.null(dim(value)))
        return(paste(ifelse(is.na(value), "NA", ifelse(value, "true", "false")), collapse = "\n"))
    if (is.double(value) && is.null(dim(value)))
        return(paste(ifelse(is.na(value), "NA", sprintf("%.15g", value)), collapse = "\n"))
    if (is.atomic(value) && is.null(dim(value)))
        return(paste(as.character(value), collapse = "\n"))
    if (is.list(value) && !is.object(value))
        return(paste(vapply(value, .to_text, character(1)), collapse = "\n"))
    paste(utils::capture.output(print(value)), collapse = "\n")
}

# ---- Requests from other languages ---------------------------------------

# ---- Typed blocks from Flow ----------------------------------------------
#
# A Flow program sends an r(...) { ... } block as format "b" (the request
# layout is in src/flowstudio.flow). The values it passes are assigned in the
# workspace under their Flow names while the block runs, the code is parsed
# with its Flow line numbers, and the last value comes back as the Flow type
# the block asked for, or as an error that names the Flow line.

.block_scalar <- function(tag, text) {
    if (identical(tag, "f")) {
        value <- suppressWarnings(as.numeric(text))
        if (is.na(value)) {
            low <- tolower(text)
            value <- if (low %in% c("inf", "+inf", "infinity")) Inf else if (low %in% c("-inf", "-infinity")) -Inf else NaN
        }
        return(value)
    }
    if (identical(tag, "i")) {
        value <- as.numeric(text)
        return(if (abs(value) <= .Machine$integer.max) as.integer(value) else value)
    }
    if (identical(tag, "b")) return(identical(text, "1"))
    if (identical(tag, "s")) {
        value <- utils::URLdecode(text)
        Encoding(value) <- "UTF-8"
        return(value)
    }
    stop("unknown value kind ", tag)
}

.block_vector <- function(tag, items) {
    if (identical(tag, "S")) return(as.character(unlist(items)))
    if (!length(items)) return(switch(tag, F = numeric(0), I = integer(0), B = logical(0)))
    if (identical(tag, "I") && any(vapply(items, is.double, logical(1)))) return(as.numeric(unlist(items)))
    unlist(items)
}

.block_describe <- function(value) {
    if (is.null(value)) return("NULL")
    if (is.data.frame(value)) return(sprintf("a data frame with %d rows", nrow(value)))
    shown <- if (is.atomic(value) && length(value) >= 1L) {
        text <- paste(utils::head(format(value), 3L), collapse = ", ")
        if (nchar(text) > 50L) text <- paste0(substr(text, 1L, 47L), "...")
        paste0(" (", text, if (length(value) > 3L) ", ..." else "", ")")
    } else ""
    sprintf("%s of length %d%s", paste(class(value), collapse = "/"), length(value), shown)
}

.block_items <- function(element, value) {
    if (is.factor(value)) value <- as.character(value)
    ok <- switch(element,
        f64 = , f32 = is.numeric(value),
        i64 = , i32 = is.numeric(value) && all(!is.na(value) & value == round(value)) &&
            all(abs(value) <= if (identical(element, "i32")) 2147483647 else 9.2e18),
        bool = is.logical(value) && !anyNA(value),
        string = is.character(value) && !anyNA(value),
        FALSE)
    if (!isTRUE(ok)) return(NULL)
    switch(element,
        f64 = , f32 = {
            out <- sprintf("%.17g", as.numeric(value))
            out[is.nan(value)] <- "nan"
            out[is.na(value) & !is.nan(value)] <- "nan"
            out[!is.na(value) & is.infinite(value) & value > 0] <- "inf"
            out[!is.na(value) & is.infinite(value) & value < 0] <- "-inf"
            out
        },
        i64 = , i32 = sprintf("%.0f", as.numeric(value)),
        bool = ifelse(value, "1", "0"),
        string = value)
}

.block_need <- function(element) {
    switch(element, f64 = , f32 = "numbers", i64 = , i32 = "whole numbers that fit in the type",
           bool = "TRUE or FALSE without NA", string = "strings without NA")
}

.block_value <- function(kind, value, line) {
    if (identical(kind, "void")) return("")
    if (identical(kind, "string")) return(.to_text(value))
    array <- regmatches(kind, regexec("^(f64|f32|i64|i32|bool|string)\\[([0-9]+)\\]$", kind))[[1]]
    if (length(array)) {
        element <- array[2L]
        size <- as.integer(array[3L])
        wanted <- sprintf("array<%s, %d>", element, size)
        if (!is.atomic(value) || is.null(value) || !is.null(dim(value)))
            stop(sprintf("line %d: the R block returned %s; %s needs a vector of %d values.",
                         line, .block_describe(value), wanted, size), call. = FALSE)
        if (length(value) != size)
            stop(sprintf("line %d: the R block returned %d values; %s needs %d.",
                         line, length(value), wanted, size), call. = FALSE)
        items <- .block_items(element, value)
        if (is.null(items))
            stop(sprintf("line %d: the R block returned %s; %s needs %s.",
                         line, .block_describe(value), wanted, .block_need(element)), call. = FALSE)
        if (identical(element, "string"))
            items <- vapply(items, function(item) utils::URLencode(enc2utf8(item), reserved = TRUE),
                            character(1), USE.NAMES = FALSE)
        return(paste(items, collapse = "\n"))
    }
    items <- if (is.atomic(value) && length(value) == 1L && is.null(dim(value))) .block_items(kind, value) else NULL
    if (is.null(items)) {
        need <- switch(kind, f64 = , f32 = "a number", i64 = , i32 = "a whole number that fits in the type",
                       bool = "TRUE or FALSE", "a value FlowStudio knows")
        stop(sprintf("line %d: the R block returned %s; %s needs %s.", line, .block_describe(value), kind, need),
             call. = FALSE)
    }
    items[[1L]]
}

# Reads the request, assigns the values, runs the code and returns the
# reply list the kernel sends.
.bridge_block <- function(request) {
    fail <- function(text) list(success = FALSE, payload = charToRaw(enc2utf8(text)))
    lines <- strsplit(request, "\n", fixed = TRUE)[[1]]
    at <- 1L
    take <- function() {
        if (at > length(lines)) stop("the request ends early", call. = FALSE)
        item <- lines[[at]]
        at <<- at + 1L
        item
    }
    parsed <- tryCatch({
        if (!identical(take(), "FSBLOCK 1")) stop("unknown block request version", call. = FALSE)
        kind <- take()
        line <- as.integer(take())
        first <- as.integer(take())
        values <- list()
        repeat {
            tag <- take()
            if (identical(tag, "code")) break
            name <- take()
            if (tag %in% c("f", "i", "b", "s")) {
                values[[name]] <- .block_scalar(tag, take())
            } else if (tag %in% c("F", "I", "B", "S")) {
                count <- as.integer(take())
                items <- lapply(seq_len(count), function(i) .block_scalar(tolower(tag), take()))
                values[[name]] <- .block_vector(tag, items)
            } else if (identical(tag, "d")) {
                count <- as.integer(take())
                specs <- lapply(seq_len(count), function(i) c(take(), take()))
                record <- list()
                for (spec in specs) record[[spec[2L]]] <- .block_scalar(spec[1L], take())
                values[[name]] <- record
            } else if (identical(tag, "R")) {
                rows <- as.integer(take())
                count <- as.integer(take())
                specs <- lapply(seq_len(count), function(i) c(take(), take()))
                columns <- lapply(specs, function(spec) vector("list", rows))
                for (row in seq_len(rows))
                    for (k in seq_along(specs)) columns[[k]][[row]] <- .block_scalar(specs[[k]][1L], take())
                frame <- lapply(seq_along(specs), function(k)
                    .block_vector(toupper(specs[[k]][1L]), columns[[k]]))
                names(frame) <- vapply(specs, function(spec) spec[2L], character(1))
                values[[name]] <- as.data.frame(frame, stringsAsFactors = FALSE, optional = TRUE)
            } else {
                stop("unknown value kind ", tag, call. = FALSE)
            }
        }
        code <- if (at <= length(lines)) paste(lines[at:length(lines)], collapse = "\n") else ""
        list(kind = kind, line = line, first = first, values = values, code = code)
    }, error = function(error) error)
    if (inherits(parsed, "error"))
        return(fail(paste0("FlowStudio could not read the block request: ", conditionMessage(parsed), ".")))
    # Blank lines in front give every expression its Flow line number.
    text <- paste0(strrep("\n", max(0L, parsed$first - 1L)), parsed$code)
    expressions <- tryCatch(parse(text = text, keep.source = TRUE, srcfile = srcfilecopy("<flow>", text)),
                            error = function(error) error)
    if (inherits(expressions, "error")) {
        message <- conditionMessage(expressions)
        where <- regmatches(message, regexec("<flow>:([0-9]+):[0-9]+: ([^\n]*)", message))[[1]]
        if (length(where)) return(fail(sprintf("line %s: R syntax error: %s", where[2L], where[3L])))
        return(fail(sprintf("line %d: R syntax error: %s", parsed$line, message)))
    }
    # The passed values exist while the block runs. A workspace variable of
    # the same name comes back afterwards; other names the block assigns stay.
    saved <- lapply(names(parsed$values), function(name)
        if (exists(name, envir = workspace, inherits = FALSE)) list(get(name, envir = workspace)) else NULL)
    names(saved) <- names(parsed$values)
    on.exit(for (name in names(saved)) {
        if (is.null(saved[[name]])) {
            if (exists(name, envir = workspace, inherits = FALSE)) rm(list = name, envir = workspace)
        } else assign(name, saved[[name]][[1L]], envir = workspace)
    }, add = TRUE)
    for (name in names(parsed$values)) assign(name, parsed$values[[name]], envir = workspace)
    references <- attr(expressions, "srcref")
    current <- parsed$line
    value <- NULL
    warned <- character(0)
    printed_lines <- character(0)
    connection <- textConnection("printed_lines", "w", local = TRUE)
    sink(connection)
    failure <- tryCatch(withCallingHandlers({
        for (index in seq_along(expressions)) {
            if (!is.null(references) && length(references) >= index) current <- references[[index]][1L]
            value <- eval(expressions[[index]], envir = workspace)
        }
        NULL
    }, warning = function(warning) {
        warned <<- c(warned, sprintf("line %d: R warning: %s", current, conditionMessage(warning)))
        invokeRestart("muffleWarning")
    }), error = function(error) conditionMessage(error))
    sink()
    close(connection)
    printed <- paste0(if (length(printed_lines)) paste0(paste(printed_lines, collapse = "\n"), "\n") else "",
                      if (length(warned)) paste0(paste(warned, collapse = "\n"), "\n") else "")
    if (!is.null(failure)) return(fail(sprintf("%sline %d: R error: %s", printed, current, failure)))
    result <- tryCatch(.block_value(parsed$kind, value, parsed$line), error = function(error) error)
    if (inherits(result, "error")) return(fail(paste0(printed, conditionMessage(result))))
    printed_raw <- charToRaw(enc2utf8(printed))
    if (length(printed_raw) > 32768L) {
        printed_raw <- c(printed_raw[seq_len(32768L)],
                         charToRaw("\n[FlowStudio: the rest of the block's output was cut]\n"))
    }
    value_raw <- charToRaw(enc2utf8(result))
    if (length(printed_raw) + length(value_raw) > 120L * 1024L)
        return(fail(sprintf("line %d: the R block's value is larger than 120 KiB.", parsed$line)))
    list(success = TRUE, payload = c(charToRaw(paste0(length(printed_raw), "\n")), printed_raw, value_raw))
}

# request: format character then source. Runs in the user workspace.
bridge_evaluate <- function(request) {
    format <- substr(request, 1L, 1L)
    source <- substr(request, 2L, nchar(request))
    if (identical(format, "b")) return(.bridge_block(source))
    value <- NULL
    failure <- NULL
    output <- tryCatch(utils::capture.output({
        for (expression in parse(text = source, keep.source = FALSE))
            value <- eval(expression, envir = workspace)
    }), error = function(error) {
        failure <<- conditionMessage(error)
        character(0)
    })
    if (!is.null(failure)) {
        return(list(success = FALSE, payload = charToRaw(enc2utf8(paste0("Error: ", failure)))))
    }
    printed <- if (length(output)) paste0(paste(output, collapse = "\n"), "\n") else ""
    payload <- if (identical(format, "t")) {
        paste0(printed, .to_text(value))
    } else {
        paste0('{"value":', .to_json(value), ',"output":', json_quote(printed), "}")
    }
    list(success = TRUE, payload = charToRaw(enc2utf8(payload)))
}

# ---- Flow ----------------------------------------------------------------

# Compile and run a Flow program (a .flow path or source) and return its
# output. Flow programs started from R run without the bridge.
flow <- function(program, input = NULL) {
    source <- if (!grepl("\n", program) && grepl("\\.flow$", program) && file.exists(program))
        paste(readLines(program, warn = FALSE), collapse = "\n") else program
    dir <- tempfile("flowstudio-r-flow-")
    dir.create(dir)
    on.exit(unlink(dir, recursive = TRUE), add = TRUE)
    path <- file.path(dir, "main.flow")
    writeLines(source, path)
    if (file.exists("src/flowstudio.flow")) file.copy("src/flowstudio.flow", file.path(dir, "flowstudio.flow"))
    stdin_file <- ""
    if (!is.null(input)) {
        stdin_file <- file.path(dir, "input.txt")
        writeLines(input, stdin_file)
    }
    lines <- suppressWarnings(system2("flow", c("run", shQuote(path)), stdout = TRUE,
                                      stderr = TRUE, stdin = stdin_file))
    status <- attr(lines, "status")
    marks <- which(trimws(lines) == strrep("-", 40L))
    if (!is.null(status) && status != 0L)
        stop(paste0("Flow failed:\n", paste(lines, collapse = "\n")), call. = FALSE)
    if (length(marks) >= 2L) lines <- lines[seq.int(marks[1L] + 1L, length.out = marks[length(marks)] - marks[1L] - 1L)]
    paste(lines, collapse = "\n")
}
