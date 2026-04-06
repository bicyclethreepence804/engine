import {
  buildCanonicalR as buildCanonicalRCore,
  riskBuilderFromRCore,
  computeTailRatio as computeTailRatioCore,
  type OosTradeLike,
  type RiskAnalysisResult,
  type RiskBuilderFromROptions,
} from "./riskCore";
import { buildRiskNarratives } from "./riskNarratives";

export type { OosTradeLike, RiskAnalysisResult, RiskBuilderFromROptions };
export { buildRiskNarratives };
export const computeTailRatio = computeTailRatioCore;
export const buildCanonicalR = buildCanonicalRCore;

export function riskBuilderFromR(
  R: number[],
  options?: RiskBuilderFromROptions,
): RiskAnalysisResult {
  const base = riskBuilderFromRCore(R, options);
  return { ...base, ...buildRiskNarratives(base) };
}
