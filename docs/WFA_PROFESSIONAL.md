# Public `wfaProfessional` documentation

`wfaProfessional` is the core engine module that builds **Professional WFA** artifacts from normalized walk-forward periods and an optional performance transfer (equity curve transfer).

It computes **7 blocks** plus an **institutional grade** and a textual recommendation:

- `equityCurveAnalysis`
- `wfeAdvanced`
- `parameterStability`
- `regimeAnalysis`
- `monteCarloValidation` (bootstrap over window OOS returns today; see §5 - not path-level Monte Carlo yet)
- `stressTest`
- `institutionalGrade` (grade + recommendation)

This module is intended for use in server-side or batch pipelines (not in minimal `analyze()` CLI demos). It is intended for institutional and professional interpretation. It does not expose ad-hoc tuning knobs; the output is derived from the provided periods (and optionally from transferred equity curve points).

## Public entrypoints

The engine-core exports the following functions from `wfaProfessional`:

- `validateAndNormalizeWfaInput(wfa)` - normalizes input into numeric periods and optionally extracts/sorts curve points.
- `buildProfessionalWfa(validationResult)` - builds the 7 blocks from normalized periods.
- `runProfessionalWfa(wfa)` - combines validation + build; returns `null` when input cannot produce a professional report.

If `runProfessionalWfa(...)` (or `buildProfessionalWfa(...)`) cannot validate the input (for example, not enough periods), it returns `null`.

## Input contract (high level)

`wfaProfessional` expects:

1. A `periods` array (or `windows` alias) where each period provides:
   - `optimizationReturn` and `validationReturn` (expected to be decimal returns after contract normalization).
   - Optional `parameters` that can be numeric (used for parameter stability).
2. Optional `performanceTransfer` which can contain curve points via `performanceTransfer.windows[].oosEquityCurve` (or `equityCurve` or `curve` aliases).

When curve points are missing or too short, curve-based blocks may become unavailable (for example `equityCurveAnalysis`).

## Output blocks

### 1) Equity curve analysis (`equityCurveAnalysis`)

Represents analysis of the out-of-sample equity curve (transferred curve or approximated curve when transfers are not available enough).

Key fields:

- `available: boolean`
- `chunkStats?: Array<{ return: number; volatility: number; maxDrawdown: number }>`
- `trendConsistency?: "HIGH" | "MEDIUM" | "LOW"`
- `overallTrend?: "UP" | "FLAT" | "DOWN"`
- `volatilityProgression?: number[]`
- `verdict?: "STRONG" | "ACCEPTABLE" | "WEAK"`

If the curve is too short for reliable chunking, `equityCurveAnalysis` becomes unavailable (`available: false`).

### 2) Advanced WFE (`wfeAdvanced`)

Rank-based walk-forward efficiency plus a one-sided permutation null for OOS shuffles (WFE v2; same shape as public `WFAAnalysisOutput.wfe`).

Key fields:

- `rankWfe: number` - mean over windows of (OOS average rank / IS average rank), each window using independent 1-based tie-aware ranks on IS and OOS series.
- `permutationPValue: number` - one-sided p: fraction of `permutationN` random OOS shuffles with `rankWfe` >= observed (seeded RNG per iteration).
- `permutationN: number` - permutation count used (typically from `AnalyzeConfig.permutationN`, default 1000, bounds 100..10000).
- `windowCount: number`
- `seed: number` - seed wired into permutation draws for reproducibility.
- `compositeScore: number` - heuristic 0..100 from `rankWfe`, with an extra cap when mean IS > 0 and mean OOS < 0.
- `verdict: "ROBUST" | "ACCEPTABLE" | "WEAK" | "FAIL"` - heuristic from `rankWfe` and the mean IS / mean OOS guard above.

`buildProfessionalWfa` / `runProfessionalWfa` accept optional `permutationN` in the options object alongside `seed`.

### 3) Parameter stability (`parameterStability`)

Drift-based parameter stability across periods.

Key fields:

- `available: boolean`
- `parameterDrift?: Record<string, { mean: number; std: number; driftPct: number; stability: "STABLE" | "ADAPTIVE" | "FRAGILE" }>`
- `fragileParameters?: string[]`
- `overallStability?: "ROBUST" | "ACCEPTABLE" | "FRAGILE"`
- `stabilityScore?: number | null`

If there are no numeric parameters across the input periods, `parameterStability` becomes unavailable (`parameterStability.available` is `false` and the block is omitted by `runProfessionalWfa`).

### 4) Regime analysis (`regimeAnalysis`)

Detects regime shifts and outlier periods using z-scores on validation (OOS) returns.

Key fields:

- `regimeChanges: Array<{ windowIndex: number; periodNumber: number; value: number; zScore: number; reason: string }>`
- `hasOutliers: boolean`
- `distributionShape?: "NORMAL" | "SKEWED_RIGHT" | "SKEWED_LEFT" | "HEAVY_TAILS"`
- `skewness?: number`
- `kurtosis?: number`
- `verdict?: "STABLE" | "REGIME_SHIFT" | "OUTLIER_DETECTED"`

### 5) Monte Carlo validation (`monteCarloValidation`)

**Name vs implementation:** The field is called `monteCarloValidation` for API stability. **Current behavior is bootstrap**, not a full Monte Carlo simulation over equity paths or trade sequences.

**What it does today:** The engine takes one **validation (OOS) return per walk-forward window** (`validationReturn`). It **resamples those scalars with replacement** over many iterations (default **1000**, clamped to **[100, 50_000]**; override via `AnalyzeConfig.monteCarloBootstrapN` on precomputed WFA / `buildProfessionalWfa` / `runProfessionalWfa` option **`bootstrapN`**), builds the empirical distribution of the **mean OOS return** across resamples, then derives **68% and 95% intervals** with **Hyndman–Fan type 7** (`percentileType7`, same family as path Monte Carlo), **probabilityPositive** (share of bootstrap means above zero), and a **verdict** from the bootstrap distribution only.

**Verdict rules (aligned with implementation):** `CONFIDENT` if `probabilityPositive >= 0.75` and the 95% CI does **not** straddle zero (`ci95Low > 0` or `ci95High < 0`). `PROBABLE` if `probabilityPositive >= 0.6`. `UNCERTAIN` if `probabilityPositive >= 0.5`. Otherwise `DOUBTFUL`.

**PRNG:** Always **Mulberry32** with `seed` from options when finite; otherwise the same default seed as path MC (`PATH_MONTE_CARLO_DEFAULT_SEED` in `pathMonteCarloConstants.ts`). No `Math.random` fallback.

**What it does not do:** No path-dependent simulation (no synthetic full equity curves drawn step-by-step, no shock model over returns beyond window resampling, no strategy-path Monte Carlo).

Key fields:

- `actualMeanReturn: number`
- `confidenceInterval95: [number, number]`
- `confidenceInterval68: [number, number]`
- `probabilityPositive: number`
- `verdict: "CONFIDENT" | "PROBABLE" | "UNCERTAIN" | "DOUBTFUL"`

### 6) Stress test (`stressTest`)

Worst-case analysis and degradation/recovery signals.

Key fields:

- `worstCaseReturn: number`
- `worstCaseWindow: number`
- `worstCaseDD: number | null`
- `worstCaseDDIsEstimate?: boolean`
- `volatilitySpike?: { degradationPct: number; impact: "Minimal" | "Moderate" | "Significant" }`
- `recoveryCapability?: "HIGH" | "MODERATE" | "LOW" | "N/A"`
- `verdict?: "RESILIENT" | "ACCEPTABLE" | "FRAGILE"`

Curve-based parts (worst-case drawdown and recovery capability) can become estimates or be unavailable depending on curve availability.

### 7) Institutional grade (`institutionalGrade`)

Converts block verdicts into a single grade and a human-readable recommendation.

Key fields:

- `grade:`
  - `"AAA - INSTITUTIONAL GRADE"`
  - `"AA - PROFESSIONAL"`
  - `"A - ACCEPTABLE"`
  - `"BBB - RESEARCH ONLY"`
- `recommendation: string`
- `institutionalGradeOverrideReason?: string` - human-readable mirror of structured override `reason` (for simple UI).
- `institutionalGradeOverride?: { code, reason, threshold, actualPValue?, actualFailureRate? }` - machine-readable (**`FORMULA_VERSION` 2.2.0+**). Codes:
  - `WEAK_STATISTICAL_SIGNIFICANCE` - **AA**/**AAA** would apply but `wfeAdvanced.permutationPValue >= WFE_PERMUTATION_P_WEAK_THRESHOLD` (0.10); grade **capped to A - ACCEPTABLE**.
  - `FAIL_VERDICT_HIGH_FAILURE_RATE` - WFA verdict **FAIL** and failed-window rate **> 30%**; grade **capped to BBB - RESEARCH ONLY**.

## Professional metadata (`professionalMeta`)

Along with `professional`, `runProfessionalWfa` returns `professionalMeta`:

- `engineFormulaVersion: string` - aligned with package `FORMULA_VERSION` (e.g. **2.2.0**).
- `version: string`
- `inputsSummary:`
  - `periodCount: number`
  - `hasPerformanceTransfer: boolean`
  - `hasValidationMaxDD: boolean`
  - `curvePointCount?: number`
- `guardsTriggered: string[]`
- `approximationsUsed: string[]`

Use `guardsTriggered` and `approximationsUsed` to understand when a block is computed via approximations or when some parts are skipped due to input limitations.

## Minimal TypeScript usage

```ts
import { runProfessionalWfa } from "@kiploks/engine-core";

const professionalOut = runProfessionalWfa({
  periods: [
    { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { p: 1 } },
    { optimizationReturn: 0.12, validationReturn: 0.07, parameters: { p: 2 } },
  ],
  // performanceTransfer is optional
});

if (!professionalOut) {
  throw new Error("Professional WFA: insufficient input");
}

console.log(professionalOut.professional.institutionalGrade?.grade);
```
