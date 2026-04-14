/**
 * Stable standalone analyze report DTO slice.
 * This contract is shared between host services and engine-core to avoid type drift.
 */

export interface RobustnessScoreTextPayload {
  moduleLabels?: Record<string, string>;
  methodologyNote?: string;
}

export interface RobustnessScore {
  overall: number;
  potentialOverall?: number;
  components: {
    parameterStability: number;
    timeRobustness: number;
    marketRegime: number;
    monteCarloStability: number;
    sensitivity: number;
    dataQuality?: number;
  };
  modules: {
    validation: number;
    risk: number;
    stability: number;
    execution: number;
    dataQuality?: number;
  };
  blockedByModule?: "validation" | "risk" | "stability" | "execution" | "dataQuality";
  blockedByModules?: Array<"validation" | "risk" | "stability" | "execution" | "dataQuality">;
  wfeNote?: string;
  textPayload?: RobustnessScoreTextPayload;
  stabilityNotComputed?: boolean;
}

export interface WalkForwardAnalysisTextPayload {
  wfeNaReason?: string;
  consistencyNaReason?: string;
  failedWindowsSummary?: string;
  verdictExplanation?: string;
}

export type ProfessionalMonteCarloMethod =
  | "path_mc_v1"
  | "window_iid_bootstrap"
  | "unavailable"
  | "window_iid_bootstrap_legacy_snapshot";

export type ProfessionalMonteCarloReasonCode =
  | "insufficient_windows"
  | "missing_equity_curve"
  | "insufficient_curve_points"
  | "insufficient_curve_span"
  | "flat_equity"
  | "cpu_budget_exceeded";

export interface ProfessionalMonteCarloValidation {
  method?: ProfessionalMonteCarloMethod;
  version?: string;
  iterations?: number;
  seed?: number;
  reasonCode?: ProfessionalMonteCarloReasonCode;
  warnings?: string[];
  actualMeanReturn?: number;
  confidenceInterval95?: [number, number];
  confidenceInterval68?: [number, number];
  probabilityPositive?: number;
  verdict?: "CONFIDENT" | "PROBABLE" | "UNCERTAIN" | "DOUBTFUL";
}

export interface ProfessionalWfa {
  equityCurveAnalysis?: unknown;
  wfeAdvanced?: unknown;
  parameterStability?: unknown;
  regimeAnalysis?: unknown;
  monteCarloValidation?: ProfessionalMonteCarloValidation;
  stressTest?: unknown;
  institutionalGrade?: string;
  institutionalGradeOverride?: unknown;
  institutionalGradeOverrideReason?: string;
  recommendation?: string;
}

export interface ProfessionalMeta {
  version: string;
  engineFormulaVersion?: string;
  inputsSummary: {
    periodCount: number;
    hasPerformanceTransfer: boolean;
    hasValidationMaxDD: boolean;
    curvePointCount?: number;
    monteCarloBootstrapIterations?: number;
  };
  guardsTriggered: string[];
  approximationsUsed: string[];
}

export interface WalkForwardAnalysis {
  performanceTransfer: { windows: unknown[] };
  wfe?: number;
  consistency: number;
  degradationRatio: number;
  performanceDegradation?: number;
  failedWindows: { count: number; total: number; windows: unknown[] };
  overfittingRisk?: { score: number; level: string; note?: string };
  verdict: string;
  verdictExplanation: string;
  windows?: unknown[];
  paramDrift?: "Low" | "Medium" | "High";
  heavyRef?: unknown;
  wfaConfig?: unknown;
  statisticalSignificance?: unknown;
  distribution?: { validationReturns?: number[] };
  isDisabled?: boolean;
  textPayload?: WalkForwardAnalysisTextPayload;
  /** Core can enrich these fields with professional block structures. */
  professional?: ProfessionalWfa;
  professionalMeta?: ProfessionalMeta;
}

export interface TestResultData {
  strategy: {
    name: string;
    version: string;
    symbol: string;
    timeframe: string;
    exchange: string;
    testPeriodStart: string;
    testPeriodEnd: string;
    totalConfigurations: number;
    parametersCount: number;
  };
  parametersAndRunSettings?: unknown;
  decisionSummary?: unknown;
  benchmarkComparison: unknown;
  proBenchmarkMetrics?: unknown;
  robustnessScore: RobustnessScore | null;
  walkForwardAnalysis: WalkForwardAnalysis;
  parameterSensitivity: unknown;
  turnoverAndCostDrag?: unknown;
  riskAnalysis?: unknown;
  decisionLogic?: unknown;
  verdictPayload?: unknown;
  results?: { totalTrades?: number; totalReturn?: number };
  integrityIssues?: Array<{ message: string; severity: "warning" | "error" }>;
  schemaVersion?: number;
  canonicalMetrics?: {
    fullBacktestMetrics?: unknown;
    oosMetrics?: unknown;
    wfaWindowMetrics?: unknown[];
  };
  [key: string]: unknown;
}
