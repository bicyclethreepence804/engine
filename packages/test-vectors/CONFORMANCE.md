# Engine test vectors and conformance policy

## Layout

- **`v1/`** - `analyze(input, config)` summaries plus locked `expected.metadata.inputHash` and `configHash` (canonical regression).
- **`v2/`** - Golden fixtures for **risk**, **benchmark**, and **turnover** pure functions in `@kiploks/engine-core` (numeric snapshots). Each file may lock `expected.metadata.fixtureHash` (SHA-256 of the fixture with all `expected` keys stripped) so accidental edits to inputs are caught.

## When formulas or serialization change

1. **Refresh locked metadata (v1 + v2)** - Run one command after any of:
   - **`v1`** `canonicalize`, `hashCanonical`, `AnalyzeInput`, default decimals/seed behavior.
   - **`v2`** fixture shape or inputs (`suite`, `name`, `input`, `cases`, `description`, etc.) - not only when outputs change. The fingerprint ignores `expected` blocks, so updating golden numbers does **not** require a metadata refresh unless you also change inputs.

   ```bash
   npm run engine:vectors:refresh-metadata
   ```

   Alias: `npm run engine:vectors:refresh-hashes` (same script).

   Commit the updated JSON files in the same change as the canonical or fixture-input update.

2. **`v2` goldens (outputs)** - If you change `riskBuilderFromRCore`, benchmark turnover-of-returns math, or turnover slippage/constraint logic, update the relevant JSON under `v2/` and/or adjust tolerances in `golden.conformance.test.ts`. Prefer tight `exact` checks where integers are stable; use `approx` + `approxDigits` for floats.

## Running tests

- Full engine suite: `npm run engine:test`
- Conformance-only (name pattern): `npm run engine:conformance` (matches `Conformance` in describe names)

## Adding vectors

- Keep **`schemaVersion`: 1** until we introduce a breaking schema change.
- Use **English** in `name` / `description` fields.
- Avoid flaky wall-clock or environment-dependent inputs.

## CLI

From the **engine** repository root, `kiploks test-conformance` (or `npm run engine:test-conformance`) runs the same checks as `npm run engine:validate` (Vitest engine suite, boundary check, bundle check).

## v2 risk / turnover extensions

- **Risk** fixtures may set `expected.expectNan` (top-level keys) and `expected.expectMetricsNan` when the engine returns `NaN` (e.g. empty `R` list).
- **Turnover** bundle cases may set `expected.expectZScoreNaN` when `computeTradeReturnZScore` is intentionally `NaN` (e.g. one trade or zero variance).
- **Benchmark** `mean-excess-flat` uses the same harness as `mean-excess-net-edge` (aligned points, mean excess, net edge bps).
