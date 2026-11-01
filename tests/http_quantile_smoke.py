#!/usr/bin/env python3
"""60 deterministic SI Type-7 quantile cases through native Flow HTTP check/run."""
from pathlib import Path

from http_smoke import request
from http_robust_statistics_smoke import bundled_source
from quantile_oracle import inject_quantile_assertions, quantile_cases
from http_quantile_interop import verify_quantile_interop


def verify_quantiles() -> None:
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root)
    headers = {"X-FlowStudio-Intent": "run"}
    assert len(quantile_cases()) == 60
    for start in (0, 20, 40):
        source = inject_quantile_assertions(base, start=start, stop=start + 20)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("quantile SI compile", start, status, body[:500])
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-robust-statistics-ok" in body, (
            "quantile SI execution", start, status, body[-3000:])
    corrupted = inject_quantile_assertions(base, start=0, stop=20, sabotage=True)
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("quantile corrupted expectation compile", status, body[:500])
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("quantile corrupted expectation must fail", status, body[:500])
    verify_quantile_interop(request, headers)
    print("PASS: 60 seeded Type-7 SI quantile cases through real Flow HTTP; "
          "48 exact rational expectations, 12 negatives and HTTP 422 corruption")


if __name__ == "__main__":
    verify_quantiles()
