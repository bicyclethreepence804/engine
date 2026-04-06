/**
 * Public WFA entrypoint contracts (analyzeFromTrades / analyzeFromWindows).
 * Payload shapes are stable; engine fills result bodies in later sprints.
 */

import type { AnalyzeOutput, Trade } from "./analyzeContract";
import type { BlockResult, KiploksWarning } from "./errors";

export type { BlockResult, KiploksWarning } from "./errors";

export type EquityPoint = {
  timestamp: number;
  value: number;
};

export type WindowConfig = {
  inSampleMonths: number;
  outOfSampleMonths: number;
  stepMode: "anchored" | "rolling";
};

export type WindowMetrics = {
  return: number;
  sharpe?: number;
  maxDrawdown?: number;
};

export type WFAWindow = {
  period: { start: string; end: string };
  inSample: WindowMetrics;
  outOfSample: WindowMetrics;
  parameters?: Record<string, number>;
};

export type TradeBasedWFAInput = {
  trades: Trade[];
  windowConfig: WindowConfig;
  wfaInputMode: "tradeSlicedPseudoWfa";
  equityCurve?: EquityPoint[];
};

export type PrecomputedWFAInput = {
  windows: WFAWindow[];
  wfaInputMode: "precomputed";
  equityCurve?: EquityPoint[];
};

/**
 * Rank-based WFE + one-sided permutation p-value (see docs/WFE_UPGRADE_ENGINEERING_PLAN.md).
 * `verdict` / `compositeScore` are heuristics from `rankWfe` only (p-value does not gate grade in v1).
 */
export type WFEResult = {
  rankWfe: number;
  permutationPValue: number;
  permutationN: number;
  windowCount: number;
  seed: number;
  verdict: "ROBUST" | "ACCEPTABLE" | "WEAK" | "FAIL";
  compositeScore: number;
};

export type ConsistencyResult = {
  verdict: WFEResult["verdict"];
  compositeScore: number;
  rankWfe: number;
  permutationPValue: number;
};
export type ParameterStabilityResult = Record<string, unknown>;
export type BenchmarkResult = Record<string, unknown>;
export type NarrativeResult = Record<string, unknown>;
export type DQGResult = Record<string, unknown>;
export type KillSwitchResult = Record<string, unknown>;

export type WFAAnalysisOutput = AnalyzeOutput & {
  /** Basic robustness 0-100 from WFA periods when full product payload is absent. */
  robustnessScore?: number;
  wfe: WFEResult;
  consistency: ConsistencyResult;
  parameterStability: BlockResult<ParameterStabilityResult>;
  benchmark: BlockResult<BenchmarkResult>;
  robustnessNarrative: BlockResult<NarrativeResult>;
  dqg: BlockResult<DQGResult>;
  killSwitch: BlockResult<KillSwitchResult>;
  warnings: KiploksWarning[];
};

/** Semver for the public `WFAAnalysisOutput` shape; bump when fields or semantics change. */
export const WFA_PUBLIC_ANALYSIS_SCHEMA_VERSION = "2.0.0";
