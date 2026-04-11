# Path-based Monte Carlo simulation (Open Core)

This document describes the **equity-path** Monte Carlo in `@kiploks/engine-core`: `buildPathMonteCarloSimulation`. It is **not** the same as `wfaProfessional.monteCarloValidation` (bootstrap over **window-level** OOS returns; see [`WFA_PROFESSIONAL.md`](./WFA_PROFESSIONAL.md) §5).

**Index:** [`MONTE_CARLO_SIMULATION_IMPLEMENTATION.md`](./MONTE_CARLO_SIMULATION_IMPLEMENTATION.md).

## Purpose

Given a sequence of equity values (and optional timestamps), the engine:

1. Builds **period returns** from consecutive points.
2. Runs an **i.i.d. bootstrap** (resampling with replacement) of those returns to synthesize many synthetic paths.
3. Compounds each path, then computes **CAGR** (`calculateCagrFromYears`) and **max drawdown** per path (peak-to-trough on the compounded series; reported as **negative decimals**, e.g. `-0.15` for 15% drawdown).
4. Summarizes **percentile bands**, **probability of positive CAGR**, **path stability** and **tail risk** labels, plus **interpretation** bullets (including limits of i.i.d. bootstrap).

Use this block when you want a **path-level** view of uncertainty from a single realized equity curve, not a WFA window permutation test.

## Algorithm (summary)

- **Normalization:** Equity points are sorted by `timestamp` when present; values must be strictly positive. Flat series (zero variance of returns) yields `null`.
- **Horizon for CAGR:** If all points have `timestamp`, horizon in years follows first-to-last span. Otherwise `horizonYears` from options, or `returns.length / 252` with `meta.approximationsUsed` noting the trading-day convention.
- **PRNG:** Always **Mulberry32** via `createMulberry32` in `packages/core/src/prng.ts`. If `options.seed` is omitted, `PATH_MONTE_CARLO_DEFAULT_SEED` is used and recorded in `meta.seedUsed`.
- **CAGR horizon:** Per-path CAGR uses **`calculateCagrFromYears(start, end, horizonYears)`** so the horizon is explicit in years (not a fragile pair of synthetic Unix ms).
- **Ruined paths:** Non-positive compounded equity records **CAGR and MDD sample value `-1`** as sentinels (counted in `ruinousPathCount`); they remain in percentile arrays when finite and lower tail metrics accordingly.
- **Period returns:** When |lag-1 autocorrelation| > **0.15**, a warning is appended to `meta.approximationsUsed`. `meta.periodReturnsAutocorrelationLag1` and `meta.periodReturnsNeweyWestTStat` (HAC t-stat for the mean return) are populated when finite.
- **Ruinous paths:** Paths that hit non-positive balance are counted in `meta.ruinousPathCount`; CAGR/MDD for those samples use sentinel values consistent with `financialMath` (see implementation).
- **Max drawdown in output:** Stored as **negative decimals** (e.g. `-0.23` for -23% peak-to-trough on each simulated path).

## Public types

Contracts live in `@kiploks/engine-contracts` (`pathMonteCarlo.ts`). The equity input type is **`PathMonteCarloEquityPoint`** (`value`, optional `timestamp`). Options: `PathMonteCarloOptions` (`simulations`, `seed`, `minPeriods`, `horizonYears`, `initialBalance`, `budget`).

Return type: **`PathMonteCarloResult`** or **`null`** if the block is unavailable (too few periods, flat returns, etc.).

## Thresholds and method version

Constants are in `packages/core/src/pathMonteCarloConstants.ts`, including:

- `PATH_MONTE_CARLO_METHOD_VERSION` (bump independently of `FORMULA_VERSION` per plan §7; **1.1.0** = audit alignment: CAGR years helper, inline MDD, Type-7-consistent CVaR, CF VaR optional, autocorrelation / Newey–West meta).
- Simulation bounds, default `minPeriods`, `budget` → simulation count mapping.
- Labels for `pathStability`, `tailRisk`, and **viable** path definition (`VIABLE_MDD_THRESHOLD_DECIMAL`).

Percentiles use **Hyndman–Fan type 7** (`percentileType7` in `percentile.ts`), recorded as `meta.percentileMethod: "type7"`.

## Limitations (mandatory)

| Limitation | Note |
|------------|------|
| i.i.d. bootstrap | Ignores serial correlation; block bootstrap is future work. |
| No regime model | Complement with WFA OOS and professional diagnostics where relevant. |
| 252-day horizon when timestamps missing | See `meta.approximationsUsed`. |
| `null` for short/flat curves | Valid "unavailable" outcome; do not treat as engine error. |
| No benchmark / alpha | Out of scope for v1. |

## Reproducibility

- Pass an explicit **`seed`** for deterministic multi-run output in tests and audits.
- Golden fixture: [`examples/monte-carlo-seed42.json`](examples/monte-carlo-seed42.json). Regenerate with `npm run engine:examples:generate-monte-carlo-fixture` (after `npm run build`). Any intentional output change should bump **`PATH_MONTE_CARLO_METHOD_VERSION`** and **CHANGELOG**.

## Performance

Use `budget: 'fast' | 'standard' | 'thorough'` when you do not set `simulations` explicitly (maps to 1k / 10k / 50k paths, capped by `pathMonteCarloConstants.ts`). Browser embedders should prefer `'fast'` if latency matters.

## References

- Efron, B. (1979). *Bootstrap Methods: Another Look at the Jackknife.* Annals of Statistics.
- Basel framework: **expected shortfall** (CVaR) motivation aligns with tail summaries in `DistributionStats` (engine uses sample CVaR at 95% in stats objects; primary user-facing tail framing is still percentile bands and labels).

## Example call

See [`examples/monte-carlo-example.md`](examples/monte-carlo-example.md).
