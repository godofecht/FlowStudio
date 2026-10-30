# Native FlowStudio persistent Rscript kernel: one additional anisotropic
# periodic midpoint step, independently computed from Python's 120-step field.
# Emits a bounded numeric frame for the real R -> Python HTTP acceptance.
if (!exists("flowstudio_spectral_values", inherits = TRUE)) {
    stop("spectral input missing from persistent R kernel")
}
n <- 16L
values <- flowstudio_spectral_values
if (!is.double(values) || length(values) != n * n || any(!is.finite(values))) {
    stop("spectral roundtrip requires 256 finite doubles")
}
index <- function(x, y) (x %% n) * n + (y %% n) + 1L
slope <- function(z) {
    out <- numeric(n * n)
    for (x in 0:(n - 1L)) {
        for (y in 0:(n - 1L)) {
            i <- index(x, y)
            xx <- z[index(x + 1L, y)] - 2 * z[i] + z[index(x - 1L, y)]
            yy <- z[index(x, y + 1L)] - 2 * z[i] + z[index(x, y - 1L)]
            xy <- z[index(x + 1L, y + 1L)] - z[index(x + 1L, y - 1L)] -
                  z[index(x - 1L, y + 1L)] + z[index(x - 1L, y - 1L)]
            out[i] <- n * n * (0.012 * xx + 0.018 * yy + 0.002 * xy)
        }
    }
    out
}
step <- 0.03 / 120
first <- slope(values)
flowstudio_spectral_next <- values + step * slope(values + 0.5 * step * first)
if (any(!is.finite(flowstudio_spectral_next)) ||
    abs(mean(flowstudio_spectral_next) - 300) > 3e-10 ||
    min(flowstudio_spectral_next) < 293 || max(flowstudio_spectral_next) > 307) {
    stop("spectral roundtrip violated finite, mass or positivity constraints")
}
cat("FLOWSTUDIO_R_TO_PYTHON_V1 ",
    paste(sprintf("%.17g", flowstudio_spectral_next), collapse = ","), "\n", sep = "")
