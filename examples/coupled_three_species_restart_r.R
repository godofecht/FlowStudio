# Real persistent R checkpoint/restart for the three-species anisotropic PDE.
# Execute twice with phase 0 then 1, in separate /api/run/r requests.
# Commit the checkpoint and phase only after every validation and numerical step.
n <- 32L
chunk_steps <- 24L
dt <- 0.1
exchange <- 0.07
diffusion_x <- c(0.08, 0.13, 0.19)
diffusion_y <- c(0.17, 0.09, 0.05)
species_names <- c("a", "b", "c")
if (3L * n * n * 2L * chunk_steps > 147456L)
    stop("three-species restart resource limit exceeded")
if (!exists("flowstudio_three_restart_phase", envir = .GlobalEnv, inherits = FALSE))
    stop("three-species restart phase missing")
phase <- get("flowstudio_three_restart_phase", envir = .GlobalEnv, inherits = FALSE)
if (!identical(phase, 0L) && !identical(phase, 1L))
    stop("three-species restart phase invalid")
if (phase == 0L) {
    inputs <- lapply(species_names, function(name) {
        variable <- paste0("flowstudio_three_initial_", name)
        if (!exists(variable, envir = .GlobalEnv, inherits = FALSE))
            stop("three-species restart input missing")
        values <- get(variable, envir = .GlobalEnv, inherits = FALSE)
        if (!is.double(values) || length(values) != n * n || any(!is.finite(values)))
            stop("three-species restart input invalid")
        matrix(values, nrow = n, byrow = TRUE)
    })
    initial_mass <- sum(vapply(inputs, sum, numeric(1L)))
} else {
    if (!exists("flowstudio_three_restart_state", envir = .GlobalEnv, inherits = FALSE) ||
        !exists("flowstudio_three_restart_mass", envir = .GlobalEnv, inherits = FALSE))
        stop("three-species restart checkpoint missing")
    inputs <- get("flowstudio_three_restart_state", envir = .GlobalEnv, inherits = FALSE)
    initial_mass <- get("flowstudio_three_restart_mass", envir = .GlobalEnv, inherits = FALSE)
    if (!is.double(initial_mass) || length(initial_mass) != 1L ||
        !is.finite(initial_mass))
        stop("three-species restart mass invalid")
}
if (!is.list(inputs) || length(inputs) != 3L ||
    any(!vapply(inputs, function(f) is.matrix(f) && is.double(f) &&
        identical(dim(f), c(n, n)) && all(is.finite(f)), logical(1L))))
    stop("three-species restart checkpoint invalid")
if (abs(sum(vapply(inputs, sum, numeric(1L))) - initial_mass) > 3e-9)
    stop("three-species restart checkpoint mass mismatch")
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
state <- lapply(inputs, function(f) f + 0)
for (iteration in seq_len(chunk_steps)) {
    first <- slope(state)
    middle <- Map(function(f, d) f + 0.5 * dt * d, state, first)
    second <- slope(middle)
    state <- Map(function(f, d) f + dt * d, state, second)
}
if (any(!vapply(state, function(f) all(is.finite(f)), logical(1L))) ||
    abs(sum(vapply(state, sum, numeric(1L))) - initial_mass) > 3e-9)
    stop("three-species restart conservation failed")
assign("flowstudio_three_restart_state", state, envir = .GlobalEnv)
assign("flowstudio_three_restart_mass", initial_mass, envir = .GlobalEnv)
assign("flowstudio_three_restart_phase", phase + 1L, envir = .GlobalEnv)
cat("FLOWSTUDIO_THREE_RESTART_V1 ", phase + 1L, " ",
    paste(sprintf("%.16g", unlist(lapply(state, function(f) as.vector(t(f))))),
          collapse = ","), "\n", sep = "")
