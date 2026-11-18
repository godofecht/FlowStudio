# Python drives R. R holds the data and fits the model; Python wrangles.
# `import flowstudio` reaches the live R session: fs.R.name reads or
# assigns an R variable, fs.r("...") evaluates R and returns the value.
import flowstudio as fs
from collections import defaultdict
from statistics import mean

cars = fs.R.mtcars                # R's built-in data.frame arrives as a Frame
print(cars.nrow, "cars,", len(cars.columns), "columns:", ", ".join(cars.columns[:6]), "...")

# Wrangle in Python: fuel economy by cylinder count.
groups = defaultdict(list)
for row in cars.rows():
    groups[int(row["cyl"])].append(row)
by_cyl = [{"cyl": cyl,
           "cars": len(rows),
           "mpg": round(mean(r["mpg"] for r in rows), 2),
           "hp": round(mean(r["hp"] for r in rows), 1)}
          for cyl, rows in sorted(groups.items())]

# A list of dicts becomes an R data.frame. R fits a model on the full data.
fs.R.by_cyl = by_cyl
print(fs.r("by_cyl"))
coefficients = fs.r("coef(lm(mpg ~ wt + hp, data = mtcars))")
r_squared = fs.r("summary(lm(mpg ~ wt + hp, data = mtcars))$r.squared")
print("lm(mpg ~ wt + hp):", {name: round(value, 4) for name, value in coefficients.items()})
print("R squared:", round(r_squared, 3))

# by_cyl now lives in both sessions. Open the R console and type by_cyl.
