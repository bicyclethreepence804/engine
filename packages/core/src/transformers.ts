/**
 * WFA and robustness adapters: typed wrappers around wfaStandaloneTransform for TestResultData.
 */

import type { RobustnessScore, WalkForwardAnalysis } from "./testResultData";
import {
  calculateRobustnessScore as calculateRobustnessScoreCore,
  computeWfaVerdict as computeWfaVerdictCore,
  createEmptyWalkForwardAnalysis as createEmptyWalkForwardAnalysisCore,
  transformToWalkForwardAnalysis as transformToWalkForwardAnalysisCore,
} from "./wfaStandaloneTransform";

export const computeWfaVerdict = computeWfaVerdictCore;

export function createEmptyWalkForwardAnalysis(options?: {
  isDisabled?: boolean;
  verdictExplanation?: string;
}): WalkForwardAnalysis {
  return createEmptyWalkForwardAnalysisCore(options) as WalkForwardAnalysis;
}

export function transformToWalkForwardAnalysis(
  research: Parameters<typeof transformToWalkForwardAnalysisCore>[0],
  resultId?: string,
): WalkForwardAnalysis | null {
  return transformToWalkForwardAnalysisCore(research, resultId) as WalkForwardAnalysis | null;
}

export function calculateRobustnessScore(
  backtestResult: unknown,
  walkForwardAnalysis: unknown,
  monteCarloAnalysis?: unknown,
  proBenchmarkMetrics?: unknown,
  riskAnalysis?: unknown,
  parameterSensitivity?: unknown,
  turnoverAndCostDrag?: unknown,
): RobustnessScore | null {
  return calculateRobustnessScoreCore(
    backtestResult,
    walkForwardAnalysis,
    monteCarloAnalysis,
    proBenchmarkMetrics,
    riskAnalysis,
    parameterSensitivity,
    turnoverAndCostDrag,
  ) as RobustnessScore | null;
}
