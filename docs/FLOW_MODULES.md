# FlowStudio Flow-native modules — 2026-10-16

New code: src/stats.flow, src/stats_smoke.flow, src/data_routes.flow and src/data_routes_smoke.flow.

The statistics module computes online mean, extrema and sample variance. The static route table names the existing CSV/TSV viewer assets explicitly.

Suggested validation commands from the repository root:

    flow run src/stats_smoke.flow
    flow run src/data_routes_smoke.flow

**Unverified:** Flow compilation and execution. The static routes are not connected to src/main.flow, so the viewer is not yet served. RStudio feature parity is incomplete.

Next: integrate the route table into the Flow HTTP dispatcher, test actual asset responses, and validate the native build.
