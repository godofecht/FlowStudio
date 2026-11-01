# Independent base-R 8x8x8 anisotropic two-species periodic diffusion/exchange.
# Seed 9137 matches the checked-in native Flow 3D volume acceptance, but the
# implementation uses R vectorized neighbor gathers rather than Flow's loops.
# Run through the persistent production /api/run/r kernel, not a mock.
flowstudio_volume_side <- 8L
flowstudio_volume_x <- rep(0:7, times = 64L)
flowstudio_volume_y <- rep(rep(0:7, each = 8L), times = 8L)
flowstudio_volume_z <- rep(0:7, each = 64L)
flowstudio_volume_index <- function(x, y, z) {
  (x %% 8L) + 8L * (y %% 8L) + 64L * (z %% 8L) + 1L
}
flowstudio_volume_neighbors <- list(
  list(flowstudio_volume_index(flowstudio_volume_x - 1L, flowstudio_volume_y, flowstudio_volume_z),
       flowstudio_volume_index(flowstudio_volume_x + 1L, flowstudio_volume_y, flowstudio_volume_z)),
  list(flowstudio_volume_index(flowstudio_volume_x, flowstudio_volume_y - 1L, flowstudio_volume_z),
       flowstudio_volume_index(flowstudio_volume_x, flowstudio_volume_y + 1L, flowstudio_volume_z)),
  list(flowstudio_volume_index(flowstudio_volume_x, flowstudio_volume_y, flowstudio_volume_z - 1L),
       flowstudio_volume_index(flowstudio_volume_x, flowstudio_volume_y, flowstudio_volume_z + 1L))
)
flowstudio_volume_diffusion <- list(c(0.10, 0.08, 0.06), c(0.04, 0.07, 0.05))
flowstudio_volume_residue <- (9137 + 71 * flowstudio_volume_x + 113 * flowstudio_volume_y +
  157 * flowstudio_volume_z + 17 * flowstudio_volume_x * flowstudio_volume_y +
  19 * flowstudio_volume_y * flowstudio_volume_z + 23 * flowstudio_volume_z * flowstudio_volume_x) %% 251
flowstudio_volume_initial <- list(
  u = 30 + 0.1 * flowstudio_volume_residue,
  v = 10 + 0.07 * ((3 * flowstudio_volume_residue + 41) %% 251)
)
flowstudio_volume_energy <- function(state) {
  sum((state$u - mean(state$u))^2) + sum((state$v - mean(state$v))^2)
}
flowstudio_volume_step <- function(state, ratio = 0.20, exchange = 0.03) {
  if (!is.list(state) || length(state$u) != 512L || length(state$v) != 512L ||
      any(!is.finite(state$u)) || any(!is.finite(state$v))) stop('volume input invalid')
  if (!is.finite(ratio) || ratio < 0 || ratio > 0.5 ||
      !is.finite(exchange) || exchange < 0 || exchange > 0.25 ||
      any(vapply(flowstudio_volume_diffusion, function(c) ratio * sum(c) > 0.5, logical(1)))) {
    stop('volume coefficients invalid')
  }
  diffuse <- function(field, coefficients) {
    next_field <- field
    for (axis in 1:3) {
      pair <- flowstudio_volume_neighbors[[axis]]
      next_field <- next_field + ratio * coefficients[axis] *
        (field[pair[[1]]] + field[pair[[2]]] - 2 * field)
    }
    next_field
  }
  du <- diffuse(state$u, flowstudio_volume_diffusion[[1]])
  dv <- diffuse(state$v, flowstudio_volume_diffusion[[2]])
  list(u = (1 - exchange) * du + exchange * dv,
       v = exchange * du + (1 - exchange) * dv)
}
flowstudio_volume_state <- flowstudio_volume_initial
flowstudio_volume_energies <- numeric(64L)
flowstudio_volume_mass <- sum(unlist(flowstudio_volume_initial, use.names = FALSE))
flowstudio_volume_low <- min(unlist(flowstudio_volume_initial, use.names = FALSE))
flowstudio_volume_high <- max(unlist(flowstudio_volume_initial, use.names = FALSE))
flowstudio_volume_previous_energy <- flowstudio_volume_energy(flowstudio_volume_state)
for (step in seq_len(64L)) {
  flowstudio_volume_state <- flowstudio_volume_step(flowstudio_volume_state)
  flowstudio_volume_energies[step] <- flowstudio_volume_energy(flowstudio_volume_state)
  if (flowstudio_volume_energies[step] > flowstudio_volume_previous_energy + 1e-7 ||
      abs(sum(unlist(flowstudio_volume_state, use.names = FALSE)) - flowstudio_volume_mass) > 1e-8 ||
      min(unlist(flowstudio_volume_state, use.names = FALSE)) < flowstudio_volume_low - 1e-9 ||
      max(unlist(flowstudio_volume_state, use.names = FALSE)) > flowstudio_volume_high + 1e-9) {
    stop('volume physical invariant violated')
  }
  flowstudio_volume_previous_energy <- flowstudio_volume_energies[step]
  if (step == 32L) flowstudio_volume_checkpoint <- flowstudio_volume_state
}
flowstudio_volume_restarted <- flowstudio_volume_checkpoint
for (step in seq_len(32L)) flowstudio_volume_restarted <- flowstudio_volume_step(flowstudio_volume_restarted)
if (!identical(flowstudio_volume_restarted, flowstudio_volume_state)) stop('volume restart mismatch')
flowstudio_volume_replay <- flowstudio_volume_initial
for (step in seq_len(64L)) flowstudio_volume_replay <- flowstudio_volume_step(flowstudio_volume_replay)
if (!identical(flowstudio_volume_replay, flowstudio_volume_state)) stop('volume replay mismatch')
cat('FLOWSTUDIO_VOLUME_R_V1 ',
    paste(sprintf('%.17g', c(flowstudio_volume_state$u, flowstudio_volume_state$v)), collapse = ','),
    '\n', sep = '')
cat('FLOWSTUDIO_VOLUME_R_ENERGY_V1 ',
    paste(sprintf('%.17g', flowstudio_volume_energies), collapse = ','), '\n', sep = '')
