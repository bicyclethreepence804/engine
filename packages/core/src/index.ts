/**
 * Public API surface for @kiploks/engine-core.
 *
 * Stable API:
 * - analyze()
 * - canonical/hash helpers
 * - contracts-based mappers
 * - deterministic report builders used by OSS integrations
 *
 * Unstable / host-assembly surface (see `./internal.ts` barrel):
 * - low-level building blocks used by host-side report orchestration.
 * - considered implementation details and may change between minor releases.
 */

// Stable public API
export { analyze } from "./analyze";
export {
  analyzeFromTrades,
  analyzeFromWindows,
} from "./wfa/analyzeFromWfa";
export {
  compoundTradeReturns,
  MS_PER_MONTH,
  sliceTradesIntoWindows,
} from "./wfa/windowSlicer";
export {
  buildWfeResult,
  computeAverageRanks,
  computePermutationPValue,
  computeRankWfe,
  compositeScoreFromRankWfe,
  normalizePermutationN,
  verdictFromRankWfe,
} from "./wfa/wfeCalculator";
export { canonicalize, canonicalStringify } from "./canonical";
export { hashCanonical } from "./hash";
export { toDecimalReturn } from "./normalize";
export { mapPayloadToUnified } from "./mapPayloadToUnified";
export { calcWfeCvar95 } from "./wfeFormulas";
export { percentileType7 } from "./percentile";
export * from "./financialMath";
export * from "./parameterSensitivityContract";
export * from "./performanceRatios";
export * from "./riskCore";
export * from "./riskNarratives";
export * from "./periodReturnNormalization";
export * from "./killSwitch";
export * from "./marketImpactWarnings";
export * from "./buildDiagnosticsFromWfa";
export * from "./canonicalMetrics";
export * from "./executionGrade";
export * from "./turnoverCore";
export * from "./turnoverAndCostDrag";
export * from "./normalizeTrades";
export * from "./benchmarkCore";
export * from "./benchmarkKlinesResolver";
export {
  buildEquityCurveFromTradesForBenchmark,
  normalizeEquityCurveFromPayload,
  tryBuildBenchmarkComparisonFromEquityPath,
  yearsBetweenIsoDates,
  type TryBuildBenchmarkComparisonInput,
} from "./benchmarkFromEquity";
export * from "./wfaProfessional";
export * from "./robustnessScoreFromWfa";
export * from "./wfaStandaloneTransform";
export * from "./metricDefinitionContract";
export * from "./layer25";
export * from "./testResultData";
export * from "./constants";

