#!/usr/bin/env python3
"""Execute native Flow centered differences through the production HTTP router."""
from pathlib import Path

from http_smoke import compact_native_math_line
from http_finite_difference_interop import verify_fd_interop
from test_finite_difference_oracle import (
    finite_difference_cases, inject_finite_difference_assertions,
)


def bundled_source(root: Path) -> str:
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_finite_difference_smoke.flow",
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


def verify_finite_differences(request) -> None:
    base = bundled_source(Path(__file__).resolve().parents[1])
    headers = {"X-FlowStudio-Intent": "run"}
    assert len(finite_difference_cases()) == 27
    for start in (0, 9, 18):
        source = inject_finite_difference_assertions(base, start=start, stop=start + 9)
        assert len(source.encode("utf-8")) <= 131072, "native HTTP source budget"
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("finite difference compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-finite-difference-ok" in body, (
            "finite difference native execution", start, status, body)
    corrupted = inject_finite_difference_assertions(base, start=0, stop=9, sabotage=True)
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("corrupted expectation compiles", status, body)
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("corrupted numerical expectation must fail", status, body)
    verify_fd_interop(request, headers)
    print("PASS: 27 exact polynomial finite-difference cases through native Flow "
          "HTTP, analytical SI checks, and deliberate HTTP 422")


if __name__ == "__main__":
    from http_smoke import request
    verify_finite_differences(request)
