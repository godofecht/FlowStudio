# FlowJIT v0: opt-in native compilation of pure vector arithmetic.
# No general R code is translated; GNU R remains the compatibility runtime.
flowjit_compile <- local({
    quota <- new.env(parent = emptyenv())
    quota$compiled <- 0L
    operators <- c("+", "-", "*")

    validate <- function(node, args) {
        if (is.symbol(node)) {
            if (!(as.character(node) %in% args)) stop("Native expressions may only reference formals.")
            return(invisible(TRUE))
        }
        if (is.numeric(node) && length(node) == 1L && is.finite(node)) {
            return(invisible(TRUE))
        }
        if (!is.call(node) || !is.symbol(node[[1L]])) {
            stop("Native expressions require numeric literals, formals, +, - or *.")
        }
        op <- as.character(node[[1L]])
        arity <- length(node) - 1L
        if (!(op %in% operators) ||
            !(arity == 2L || (arity == 1L && op %in% c("+", "-")))) {
            stop("Unsupported native arithmetic operation.")
        }
        for (i in seq_len(arity)) validate(node[[i + 1L]], args)
        invisible(TRUE)
    }

    emit <- function(node, args) {
        if (is.symbol(node)) {
            index <- match(as.character(node), args) - 1L
            return(sprintf("v[%d][lengths[%d] == 1 ? 0 : i]", index, index))
        }
        if (is.numeric(node) && length(node) == 1L) {
            value <- sprintf("%.17g", as.double(node))
            if (!grepl("[.eE]", value)) value <- paste0(value, ".0")
            return(value)
        }
        op <- as.character(node[[1L]])
        if (length(node) == 2L) return(paste0("(", op, emit(node[[2L]], args), ")"))
        paste0("(", emit(node[[2L]], args), " ", op, " ",
               emit(node[[3L]], args), ")")
    }

    c_source <- function(expression, args) {
        n <- length(args)
        paste0(
            "#include <R.h>\n#include <Rinternals.h>\n#include <R_ext/Arith.h>\n",
            "SEXP flowjit_kernel(SEXP inputs) {\n",
            " if (TYPEOF(inputs) != VECSXP || XLENGTH(inputs) != ", n, ") return R_NilValue;\n",
            " const double *v[", n, "]; R_xlen_t lengths[", n, "], count = 0;\n",
            " for (int arg = 0; arg < ", n, "; ++arg) {\n",
            "  SEXP x = VECTOR_ELT(inputs, arg);\n",
            "  if (TYPEOF(x) != REALSXP || ATTRIB(x) != R_NilValue) return R_NilValue;\n",
            "  lengths[arg] = XLENGTH(x);\n",
            "  if (lengths[arg] > count) count = lengths[arg];\n",
            "  v[arg] = REAL(x);\n",
            " }\n",
            " for (int arg = 0; arg < ", n, "; ++arg) {\n",
            "  if (lengths[arg] != count && lengths[arg] != 1) return R_NilValue;\n",
            "  if (count > 0 && lengths[arg] == 0) return R_NilValue;\n",
            "  for (R_xlen_t j = 0; j < lengths[arg]; ++j)\n",
            "   if (!R_FINITE(v[arg][j])) return R_NilValue;\n",
            " }\n",
            " SEXP output = PROTECT(allocVector(REALSXP, count));\n",
            " double *out = REAL(output);\n",
            " for (R_xlen_t i = 0; i < count; ++i)\n",
            "  out[i] = ", emit(expression, args), ";\n",
            " UNPROTECT(1); return output;\n}\n"
        )
    }

    build_native <- function(code) {
        if (quota$compiled >= 16L) stop("FlowJIT compilation quota reached.")
        driver <- file.path(R.home("bin"), "R")
        if (!file.exists(driver)) stop("R compiler driver unavailable.")
        directory <- tempfile("flowstudio-jit-")
        if (!dir.create(directory)) stop("Cannot create JIT build directory.")
        source <- file.path(directory, "kernel.c")
        shared <- paste0("kernel", .Platform$dynlib.ext)
        writeLines(code, source, useBytes = TRUE)
        previous <- getwd()
        on.exit(setwd(previous), add = TRUE)
        setwd(directory)
        output <- suppressWarnings(system2(
            driver, c("CMD", "SHLIB", "-o", shQuote(shared), "kernel.c"),
            stdout = TRUE, stderr = TRUE, timeout = 8L
        ))
        status <- attr(output, "status")
        if (!is.null(status) && status != 0L) {
            stop(paste("Native compiler failed:", paste(tail(output, 5L), collapse = "\n")))
        }
        if (!file.exists(shared)) stop("R CMD SHLIB produced no shared library.")
        dll <- dyn.load(file.path(directory, shared), local = TRUE, now = TRUE)
        symbol <- getNativeSymbolInfo("flowjit_kernel", PACKAGE = dll)
        quota$compiled <- quota$compiled + 1L
        list(symbol = symbol, dll = dll)
    }

    operators_unchanged <- function(fn, expression) {
        used <- intersect(unique(all.names(expression, functions = TRUE)), operators)
        all(vapply(used, function(op) {
            identical(get(op, envir = environment(fn), inherits = TRUE),
                      get(op, envir = baseenv(), inherits = FALSE))
        }, logical(1L)))
    }

    suitable <- function(values, argc, min_length) {
        if (length(values) != argc) return(FALSE)
        names <- names(values)
        if (!is.null(names) && any(nzchar(names))) return(FALSE)
        if (!all(vapply(values, function(value) {
            is.double(value) && is.null(attributes(value)) && all(is.finite(value))
        }, logical(1L)))) return(FALSE)
        lengths <- vapply(values, length, integer(1L))
        count <- max(lengths)
        count >= min_length && all(lengths == count | lengths == 1L)
    }

    function(fn, hot = 8L, min_length = 128L) {
        if (typeof(fn) != "closure") stop("Expected an R closure.")
        args <- names(formals(fn))
        if (length(args) < 1L || length(args) > 4L || anyNA(args) ||
            any(!nzchar(args)) || any(args == "...") ||
            !all(vapply(as.list(formals(fn)),
                        function(x) missing(x), logical(1L)))) {
            stop("Require 1-4 positional formals without defaults.")
        }
        if (length(hot) != 1L || is.na(hot) || !is.finite(hot) ||
            hot < 1 || hot != as.integer(hot)) stop("Invalid hot threshold.")
        if (length(min_length) != 1L || is.na(min_length) || !is.finite(min_length) ||
            min_length < 1 || min_length != as.integer(min_length)) {
            stop("Invalid min_length threshold.")
        }
        expression <- body(fn)
        if (is.call(expression) && identical(expression[[1L]], as.name("{")) &&
            length(expression) == 2L) expression <- expression[[2L]]
        validate(expression, args)
        state <- new.env(parent = emptyenv())
        state$calls <- 0L
        state$native <- 0L
        state$fallback <- 0L
        state$compilations <- 0L
        state$error <- NULL
        state$attempted <- FALSE
        state$symbol <- NULL
        state$dll <- NULL
        baseline <- compiler::cmpfun(fn)
        wrapper <- function(...) {
            # Opt-in STRICT semantics: pure numeric arguments are forced.
            values <- list(...)
            state$calls <- state$calls + 1L
            ready <- suitable(values, length(args), as.integer(min_length)) &&
                     operators_unchanged(fn, expression)
            if (ready && state$calls >= hot && !state$attempted) {
                state$attempted <- TRUE
                compiled <- tryCatch(build_native(c_source(expression, args)),
                    error = function(e) { state$error <- conditionMessage(e); NULL })
                if (!is.null(compiled)) {
                    state$symbol <- compiled$symbol
                    state$dll <- compiled$dll
                    state$compilations <- state$compilations + 1L
                }
            }
            if (ready && !is.null(state$symbol)) {
                result <- .Call(state$symbol, unname(values))
                if (!is.null(result)) {
                    state$native <- state$native + 1L
                    return(result)
                }
            }
            state$fallback <- state$fallback + 1L
            do.call(baseline, values, envir = parent.frame())
        }
        attr(wrapper, "flowjit_state") <- state
        wrapper
    }
})

flowjit_status <- function(fn) {
    state <- attr(fn, "flowjit_state", exact = TRUE)
    if (!is.environment(state)) stop("Not a FlowJIT wrapper.")
    list(calls = state$calls, native = state$native,
         fallback = state$fallback, compilations = state$compilations,
         compiler_error = state$error)
}
