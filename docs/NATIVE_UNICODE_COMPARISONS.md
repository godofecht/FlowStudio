# Native mathematical comparison glyphs

The bounded native Flow 2.0 scalar source parser in `src/math_expression_source.flow` accepts four additional three-byte UTF-8 spellings: `≦` (U+2266) and `⩽` (U+2A7D) lower to the existing SI-aware less-than-or-equal predicate (opcode 11); `≧` (U+2267) and `⩾` (U+2A7E) lower to greater-than-or-equal (opcode 13). They share precedence, predicate typing, eager evaluation, and dimensional equality checks with `<=`, `>=`, `≤` and `≥`. The IR records the exact three-byte source span. Invalid operands and malformed expressions fail closed; no Unicode normalization or string rewriting occurs.

The checked-in executable native test is `flow run src/math_unicode_comparisons_smoke.flow` (18 assertions, including source spans, physical dimensions, boolean composition, and invalid syntax). The production HTTP/Monaco source bundle `src/math_expression_source_http_smoke.flow` contains seven further assertions. The mandatory CI workflow runs the native test on Ubuntu and macOS, and its existing native HTTP acceptance gate compiles and executes the source bundle through `/api/check/flow` and `/api/run/flow`. The same workflow also runs the checked-in Python-backed Navier–Stokes and analytic heat programs.

This change is limited to scalar mathematical comparison syntax. It does **not** implement general equation or tensor ASTs, native Navier–Stokes, arbitrary PDE solver selection, or computed multidimensional visualization. Those remain open in issue #198.

## Fullwidth strict relational operators

The native source parser additionally recognizes `＜` (U+FF1C) and `＞` (U+FF1E), lowering them to strict less-than (opcode 10) and strict greater-than (opcode 12). Unlike `≦` and `≧`, equality does not satisfy these predicates. Each UTF-8 glyph occupies an exact three-byte IR source span; dimensional mismatches and malformed placement are rejected. No editor-side rewriting or Unicode normalization is involved.

`src/math_unicode_comparisons_smoke.flow` exercises eleven additional native assertions, and `src/math_expression_source_http_smoke.flow` adds four production HTTP/Monaco assertions. Both are included in the existing Linux/macOS native CI workflow. General tensor and PDE equation parsing, native Navier–Stokes and computed multidimensional visualization remain separate unfinished work.
