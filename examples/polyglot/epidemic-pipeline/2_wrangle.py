# Step 2 of 3, Python: reshape Flow's runs into a tidy table and a summary,
# then put both into the R session. `runs` was created by the Flow step.
import flowstudio as fs
from statistics import mean

tidy = [{"beta": beta, "day": day, "infected": share}
        for beta, series in runs.items()
        for day, share in enumerate(series)]

summary = []
for beta, series in sorted(runs.items()):
    peak = max(series)
    summary.append({"beta": beta,
                    "R0": round(beta / 0.1, 1),
                    "peak_day": series.index(peak),
                    "peak_share": round(peak, 4),
                    "mean_share": round(mean(series), 4)})

fs.R.epidemic = tidy          # 360 rows, one data.frame in R
fs.R.peaks = summary
print("Python sent", len(tidy), "rows to R as `epidemic`, and the summary as `peaks`:")
print(fs.Frame.from_rows(summary))
