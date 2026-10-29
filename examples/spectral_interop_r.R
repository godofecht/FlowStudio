# Real Rscript consumer for FlowStudio's persistent Flow-owned R kernel.
# The Python kernel supplies flowstudio_spectral_values via a separate HTTP
# request. No NumPy, Python or external R package is used by this oracle.
# The independent semidiscrete Fourier eigenvalue and midpoint amplification
# are checked at EVERY cell, followed by a real base-R graphics capture.

if (!exists("flowstudio_spectral_values", inherits = TRUE)) {
    stop("spectral values were not transferred into the R session")
}
values <- flowstudio_spectral_values
n <- 16L
if (!is.double(values) || length(values) != n * n || any(!is.finite(values))) {
    stop("spectral transfer must contain exactly 256 finite doubles")
}
x <- rep(0:(n - 1L), each = n)
y <- rep(0:(n - 1L), times = n)
mode_x <- 2L
mode_y <- 3L
kxx <- 0.012
kyy <- 0.018
kxy <- 0.004
lambda <- -4 * n^2 * kxx * sin(pi * mode_x / n)^2 -
          4 * n^2 * kyy * sin(pi * mode_y / n)^2 -
          2 * n^2 * kxy * sin(2 * pi * mode_x / n) * sin(2 * pi * mode_y / n)
step <- 0.03 / 120
amplification <- (1 + lambda * step + 0.5 * (lambda * step)^2)^120
expected <- 300 + 7 * amplification * cos(2 * pi * (mode_x * x + mode_y * y) / n)
error <- max(abs(values - expected))
if (error > 2e-10) stop(sprintf("spectral mismatch: %.12g", error))
if (abs(mean(values) - 300) > 2e-10) stop("spectral mass conservation failed")
variance <- mean((values - 300)^2)
if (abs(variance - (7 * amplification)^2 / 2) > 2e-10) {
    stop("spectral variance mismatch")
}
if (any(values < 293) || any(values > 307)) stop("spectral positivity/bounds failed")
image(seq_len(n), seq_len(n), matrix(values, nrow = n, byrow = TRUE),
      col = heat.colors(32), xlab = "Periodic x", ylab = "Periodic y",
      main = "FlowStudio Python to R: anisotropic diffusion")
cat("spectral-r-ok\n")
