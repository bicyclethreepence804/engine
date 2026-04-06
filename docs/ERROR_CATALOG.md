# Error and warning catalog

This catalog documents:

- `KiploksErrorCode` - used for critical failures (either thrown as `KiploksValidationError`, or returned as `validate` errors where the CLI does not throw).
- `KiploksWarningCode` - used for degraded but computed outputs in `WFAAnalysisOutput.warnings[]`.

The authoritative code unions live in `engine/packages/contracts/src/errors.ts`.

## Rule: unavailable vs warnings

For WFA product blocks represented by `BlockResult<T>`:

- `BlockResult.available: false` means a structural reason (`KiploksUnavailableReason`) and the block is missing/empty.
- `warnings[]` means the block (or the underlying computation) was computed, but the result is less trustworthy.

Never use `warnings[]` to explain a structural `available: false` decision for the same block.

## Throw / validate error codes: `KiploksErrorCode`

`KiploksErrorCode` is the `code` field for critical failures that prevent a meaningful analysis outcome.

| Code | Typical trigger | Where it shows up |
| --- | --- | --- |
| `INSUFFICIENT_TRADES` | Trade-based WFA requires enough trades to produce multiple walk-forward windows. | Thrown by `analyzeFromTrades()`; returned by `kiploks validate --schema trade-based-wfa`. |
| `INSUFFICIENT_WINDOWS_FROM_TRADES` | Window slicing produced fewer than 2 full windows due to input date span and/or window sizes. | Thrown by `sliceTradesIntoWindows()`; surfaced by `analyzeFromTrades()` and `kiploks analyze-windows` when input is too short. |
| `MISSING_TIMESTAMPS` | A required timestamp is missing or non-finite (notably `closeTime` for slicing). | Thrown by `sliceTradesIntoWindows()` and validated in `kiploks validate --schema trade-based-wfa`. |
| `INVALID_RETURN_VALUE` | The payload shape or computed intermediate value is invalid (cannot be analyzed). | Thrown by CLI entrypoints and internal guards (input validation, analyzers); returned by `kiploks validate` when types are wrong. |
| `SCHEMA_VERSION_MISMATCH` | The selected input schema discriminator is wrong. | Returned by `kiploks validate --schema trade-based-wfa` when `wfaInputMode` is not `tradeSlicedPseudoWfa`. |

Notes:

- `kiploks validate` returns errors (does not throw).
- `analyze-trades` and `analyze-windows` may throw `KiploksValidationError` which the CLI surfaces.

## Warning codes: `KiploksWarningCode`

`KiploksWarningCode` is used in `WFAAnalysisOutput.warnings[]`.

Each warning item has:

- `code: KiploksWarningCode`
- `block: string` (currently used as `wfe` in the implementation)
- `message: string` (human-readable explanation)

| Code | Typical trigger | Which block |
| --- | --- | --- |
| `LOW_TRADE_COUNT` | Input has a low number of trades or windows (threshold implemented as `< 30`). | `wfe` |
| `LOW_WINDOW_COUNT` | Precomputed/sliced WFA has only 2-4 windows; metrics are directional but weak statistically. | `wfe` |
| `EMPTY_WINDOWS_DETECTED` | Reserved for “some windows were empty” scenarios. Not emitted by the current engine implementation. | `wfe` (intended) |
| `HIGH_DEGRADATION` | Reserved for high performance degradation scenarios. Not emitted by the current engine implementation. | `wfe` (intended) |
| `SINGLE_DIRECTION_ONLY` | All trades have the same direction (only long or only short), so the direction mix is not validated. | `wfe` |
| `SHORT_HISTORY` | Time span of the input (by `closeTime` ordering or by window periods) is shorter than 12 months. | `wfe` |
| `PSEUDO_WFA_INTERPRETATION` | Result is from `tradeSlicedPseudoWfa`; no per-window re-optimization is performed. | `wfe` |
| `ROBUSTNESS_SCORE_USES_IMPUTED_DATA` | `robustnessScore` is computed with imputed envelope inputs in public WFA mode. | `robustnessScore` |
| `WEAK_STATISTICAL_SIGNIFICANCE` | WFE permutation p-value is >= `WFE_PERMUTATION_P_WEAK_THRESHOLD` (0.10); observed rank WFE is not rare under random OOS shuffles. In `wfaProfessional`, AA/AAA grades are capped to A at the same threshold; structured `institutionalGradeOverride` (`code: WEAK_STATISTICAL_SIGNIFICANCE`) plus `institutionalGradeOverrideReason`. | `wfe` / `professional` |

**Institutional guard (not a `KiploksWarningCode`)** `FAIL_VERDICT_HIGH_FAILURE_RATE` is recorded on `professional.institutionalGradeOverride.code` and `professionalMeta.guardsTriggered` when verdict is FAIL and WFA failure rate exceeds the submit-time threshold (see `wfaProfessional.ts`).

Implementation reference:

- `engine/packages/core/src/wfa/analyzeFromWfa.ts` generates `LOW_TRADE_COUNT`, `SINGLE_DIRECTION_ONLY`, and `SHORT_HISTORY` warnings for trade-sliced and window-based inputs.
