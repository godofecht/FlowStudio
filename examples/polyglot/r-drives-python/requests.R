# R drives Python. Python parses raw log text with its re module; R
# summarises and plots the result. py$name reads or assigns a Python
# variable and py("...") evaluates Python, returning the last value.
log_lines <- c(
  "09:14:02 GET /api/run/flow 200 41ms",
  "09:14:03 GET /api/run/python 200 12ms",
  "09:14:05 POST /api/packages/r/install 200 2310ms",
  "09:14:09 GET /api/run/flow 200 38ms",
  "09:14:11 GET /api/run/r 422 19ms",
  "09:14:12 POST /api/debug/flow/start 200 640ms",
  "09:14:15 GET /api/run/python 200 9ms",
  "09:14:20 GET /api/run/flow 200 44ms",
  "09:14:21 POST /api/debug/flow/step 200 31ms",
  "09:14:22 GET /api/run/r 200 17ms"
)

py$lines <- log_lines             # a character vector becomes a Python list
py(r"(
import re
pattern = re.compile(r"(\S+) (GET|POST) (\S+) (\d+) (\d+)ms")
requests = []
for line in lines:
    time, method, path, status, ms = pattern.match(line).groups()
    requests.append({"time": time, "method": method,
                     "route": path.split("/", 2)[2], "status": int(status), "ms": int(ms)})
print("Python parsed", len(requests), "requests")
)")

requests <- py$requests          # a list of dicts arrives as a data.frame
str(requests)
print(aggregate(ms ~ route, data = requests, FUN = median))
print(table(requests$route, requests$status))

# Back to Python for one more statistic, then a base R plot.
p95 <- py("sorted(r['ms'] for r in requests)[int(0.95 * len(requests)) - 1]")
cat("95th percentile latency:", p95, "ms\n")
boxplot(log10(ms) ~ method, data = requests,
        main = "Latency by method (parsed in Python)", ylab = "log10(ms)")
