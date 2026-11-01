# Real persistent R kernel: two-species periodic 32x32 reaction-diffusion.
# The initial arrays come from the real Python kernel through Flow-owned HTTP.
# This is a distinct R midpoint stencil, not Python-generated expected output.
if (!exists("flowstudio_coupled_initial_u", inherits = TRUE) ||
    !exists("flowstudio_coupled_initial_v", inherits = TRUE)) {
    stop("coupled PDE transfer missing")
}
n <- 32L
steps <- 64L
step <- 0.1
diffusion <- 0.12
exchange <- 0.05
if (2L * n * n * steps > 131072L) stop("coupled PDE resource limit exceeded")
check_field <- function(values) {
    is.double(values) && length(values) == n * n && all(is.finite(values))
}
if (!check_field(flowstudio_coupled_initial_u) ||
    !check_field(flowstudio_coupled_initial_v)) {
    stop("coupled PDE requires two finite 32x32 double fields")
}
u <- matrix(flowstudio_coupled_initial_u, nrow = n, ncol = n)
v <- matrix(flowstudio_coupled_initial_v, nrow = n, ncol = n)
laplacian <- function(field) {
    before <- c(n, seq_len(n - 1L))
    after <- c(2L:n, 1L)
    field[before, , drop = FALSE] + field[after, , drop = FALSE] +
        field[, before, drop = FALSE] + field[, after, drop = FALSE] - 4 * field
}
slope <- function(a, b) {
    list(diffusion * laplacian(a) + exchange * (b - a),
         diffusion * laplacian(b) + exchange * (a - b))
}
initial_mass <- sum(u) + sum(v)
for (iteration in seq_len(steps)) {
    first <- slope(u, v)
    middle_u <- u + 0.5 * step * first[[1L]]
    middle_v <- v + 0.5 * step * first[[2L]]
    second <- slope(middle_u, middle_v)
    u <- u + step * second[[1L]]
    v <- v + step * second[[2L]]
}
if (any(!is.finite(u)) || any(!is.finite(v)) ||
    abs(sum(u) + sum(v) - initial_mass) > 1e-8) {
    stop("coupled PDE conservation or finiteness failed")
}
flowstudio_coupled_final_u <- as.vector(u)
flowstudio_coupled_final_v <- as.vector(v)
image(seq_len(n), seq_len(n), u, col = heat.colors(32), useRaster = TRUE,
      xlab = "Periodic x", ylab = "Periodic y",
      main = "FlowStudio Python to R: coupled PDE")
cat("FLOWSTUDIO_COUPLED_R_V1 ",
    paste(sprintf("%.16g", c(flowstudio_coupled_final_u,
                             flowstudio_coupled_final_v)), collapse = ","),
    "\n", sep = "")
