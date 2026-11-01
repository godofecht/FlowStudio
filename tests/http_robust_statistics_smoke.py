#!/usr/bin/env python3
"""Seeded SI median/MAD assertions through real native Flow HTTP check/run."""
from pathlib import Path

from http_smoke import request, compact_native_math_line
from robust_statistics_oracle import inject_robust_assertions, robust_cases
from http_robust_interop import verify_robust_interop


def bundled_source(root: Path) -> str:
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_robust_statistics_smoke.flow",
    )
    return "\n".join(
        "\n".join(
            compact_native_math_line(line)
            for line in (root / path).read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
            and not line.startswith("import .math_equation {")
            and not line.startswith("import .math_static {")
        )
        for path in paths
    )


def verify_robust_statistics() -> None:
    root = Path(__file__).resolve().parents[1]
    base = bundled_source(root)
    headers = {"X-FlowStudio-Intent": "run"}
    assert len(robust_cases()) == 60
    for start in (0, 20, 40):
        source = inject_robust_assertions(base, start=start, stop=start + 20)
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("robust SI compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-robust-statistics-ok" in body, (
            "robust SI numerical execution", start, status, body)

    corrupted = inject_robust_assertions(base, start=0, stop=20, sabotage=True)
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("robust corrupted expectation must compile", status, body)
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("robust corrupted expectation must fail", status, body)
    verify_robust_interop(request, headers)
    print("PASS: 60 seeded SI median/MAD cases through real native Flow HTTP; "
          "48 exact rational expectations, 12 negatives, corruption HTTP 422")


if __name__ == "__main__":
    verify_robust_statistics()
