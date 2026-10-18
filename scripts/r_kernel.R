# FlowStudio's persistent R subprocess protocol. Trusted code only.
# Framing matches scripts/python_kernel.py; no non-base R packages required.
fs_in <- file("stdin", open="rb")
fs_out <- file("stdout", open="wb")
fs_env <- new.env(parent=globalenv())
fs_max_code <- 65536L
fs_max_output <- 1048576L

fs_send <- function(ok, text) {
    bytes <- charToRaw(enc2utf8(text))
    if (length(bytes) > fs_max_output) {
        bytes <- charToRaw("Output exceeded the 1 MiB response limit.\n")
        ok <- FALSE
    }
    header <- sprintf("%s %d\n", if (ok) "OK" else "ERR", length(bytes))
    writeBin(charToRaw(header), fs_out)
    if (length(bytes) > 0L) writeBin(bytes, fs_out)
    flush(fs_out)
}

fs_read_header <- function() {
    result <- raw(0)
    repeat {
        next_byte <- readBin(fs_in, what="raw", n=1L)
        if (length(next_byte) == 0L) return(NULL)
        result <- c(result, next_byte)
        if (length(result) > 48L) stop("Kernel header exceeds 48 bytes")
        if (next_byte == as.raw(10L)) break
    }
    rawToChar(result)
}

fs_read_exact <- function(n) {
    result <- raw(0)
    while (length(result) < n) {
        chunk <- readBin(fs_in, what="raw", n=n - length(result))
        if (length(chunk) == 0L) stop("Incomplete kernel request")
        result <- c(result, chunk)
    }
    result
}

fs_json_string <- function(value) {
    cps <- utf8ToInt(enc2utf8(value))
    escaped <- vapply(cps, function(cp) {
        if (cp == 34L) return('\\"')
        if (cp == 92L) return('\\\\')
        if (cp == 10L) return('\\n')
        if (cp == 13L) return('\\r')
        if (cp == 9L) return('\\t')
        if (cp < 32L) return(sprintf('\\u%04x', cp))
        intToUtf8(cp)
    }, character(1L))
    paste0('"', paste0(escaped, collapse=""), '"')
}

fs_inspect <- function() {
    names <- head(sort(ls(envir=fs_env, all.names=TRUE)), 200L)
    items <- vapply(names, function(name) {
        value <- get(name, envir=fs_env, inherits=FALSE)
        type <- typeof(value)
        preview <- tryCatch({
            paste(head(capture.output(str(value, max.level=0L)), 2L), collapse=" ")
        }, error=function(e) "<unrepresentable>")
        if (nchar(preview, type="chars") > 160L)
            preview <- substr(preview, 1L, 160L)
        paste0('{"name":', fs_json_string(name),
               ',"type":', fs_json_string(type),
               ',"preview":', fs_json_string(preview), '}')
    }, character(1L))
    paste0('{"variables":[', paste0(items, collapse=","), ']}')
}

fs_evaluate <- function(source) {
    lines <- character()
    capture <- textConnection("lines", open="w", local=TRUE)
    sink(capture)
    sink(capture, type="message")
    on.exit({ sink(type="message"); sink(); close(capture) }, add=TRUE)
    ok <- TRUE
    tryCatch({
        expressions <- parse(text=source, keep.source=FALSE)
        for (expr in expressions) {
            result <- withVisible(eval(expr, envir=fs_env))
            if (result$visible) print(result$value)
        }
    }, error=function(e) {
        ok <<- FALSE
        cat("Error: ", conditionMessage(e), "\n", sep="")
    })
    # Flush sink before reading the textConnection's output.
    sink(type="message")
    sink()
    close(capture)
    on.exit(NULL, add=FALSE)
    list(ok=ok, text=if (length(lines)) paste0(paste(lines, collapse="\n"), "\n") else "")
}

repeat {
    header <- tryCatch(fs_read_header(), error=function(e) NULL)
    if (is.null(header)) break
    match <- regexec("^([EIQ]) ([0-9]+)\\n$", header)
    parts <- regmatches(header, match)[[1L]]
    if (length(parts) != 3L) {
        fs_send(FALSE, "Invalid kernel request header")
        next
    }
    command <- parts[2L]
    n <- suppressWarnings(as.integer(parts[3L]))
    if (is.na(n) || n < 0L || n > fs_max_code ||
        (command != "E" && n != 0L)) {
        fs_send(FALSE, "Invalid kernel request length")
        next
    }
    data <- tryCatch(fs_read_exact(n), error=function(e) NULL)
    if (is.null(data)) break
    if (command == "Q") {
        fs_send(TRUE, "bye")
        break
    }
    if (command == "I") {
        fs_send(TRUE, fs_inspect())
    } else {
        result <- fs_evaluate(rawToChar(data))
        fs_send(result$ok, result$text)
    }
}
close(fs_in)
close(fs_out)
