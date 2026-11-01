#!/usr/bin/env python3
"""Compile and execute native variadic SI reductions through production HTTP."""
from pathlib import Path

from http_smoke import request


def bundled_source(root: Path) -> str:
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_variadic_reductions_smoke.flow",
    )
    return "\n".join(
        "\n".join(
            line.strip().removeprefix("export ")
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


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    source = bundled_source(root)
    assert "native-math-variadic-ok" in source
    headers = {"X-FlowStudio-Intent": "run"}
    status, body = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("variadic source compile", status, body)
    status, body = request("POST", "/api/run/flow", source, headers)
    assert status == 200 and "native-math-variadic-ok" in body, (
        "variadic native execution", status, body)

    # Change an analytical expectation without changing the compiled program.
    # The live server must report a native execution failure, not a mock pass.
    tampered = source.replace(
        "near(result.result.value, 6.0)",
        "near(result.result.value, 7.0)", 1)
    assert tampered != source
    status, body = request("POST", "/api/check/flow", tampered, headers)
    assert status == 200, ("tampered source must compile", status, body)
    status, body = request("POST", "/api/run/flow", tampered, headers)
    assert status == 422, ("tampered native execution must fail", status, body)
    print("PASS: native SI variadic reductions over real HTTP, 31 assertions and HTTP 422")


if __name__ == "__main__":
    main()
