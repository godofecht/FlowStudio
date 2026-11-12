# Step 3 of 3, R: model and plot the table Python built. `epidemic` and
# `peaks` are ordinary data.frames here; open the Data view to browse them.
growth <- do.call(rbind, lapply(split(epidemic, epidemic$beta), function(run) {
    early <- run[run$day <= 15, ]
    fit <- lm(log(infected) ~ day, data = early)
    data.frame(beta = run$beta[1], growth_rate = round(coef(fit)[["day"]], 4),
               doubling_days = round(log(2) / coef(fit)[["day"]], 1))
}))
report <- merge(peaks, growth, by = "beta")
print(report, row.names = FALSE)

# Python checks R's arithmetic: the early growth rate should be close to
# beta - gamma for a small initial outbreak.
cat("Python check:", py("[round(b - 0.1, 3) for b in sorted(runs)]"), "\n")

colours <- c("#4e79a7", "#f28e2b", "#e15759")
plot(NULL, xlim = c(0, 120), ylim = c(0, max(epidemic$infected)),
     xlab = "day", ylab = "infected share", main = "SIR runs: Flow simulated, Python reshaped, R plotted")
for (k in seq_along(peaks$beta)) {
    run <- epidemic[epidemic$beta == peaks$beta[k], ]
    lines(run$day, run$infected, col = colours[k], lwd = 2)
}
legend("topright", legend = paste("R0 =", peaks$R0), col = colours, lwd = 2, bty = "n")
