#!/usr/bin/env python3
"""Execute native Flow centered differences through the production HTTP router."""
from pathlib import Path

from http_smoke import request, compact_native_math_line
from http_finite_difference_interop import verify_fd_interop
from http_laplacian3_interop import verify_laplacian3_interop
from http_diffusion3_interop import verify_diffusion3_interop
from test_diffusion3_oracle import seeded_diffusion3_cases, inject_diffusion3_assertions
from test_laplacian3_oracle import (
    manufactured_laplacian3_cases, inject_laplacian3_assertions,
    seeded_laplacian3_cases, inject_seeded_laplacian3_assertions,
)
from test_finite_difference_oracle import (
    finite_difference_cases, inject_finite_difference_assertions,
    manufactured_refinement_cases, inject_manufactured_refinement_assertions,
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
            compact_native_math_line(line, tighten_math_ops=True)
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


def verify_finite_differences() -> None:
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
    # Manufactured cubic/quartic fields: the actual native Flow compiler and
    # HTTP runtime must reproduce both spacings and 4:1 truncation-error
    # reduction under grid refinement, not just exact quadratic stencils.
    assert len(manufactured_refinement_cases()) == 3
    refined = inject_manufactured_refinement_assertions(base)
    assert len(refined.encode("utf-8")) <= 131072, "refinement HTTP source budget"
    status, body = request("POST", "/api/check/flow", refined, headers)
    assert status == 200, ("refinement compile", status, body)
    status, body = request("POST", "/api/run/flow", refined, headers)
    assert status == 200 and "native-math-finite-difference-ok" in body, (
        "refinement native execution", status, body)
    # Independent 3D anisotropic polynomial manufactured solutions are
    # executed through the same production native Flow HTTP compiler.
    assert len(manufactured_laplacian3_cases()) == 3
    three_dimensional = inject_laplacian3_assertions(base)
    assert len(three_dimensional.encode("utf-8")) <= 131072, "3D HTTP source budget"
    status, body = request("POST", "/api/check/flow", three_dimensional, headers)
    assert status == 200, ("3D Laplacian compile", status, body)
    status, body = request("POST", "/api/run/flow", three_dimensional, headers)
    assert status == 200 and "native-math-finite-difference-ok" in body, (
        "3D Laplacian numerical execution", status, body)
    sabotaged_3d = inject_laplacian3_assertions(base, sabotage=True)
    status, body = request("POST", "/api/check/flow", sabotaged_3d, headers)
    assert status == 200, ("sabotaged 3D compiles", status, body)
    status, body = request("POST", "/api/run/flow", sabotaged_3d, headers)
    assert status == 422, ("sabotaged 3D numerical expectation", status, body)
    # Twelve deterministic 3D fields and twelve axis-swapped metamorphic
    # equivalents must compile and execute in bounded native HTTP batches.
    assert len(seeded_laplacian3_cases()) == 24
    for start in (0, 8, 16):
        seeded = inject_seeded_laplacian3_assertions(
            base, start=start, stop=start + 8)
        assert len(seeded.encode("utf-8")) <= 131072, "seeded 3D source budget"
        status, body = request("POST", "/api/check/flow", seeded, headers)
        assert status == 200, ("seeded 3D compile", start, status, body)
        status, body = request("POST", "/api/run/flow", seeded, headers)
        assert status == 200 and "native-math-finite-difference-ok" in body, (
            "seeded 3D execution", start, status, body)
    sabotaged_seeded = inject_seeded_laplacian3_assertions(
        base, start=0, stop=8, sabotage=True)
    status, body = request("POST", "/api/check/flow", sabotaged_seeded, headers)
    assert status == 200, ("sabotaged seeded 3D compiles", status, body)
    status, body = request("POST", "/api/run/flow", sabotaged_seeded, headers)
    assert status == 422, ("sabotaged seeded 3D expectation", status, body)
    # Heterogeneous face diffusivity is lowered and evaluated by native Flow,
    # not by a Python substitute. Each bounded batch also checks SI K/s.
    assert len(seeded_diffusion3_cases()) == 24
    for start in range(0, 24, 4):
        source = inject_diffusion3_assertions(base, start=start, stop=start + 4)
        assert len(source.encode("utf-8")) <= 131072, "diffusion3 HTTP source budget"
        status, body = request("POST", "/api/check/flow", source, headers)
        assert status == 200, ("heterogeneous diffusion compile", start, status, body)
        status, body = request("POST", "/api/run/flow", source, headers)
        assert status == 200 and "native-math-finite-difference-ok" in body, (
            "heterogeneous diffusion execution", start, status, body)
    corrupted_diffusion = inject_diffusion3_assertions(
        base, start=4, stop=8, sabotage=True)
    assert len(corrupted_diffusion.encode("utf-8")) <= 131072
    status, body = request("POST", "/api/check/flow", corrupted_diffusion, headers)
    assert status == 200, ("corrupted diffusion compiles", status, body)
    status, body = request("POST", "/api/run/flow", corrupted_diffusion, headers)
    assert status == 422, ("corrupted diffusion numerical expectation", status, body)
    corrupted_refinement = inject_manufactured_refinement_assertions(
        base, sabotage=True)
    status, body = request("POST", "/api/check/flow", corrupted_refinement, headers)
    assert status == 200, ("corrupted refinement compiles", status, body)
    status, body = request("POST", "/api/run/flow", corrupted_refinement, headers)
    assert status == 422, ("corrupted refinement must fail", status, body)
    corrupted = inject_finite_difference_assertions(base, start=0, stop=9, sabotage=True)
    status, body = request("POST", "/api/check/flow", corrupted, headers)
    assert status == 200, ("corrupted expectation compiles", status, body)
    status, body = request("POST", "/api/run/flow", corrupted, headers)
    assert status == 422, ("corrupted numerical expectation must fail", status, body)
    verify_fd_interop(request, headers)
    verify_laplacian3_interop(request, headers)
    verify_diffusion3_interop(request, headers)
    print("PASS: 27 exact polynomial cases, 3 planar and 3 spatial 4:1 "
          "manufactured refinements through native Flow HTTP and deliberate HTTP 422")


if __name__ == "__main__":
    verify_finite_differences()
