import type { WalkForwardAnalysis } from "./testResultData";

export type { WalkForwardAnalysis };

export interface WalkForwardWindow {
  optimizationReturn?: number;
  validationReturn?: number;
  diagnosis?: string;
  period?: string;
  oosTradesCount?: number;
}

export interface RobustnessScoreLike {
  overall?: number;
  potentialOverall?: number;
  blockedByModule?: string;
  blockedByModules?: string[];
}

export interface TestResultDataLike {
  results?: { totalTrades?: number; totalReturn?: number } | null;
  walkForwardAnalysis?: WalkForwardAnalysis | null;
  turnoverAndCostDrag?: Record<string, unknown> | null;
  benchmarkComparison?: Record<string, unknown> | null;
  riskAnalysis?: Record<string, unknown> | null;
  proBenchmarkMetrics?: Record<string, unknown> | null;
  robustnessScore?: RobustnessScoreLike | null;
  dataQualityGuardResult?: {
    modules?: Array<{ module: string; verdict?: string; details?: Record<string, unknown> }>;
    isCriticalFailure?: boolean;
  } | null;
  strategy?: { testPeriodStart?: string; testPeriodEnd?: string };
  dataRangeDays?: number;
  capacity?: Record<string, unknown> | null;
}
