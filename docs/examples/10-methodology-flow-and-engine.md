# Methodology page flow vs Open Core engine

The hosted Kiploks **methodology** page (product UI) shows how analysis blocks connect in a fixed order. That order matches how a **full** report is assembled from payload data. The **Open Core** repository ships **deterministic math** for those blocks in `@kiploks/engine-core`, but the **OSS examples** (`01`–`07`, CLI) mostly cover **small** entrypoints (`analyze()`, WFA JSON). They do **not** include a separate runnable script per block.

## Same pipeline as on `/methodology` (product)

```text
Data Quality Guard
  → Walk-Forward
  → Benchmark Metrics
  → Benchmark Comparison
  → Parameter Sensitivity
  → Cost Drag
  → Action Plan
  → Risk Metrics
  → Robustness Score
  → Final Verdict
```

## Where each step is implemented (engine core)

| Methodology block (product name) | Typical role in `TestResultData` | Primary Open Core modules (under `core/src/`) |
| -------------------------------- | --------------------------------- | ---------------------------------------------- |
| Data Quality Guard | `dataQualityGuardResult` | `dataQualityGuard.ts` |
| Walk-Forward | `walkForwardAnalysis`, WFE / WFA transforms | `wfaProfessional.ts`, `wfa/`, `buildDiagnosticsFromWfa.ts`, related |
| Benchmark Metrics | `proBenchmarkMetrics` | `proBenchmarkMetrics.ts`, `benchmarkCore.ts`, `canonicalMetrics.ts` |
| Benchmark Comparison | `benchmarkComparison` | `benchmarkFromEquity.ts`, `tryBuildBenchmarkComparisonFromEquityPath`, `benchmarkKlinesResolver.ts` (market data inputs are supplied by the host) |
| Parameter Sensitivity | `parameterSensitivity` / WFA diagnostics | `parameterSensitivityContract.ts`, `buildDiagnosticsFromWfa.ts`, `analysis` helpers |
| Cost Drag | `turnoverAndCostDrag` | `turnoverAndCostDrag.ts`, `turnoverCore.ts` |
| Action Plan | strategy action plan payloads | `strategyActionPlanPrecomputed.ts` |
| Risk Metrics | `riskAnalysis` | `riskCore.ts`, `riskNarratives.ts` |
| Robustness Score | `robustnessScore` | `robustnessScoreFromWfa.ts` (and inputs from other blocks) |
| Final Verdict | `verdictPayload` / summary | `finalVerdictEngine.ts`, `summaryBlockEngine.ts`, `decisionArtifacts.ts`, `killSwitch.ts` |

**Assembly** of the full object is `buildTestResultDataFromUnified.ts` plus `mapPayloadToUnified.ts` (types in `@kiploks/engine-contracts`). The **host** orchestrates I/O (exchange data, storage, API). Orchestration details are outside this repo.

## What the OSS **examples** cover

| Example | Touches methodology blocks |
| ------- | ------------------------ |
| [`01-minimal-analyze.md`](01-minimal-analyze.md) | None of the full report (summary + metadata only). |
| [`02-wfa-from-trades.md`](02-wfa-from-trades.md), [`03-wfa-from-windows.md`](03-wfa-from-windows.md) | **Walk-Forward** slice of the pipeline (public WFA / WFE JSON); not full DQG/benchmark/verdict. |
| [`04-csv-to-trades.md`](04-csv-to-trades.md) | Input only (trades → engine). |
| [`05`–`07`](05-cli-validate-and-analyze-trades.md) | CLI and validation; same partial surface as above. |
| [`08-result-shape-and-kiploks-ui.md`](08-result-shape-and-kiploks-ui.md), [`result-layout-demo.html`](result-layout-demo.html) | Conceptual mapping + static demo; **not** full `TestResultData`. |
| [`09-full-report-vs-public-wfa.md`](09-full-report-vs-public-wfa.md) | Explains why public WFA JSON has `available: false` on many blocks. |

There is **no** separate example file per methodology section by design: reproducing the full chain requires a **unified integration payload** and a host that calls `buildTestResultDataFromUnified`; that wiring is not duplicated as ten runnable demos in Open Core.

## If you need the full pipeline

1. Read [`OPEN_CORE_LOCAL_USER_GUIDE.md`](../OPEN_CORE_LOCAL_USER_GUIDE.md) (scope of Open Core vs full report).
2. Use the Kiploks **methodology** documentation (public site) for **definitions** of each block; use this table to jump to **engine source** for formulas.
