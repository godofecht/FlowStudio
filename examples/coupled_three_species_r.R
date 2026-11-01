# Actual persistent R midpoint integration: three directed-coupled anisotropic fields.
# Python uses row-major (y, x); R explicitly preserves that convention.
n <- 32L
steps <- 48L
dt <- 0.1
exchange <- 0.07
diffusion_x <- c(0.08, 0.13, 0.19)
diffusion_y <- c(0.17, 0.09, 0.05)
species_names <- c("a", "b", "c")
if (3L * n * n * steps > 147456L) stop("three-species PDE resource limit exceeded")
for (name in species_names) {
    variable <- paste0("flowstudio_three_initial_", name)
    if (!exists(variable, inherits = TRUE)) stop("three-species input missing")
    values <- get(variable, inherits = TRUE)
    if (!is.double(values) || length(values) != n * n || any(!is.finite(values)))
        stop("three-species input must be finite 32x32 doubles")
}
state <- lapply(species_names, function(name) {
    matrix(get(paste0("flowstudio_three_initial_", name), inherits = TRUE),
           nrow = n, byrow = TRUE)
})
initial_mass <- sum(vapply(state, sum, numeric(1L)))
before <- c(n, seq_len(n - 1L))
after <- c(2L:n, 1L)
slope <- function(fields) {
    lapply(seq_len(3L), function(s) {
        f <- fields[[s]]
        diffusion_x[s] * (f[, before, drop = FALSE] + f[, after, drop = FALSE] - 2 * f) +
            diffusion_y[s] * (f[before, , drop = FALSE] + f[after, , drop = FALSE] - 2 * f) +
            exchange * (fields[[if (s == 1L) 3L else s - 1L]] - f)
    })
}
for (iteration in seq_len(steps)) {
    first <- slope(state)
    middle <- Map(function(f, d) f + 0.5 * dt * d, state, first)
    second <- slope(middle)
    state <- Map(function(f, d) f + dt * d, state, second)
}
if (any(!vapply(state, function(f) all(is.finite(f)), logical(1L))) ||
    abs(sum(vapply(state, sum, numeric(1L))) - initial_mass) > 3e-9)
    stop("three-species conservation or finiteness failed")
for (s in seq_len(3L)) {
    assign(paste0("flowstudio_three_final_", species_names[s]),
           as.vector(t(state[[s]])), envir = .GlobalEnv)
}
image(seq_len(n), seq_len(n), t(state[[1L]]), col = heat.colors(32L),
      useRaster = TRUE, xlab = "Periodic x", ylab = "Periodic y",
      main = "FlowStudio: three-species anisotropic PDE")
cat("FLOWSTUDIO_THREE_R_V1 ",
    paste(sprintf("%.16g", unlist(lapply(state, function(f) as.vector(t(f))))),
          collapse = ","), "\n", sep = "")
