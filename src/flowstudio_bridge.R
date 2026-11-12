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

# request: format character then source. Runs in the user workspace.
bridge_evaluate <- function(request) {
    format <- substr(request, 1L, 1L)
    source <- substr(request, 2L, nchar(request))
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
