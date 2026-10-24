# Real native-code verification: Rscript + R CMD SHLIB + GNU R headers required.
sys.source("src/flowjit.R", envir = globalenv())

original <- function(x, y) (x * x) + (y * 2.0)
fast <- flowjit_compile(original, hot = 2L, min_length = 8L)
x <- as.double(seq_len(2048L))
y <- rep(3.0, length(x))
stopifnot(identical(fast(x, y), original(x, y)))
stopifnot(flowjit_status(fast)$native == 0L)
stopifnot(identical(fast(x, y), original(x, y)))
s <- flowjit_status(fast)
stopifnot(s$compilations == 1L, s$native == 1L, s$fallback == 1L)
stopifnot(identical(fast(x, 3.0), original(x, 3.0)))
stopifnot(identical(fast(1:8, 1:8), original(1:8, 1:8)))
stopifnot(identical(fast(c(NA_real_, 2.0), c(1.0, 2.0)),
                    original(c(NA_real_, 2.0), c(1.0, 2.0))))
stopifnot(identical(fast(matrix(x, nrow = 16L), y),
                    original(matrix(x, nrow = 16L), y)))
stopifnot(identical(fast(y = y, x = x), original(y = y, x = x)))
s <- flowjit_status(fast)
stopifnot(s$native == 2L, s$fallback == 5L, s$compilations == 1L)

lexical <- new.env(parent = baseenv())
g <- function(x) x + 5.0
environment(g) <- lexical
guarded <- flowjit_compile(g, hot = 1L, min_length = 8L)
stopifnot(identical(guarded(x), g(x)))
stopifnot(flowjit_status(guarded)$native == 1L)
assign("+", function(a, b) base::"-"(a, b), envir = lexical)
stopifnot(identical(guarded(x), g(x)))
stopifnot(flowjit_status(guarded)$fallback == 1L)

bad <- try(flowjit_compile(function(x) log(x)), silent = TRUE)
stopifnot(inherits(bad, "try-error"))
bad <- try(flowjit_compile(function(x) x + environment()$z), silent = TRUE)
stopifnot(inherits(bad, "try-error"))
bad <- try(flowjit_compile(function(x = 1.0) x + 1.0), silent = TRUE)
stopifnot(inherits(bad, "try-error"))
cat("PASS: FlowJIT native compilation, runtime guards, baseline and deoptimization\n")
