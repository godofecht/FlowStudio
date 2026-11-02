#!/usr/bin/env python3
"""Compile and execute SI dispersion in the actual native Flow HTTP runtime."""
from pathlib import Path

from http_smoke import request, compact_native_math_line
from dispersion_oracle import dispersion_cases, inject_dispersion_assertions
from http_dispersion_interop import verify_dispersion_interop


def bundled_source(root: Path) -> str:
    paths = (
        "src/math_dimensions.flow",
        "src/math_expression_ir.flow",
        "src/math_expression_source.flow",
        "src/math_dispersion_http_smoke.flow",
    )
    source = "\n".join(
        "\n".join(
            compact_native_math_line(line, tighten_math_ops=True)
            for line in (root / path).read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
            and not line.startswith("import .math_dimensions {")
            and not line.startswith("import .math_expression_ir {")
            and not line.startswith("import .math_expression_source {")
        )
        for path in paths
    )
    assert len(source.encode("utf-8")) <= 131072, "Native HTTP source exceeds 128 KiB"
    return source


def verify_dispersion() -> None:
    source = bundled_source(Path(__file__).resolve().parents[1])
    headers = {"X-FlowStudio-Intent": "run"}
    status, body = request("POST", "/api/check/flow", source, headers)
    assert status == 200, ("dispersion compile", status, body)
    status, body = request("POST", "/api/run/flow", source, headers)
    assert status == 200 and "native-math-dispersion-http-ok" in body, (
        "dispersion numerical execution", status, body)

    # The same production compiler/runtime must execute independently seeded
    # exact-rational expectations, SI inference and malformed/overflow cases.
    assert len(dispersion_cases()) == 60
    for start, stop in ((0, 16), (16, 32), (32, 48), (48, 60)):
        seeded = inject_dispersion_assertions(source, start=start, stop=stop)
        assert len(seeded.encode("utf-8")) <= 131072, "dispersion HTTP source budget"
        status, body = request("POST", "/api/check/flow", seeded, headers)
        assert status == 200, ("seeded dispersion compile", start, status, body)
        status, body = request("POST", "/api/run/flow", seeded, headers)
        assert status == 200 and "native-math-dispersion-http-ok" in body, (
            "seeded dispersion numerical execution", start, status, body)
    seeded_corrupted = inject_dispersion_assertions(
        source, start=0, stop=16, sabotage=True)
    status, body = request("POST", "/api/check/flow", seeded_corrupted, headers)
    assert status == 200, ("seeded corrupted dispersion compile", status, body)
    status, body = request("POST", "/api/run/flow", seeded_corrupted, headers)
    assert status == 422, ("seeded corrupted dispersion must fail", status, body)

    marker = "dispersion_close(result.result.value,2.0)"
    assert source.count(marker) == 1
    corrupted = source.replace(marker, "dispersion_close(result.result.value,2.5)", 1)
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("corrupted dispersion compile", status, body)
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("corrupted dispersion must fail", status, body)
    verify_dispersion_interop(request, headers)
    print("PASS: SI sample variance and standard deviations through native HTTP; "
          "60 seeded numerical/negative cases, corrupted expectation HTTP 422")


if __name__ == "__main__":
    verify_dispersion()
