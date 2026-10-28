/* Offline Flow 2.0.0 language reference. Every entry is grounded in the
 * upstream docs/LANGUAGE_SPEC.md; this is not a runtime symbol inspector. */
(function (global) {
"use strict";
const SPEC = "https://github.com/flooooooooooow/flow/blob/main/docs/LANGUAGE_SPEC.md";
const entries = Object.freeze({
  "function": ["31-function-declaration", "function name(argument: Type) -> ReturnType { ... }\nFunctions use typed parameters and an optional return type. Example:\nfunction add(a: i32, b: i32) -> i32 { return a + b }"],
  "let": ["32-variable-declaration", "let value: i32 = 42\nlet mut counter: i32 = 0\nLocal let bindings are immutable unless declared mut; type inference is supported."],
  "const": ["33-constant-declaration", "const MAX_SIZE: i32 = 1024\nConstants require an explicit type."],
  "struct": ["34-struct-declaration", "struct Point { x: f32, y: f32 }\nDeclare named, typed fields. Access fields with the dot operator."],
  "if": ["52-if-statement", "if condition { ... } elif other { ... } else { ... }\nAn if-expression also exists; its else arm is required."],
  "while": ["53-while-loop", "let mut i: i32 = 0\nwhile i < 10 { i = i + 1 }"],
  "for": ["54-for-loop", "for i in 0 to 10 { ... }\nfor i in 0 to 100 step 5 { ... }\nparallel for i in 0 to 1000 { ... }\nThe .. range operator is also accepted. Parallel loops use OpenMP where available."],
  "import": ["71-import-declaration", "import std.math { sin, cos }\nimport verify.nat as nat\nimport \"lib/stdlib/math.flow\"\nNamed modules are preferred; string paths are supported."],
  "export": ["72-export-declaration", "export function add(a: i32, b: i32) -> i32 { return a + b }\nAlternatively, export an existing identifier with export name."],
  "effect": ["61-effect-declaration", "effect Log { emit(message: string) -> void, }\nEffects declare operations. A capability implements them and handle installs a handler."],
  "handle": ["63-handle-statement", "handle Log with ConsoleLogger { Log.emit(\"hello\") }\nA handler must implement the declared effect. Multi-effect handlers are supported."],
  "unit": ["26-units-of-measure", "unit Meter\nunit Second\nunit Velocity = Meter / Second\nlet distance: Meter = 100.0 as Meter\nUnits are dimension-checked and erased to numeric runtime representations."],
  "|>": ["45-pipe--declarative-ordering-and-search", "let ordered = values |> sort\nlet index = values |> find(target)\nOrdering and search select compiler plans for supported arrays."],
  "sort": ["45-pipe--declarative-ordering-and-search", "let ordered = values |> sort\nlet orderedBy = values |> sortBy [asc .key, desc .tie]\nOrdering is implemented for fixed-size arrays; some specialization hints remain partial."],
  "find": ["45-pipe--declarative-ordering-and-search", "let index = values |> find(target)\nReturns the first matching index or -1 under Flow's total ordering."],
  "flow": ["101-flow--evolves-as--representation", "flow / evolves as is the evolution DSL, with state, param, solver, every, when and represent phase_portrait constructs. See the upstream specification and evolution examples for complete programs."],
  "field": ["103-field--boundary--laplacian-pde", "field / boundary / evolves as laplacian is expanded before Flow parsing into numerical step helpers. See the upstream field DSL documentation for supported forms."],
  "analyze": ["102-dynamics--analyze--lqr", "analyze plant { lqr { ... } } expands diagonal-Q, scalar-R LQR for systems with up to eight states. See the upstream dynamics DSL documentation."],
  "printf": ["43-built-in-functions", "printf(format: string, ...) -> i32\nBuilt-in formatted output."],
  "length": ["43-built-in-functions", "length(arr: array<T>) -> i32\nBuilt-in array length."],
  "sqrt": ["43-built-in-functions", "sqrt(x: f32) -> f32\nBuilt-in square root."],
  "match": ["11-keywords", "match is partially implemented: literal/struct patterns, guards and some exhaustiveness checks. Integer exhaustiveness is not complete. Consult the upstream specification."],
  "module": ["11-keywords", "module blocks are only partially implemented: names are flattened rather than namespaced. Avoid assuming full module isolation."],
  "test": ["11-keywords", "test declarations parse to boolean functions, but the compiler does not automatically invoke them through a test harness. This feature is partial."],
  "flow run": ["quick-reference", "flow run <file.flow>\nCompile and run a Flow source file with flowc. Requires an installed Flow toolchain."],
  "flow compile": ["quick-reference", "flow compile <file.flow>\nCompile Flow source into an executable."],
  "flow fmt": ["quick-reference", "flow fmt <file.flow>\nFormat Flow source."],
  "flow debug": ["quick-reference", "flow debug <file.flow>\nLaunch the compiler's debugger integration with source line maps."],
});
function hasTopic(topic) { return typeof topic === "string" && Object.hasOwn(entries, topic); }
function lookup(topic) {
  if (!hasTopic(topic)) return {ok:false, output:"No bundled Flow reference entry for this topic."};
  const [anchor, doc] = entries[topic];
  return {ok:true, name:topic, doc, url:SPEC + "#" + anchor, source:"Flow 2.0.0 language specification"};
}
const api = Object.freeze({hasTopic, lookup, topics:() => Object.keys(entries)});
if (typeof module !== "undefined" && module.exports) module.exports = api;
global.FlowStudioFlowHelp = api;
})(globalThis);
