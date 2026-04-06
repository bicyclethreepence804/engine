# Full report blocks (benchmark, risk, kill switch) vs public WFA JSON

OSS users often see `benchmark`, `dqg`, `killSwitch`, and related fields on the **contract** (`WFAAnalysisOutput`) but with **`available: false`** and a **`reason`**. That is expected: the **public** `analyzeFromTrades()` / `analyzeFromWindows()` path returns deterministic WFE and related blocks, while **benchmark comparison, DQG, kill-switch verdict, full risk narratives**, and the **final verdict payload** are assembled only when a **host** builds a full `TestResultData` from a unified integration payload.

## Two layers

| Layer | What you get | Where it is built |
| ----- | ------------ | ----------------- |
| **Public WFA** | `WFAAnalysisOutput` - WFE, consistency, optional `robustnessScore` (may be imputed), explicit `available: false` blocks | `core/src/wfa/analyzeFromWfa.ts` |
| **Full report** | `TestResultData` - walk-forward tables, risk analysis, benchmark vs BTC, turnover, robustness score from full inputs, DQG, kill switch evaluation, verdict, summary block, etc. | Mostly `core/src/buildTestResultDataFromUnified.ts` (orchestrated by the integration host; I/O boundaries are outside this repo) |

## Where the math lives in `@kiploks/engine-core` (auditable)

These modules implement formulas and builders used for the **full** report (not all are exposed on the minimal `analyze()` CLI path):

| Area | Typical entry files (under `core/src/`) |
| ---- | ---------------------------------------- |
| Risk | `riskCore.ts`, `riskNarratives.ts` |
| Benchmark | `benchmarkCore.ts`, `benchmarkFromEquity.ts`, `proBenchmarkMetrics.ts` |
| Kill switch | `killSwitch.ts` (`evaluateKillSwitch`) |
| Turnover / costs | `turnoverAndCostDrag.ts`, `turnoverCore.ts` |
| DQG | `dataQualityGuard.ts` |
| Final verdict / summary | `finalVerdictEngine.ts`, `summaryBlockEngine.ts` |
| Unified report assembly | `buildTestResultDataFromUnified.ts`, `mapPayloadToUnified.ts` |

Types for the full report surface through **`@kiploks/engine-contracts`** (for example `TestResultData`); `core/src/testResultData.ts` re-exports for convenience.

## Where it is described

| Document | Content |
| -------- | ------- |
| [`OPEN_CORE_LOCAL_USER_GUIDE.md`](../OPEN_CORE_LOCAL_USER_GUIDE.md) | Scope of Open Core CLI vs full `TestResultData` |
| [`10-methodology-flow-and-engine.md`](10-methodology-flow-and-engine.md) | Block order (DQG → Final Verdict) mapped to `core/src` modules and OSS examples |

How a hosting application wires I/O, persistence, and API assembly around `buildTestResultDataFromUnified` is **outside** this repository.

## Where it is rendered

A hosting UI consumes **`TestResultData`** (often with server-rendered slots for sensitive blocks). That layer is **not** part of the published engine packages.

## Takeaway

- **`sample-output/wfa-from-trades.json`** shows **public WFA** - you will see `killSwitch.available: false`, `dqg.available: false`, etc., with explicit reasons.
- **Benchmark, risk, kill switch** as full analytics appear after the **unified payload / full report build**, not from `analyzeFromTrades()` alone.
