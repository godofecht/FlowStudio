#!/usr/bin/env python3
"""Execute checked-in native Flow trigonometry through the real HTTP compiler.

Run while ./build/flowstudio serves 127.0.0.1:8751.
"""
from pathlib import Path

from http_smoke import request


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_equation.flow",
        "src/math_static.flow",
        "src/math_trigonometry_smoke.flow",
    )
    source = "\n".join(
        "\n".join(
            line.removeprefix("export ")
            for line in (root / path).read_text(encoding="utf-8").splitlines()
            if not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
            and not line.startswith("import .math_equation {")
            and not line.startswith("import .math_static {")
        )
        for path in paths
    )
    assert "native-math-trigonometry-ok" in source
    headers = {"X-FlowStudio-Intent": "run"}
    status, body = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("native trigonometry compiler", status, body)
    status, body = request("POST", "/api/run/flow", source, headers)
    assert status == 200 and "native-math-trigonometry-ok" in body, (
        "native trigonometry execution", status, body)
    print("PASS: native trigonometric source, IR and equation HTTP execution")


if __name__ == "__main__":
    main()
