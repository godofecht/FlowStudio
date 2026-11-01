#!/usr/bin/env python3
"""Compile and execute native variadic SI reductions through production HTTP."""
from pathlib import Path

from http_smoke import request
from variadic_oracle import inject_variadic_assertions, variadic_cases


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
    base_source = bundled_source(root)
    assert "native-math-variadic-ok" in base_source
    source = inject_variadic_assertions(base_source)
    headers = {"X-FlowStudio-Intent": "run"}
    status, body = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("variadic source compile", status, body)
    status, body = request("POST", "/api/run/flow", source, headers)
    assert status == 200 and "native-math-variadic-ok" in body, (
        "variadic native execution", status, body)

    # Sabotage only the first independently computed integer expectation.
    # Production compilation must still succeed, execution must fail closed.
    tampered = inject_variadic_assertions(base_source, sabotage=True)
    assert tampered != source
    status, body = request("POST", "/api/check/flow", tampered, headers)
    assert status == 200, ("tampered source must compile", status, body)
    status, body = request("POST", "/api/run/flow", tampered, headers)
    assert status == 422, ("tampered native execution must fail", status, body)
    print(f"PASS: native SI variadic reductions over real HTTP, 31 baseline "
          f"+ {len(variadic_cases())} seeded cases and deliberate HTTP 422")


if __name__ == "__main__":
    main()
