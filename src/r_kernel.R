# FlowStudio native R kernel: length-framed, single-user persistent session.
# This is not a sandbox. Evaluated R code inherits the local user's permissions.
# stdin: E + 8 lowercase hex digits + UTF-8 source.
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
    output <- tryCatch(
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

repeat {
    header <- read_exact(9L)
    if (is.null(header)) break
    header_text <- rawToChar(header)
    if (!grepl("^E[0-9a-f]{8}$", header_text)) break
    length_text <- substr(header_text, 2L, 9L)
    length_value <- strtoi(length_text, base = 16L)
    if (is.na(length_value) || length_value > MAX_SOURCE) break
    payload <- read_exact(length_value)
    if (is.null(payload)) break
    source <- tryCatch(
        iconv(rawToChar(payload), from = "UTF-8", to = "UTF-8", sub = NA_character_),
        error = function(error) NA_character_
    )
    result <- if (is.na(source)) {
        list(success = FALSE, payload = charToRaw("Invalid UTF-8 source."))
    } else {
        evaluate_source(source)
    }
    length_header <- sprintf("%08x", length(result$payload))
    status <- if (result$success) "0" else "1"
    writeBin(c(charToRaw(paste0(status, length_header)), result$payload), protocol)
    flush(protocol)
}
