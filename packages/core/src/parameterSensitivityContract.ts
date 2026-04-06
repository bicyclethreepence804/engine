export const STABLE_THRESHOLD = 0.3;
export const PENALTY_THRESHOLD = 0.4;
export const NEEDS_TUNING_MAX = 0.6;
export const RISK_SCORE_PASS_THRESHOLD = 50;
export const SENSITIVITY_PRECISION = 2;
export const NEEDS_TUNING_PENALTY = 2;
export const FRAGILE_PENALTY = 5;
export const RISK_SCORE_CEILING_PER_PENALISED = 5;
export const PERFORMANCE_DECAY_REJECT_PCT = 80;
export const MIN_PERIODS_FOR_DECAY = 3;

export const RISK_CLASS_THRESHOLDS = {
  LOW: 65,
  MODERATE: 50,
  HIGH: 20,
} as const;

export function isStable(sensitivity: number): boolean {
  return sensitivity < STABLE_THRESHOLD;
}
export function isReliable(sensitivity: number): boolean {
  return sensitivity >= STABLE_THRESHOLD && sensitivity < PENALTY_THRESHOLD;
}
export function isNeedsTuning(sensitivity: number): boolean {
  return sensitivity >= PENALTY_THRESHOLD && sensitivity < NEEDS_TUNING_MAX;
}
export function isFragile(sensitivity: number): boolean {
  return sensitivity >= NEEDS_TUNING_MAX;
}
export function isPenalised(sensitivity: number): boolean {
  return sensitivity >= PENALTY_THRESHOLD;
}

export const TOOLTIPS: Record<string, string> = {
  "Local Topology":
    "Shape of the score-vs-parameter curve (when curve points available). Sharp peak = fragile; flat = stable. PSI, Surface Gini, Safety Margin, OOS variance attribution. Not used in Risk Score formula.",
  "Sharpe Retention":
    "(OOS Sharpe/IS Sharpe)x100. Computed only when IS Sharpe > 0. Not the same as Benchmark OOS Retention (return ratio). When > 100%, displayed as improvement (OOS > IS); descriptive only, no significance test. May reflect regime, sample size, or IS underperformance; interpret with caution.",
  "Sharpe Drift (OOS vs IS)":
    "Sharpe Drift = Sharpe Retention - 100. Report in p.p. only (e.g. 31.3 p.p.). Positive = OOS > IS (improvement); negative = degradation. Defined when Sharpe Retention is defined (e.g. IS Sharpe > 0).",
  "Efficiency (Governance)":
    "Alias for Sharpe Drift; same formula and value. Display one value only (Sharpe Drift). Result in p.p. only; do not use '%' for Drift.",
  "Max Tail-Risk Reduction":
    "(OOS CVaR - IS CVaR) / |IS CVaR| x 100 (%). Name 'Reduction' is historical; result can be negative (risk increased). Use only negative values for loss. If IS CVaR >= 0: do not compute or display (data error); orchestration layer skips. Result > 0 = Risk Reduced; < 0 = Risk Increased. Relative change in tail risk (CVaR 95%).",
  "Governance Impact":
    "Governance metrics: signal attenuation, Sharpe retention, Sharpe Drift, tail-risk reduction. Advisory only (manual review); not deployment gates. Performance Decay is a deployment gate (step 2), not a Governance metric. Efficiency is an alias for Sharpe Drift; same value, advisory only.",
  "Multi-Parameter Coupling":
    "When parameters move together (high correlation), risk can multiply. Coupling Risk and Max Correlation Pair show linked parameters. Not included in Risk Score formula.",
};

export const PIPELINE_DESCRIPTION =
  "Deployment: (1) Data Quality Guard and sufficient OOS trades - if failed, REJECT; (2) Performance Decay - if >= 80%, REJECT; (3) Parameter Risk Score - if < 50, REJECT; (4) otherwise by Risk Class: MODERATE (50-64) -> APPROVED (Conditional), LOW (>= 65) -> APPROVED. When only Parameter Risk Score is used: 50 <= score < 65 -> APPROVED (Conditional); score >= 65 -> APPROVED. When overall robustness score is present, [50, 60) with PASS also yields APPROVED (Conditional). When Performance Decay is unavailable (< 3 periods), the Decay condition is omitted; deployment is then based only on DQG, Min OOS Trades, and Risk Score. Set HOLD_WHEN_DECAY_UNAVAILABLE to true (host) to force HOLD when Decay is N/A and would otherwise APPROVE.";

function getRiskScoreFormulaSentence(): string {
  return `Base = 100x(1 - maxSensitivity). Penalty = ${NEEDS_TUNING_PENALTY}xneedsTuningCount + ${FRAGILE_PENALTY}xfragileCount (${NEEDS_TUNING_PENALTY} per Needs Tuning [0.40, 0.60), ${FRAGILE_PENALTY} per Fragile >=0.60). Raw = Base - Penalty. Ceiling = 100 - ${RISK_SCORE_CEILING_PER_PENALISED}xpenalisedCount. Final = max(0, floor(min(Raw, ceiling))). The number shown is Final. Order: round sensitivity to ${SENSITIVITY_PRECISION} decimals, then band, then penalisedCount, then Base, Penalty, Raw, Ceiling, Final. penalisedCount = Needs Tuning + Fragile.`;
}

function buildManifest(): string {
  const formula = getRiskScoreFormulaSentence();
  return [
    `Parameter Sensitivity & Stability: single source from the host pipeline (optimization trials or WFA-derived). Sensitivity (R^2), ${SENSITIVITY_PRECISION} decimals.`,
    `Risk Score: ${formula} Bands: Stable [0, 0.30), Reliable [0.30, 0.40), Needs Tuning [0.40, 0.60), Fragile >=0.60. Example: Base 71 - Penalty 0 => Raw 71, Ceiling 100 => Final 71.`,
    `Risk Class: LOW if score >= ${RISK_CLASS_THRESHOLDS.LOW}, MODERATE if 50<=score<65, HIGH if 20<=score<50, CRITICAL if <20.`,
    PIPELINE_DESCRIPTION,
    "When Performance Decay is N/A (< 3 periods), Decay gate is skipped; decision is (Risk Score verdict) AND (Min OOS Trades met). Set HOLD_WHEN_DECAY_UNAVAILABLE to true to force HOLD when Decay N/A. Governance metrics (Sharpe Drift, Tail-Risk, Coupling) do not affect Risk Score or Deployment; advisory only.",
  ].join(" ");
}

function buildScaleText(): string {
  return `Scale: round sensitivity to ${SENSITIVITY_PRECISION} decimals, then band. Stable [0, 0.30); Reliable [0.30, 0.40); Needs Tuning [0.40, 0.60); Fragile >= ${NEEDS_TUNING_MAX}. Boundaries: 0.30 = Reliable (start); 0.40 = Needs Tuning (start); 0.60 = Fragile (start). penalisedCount = params with rounded sensitivity >= 0.4. Penalty: ${NEEDS_TUNING_PENALTY} per Needs Tuning, ${FRAGILE_PENALTY} per Fragile. Ceiling = 100 - ${RISK_SCORE_CEILING_PER_PENALISED}xpenalisedCount. Final = max(0, floor(min(Raw, ceiling))). Order: round -> band -> penalisedCount -> Base -> Penalty -> Raw -> Ceiling -> Final. Score: integer (floor).`;
}

export function getCopyContract(): {
  manifest: string;
  scale: string;
  pipelineDescription: string;
  tooltips: Record<string, string>;
  stableThreshold: number;
  penalisedThreshold: number;
  sensitivityPrecision: number;
  riskScorePassThreshold: number;
  needsTuningPenalty: number;
  fragilePenalty: number;
} {
  return {
    manifest: buildManifest(),
    scale: buildScaleText(),
    pipelineDescription: PIPELINE_DESCRIPTION,
    tooltips: { ...TOOLTIPS },
    stableThreshold: STABLE_THRESHOLD,
    penalisedThreshold: PENALTY_THRESHOLD,
    sensitivityPrecision: SENSITIVITY_PRECISION,
    riskScorePassThreshold: RISK_SCORE_PASS_THRESHOLD,
    needsTuningPenalty: NEEDS_TUNING_PENALTY,
    fragilePenalty: FRAGILE_PENALTY,
  };
}

export const METHODOLOGY_NOTE =
  "Sensitivity = R^2 (correlation^2) between parameter value and trial score; we use it as a proxy for 'outcome strongly tied to parameter' (tuning matters). High R^2 = parameter significantly predicts outcome. Magnitude (slope per unit change) is a separate planned metric; Risk Score does not use slope. Sensitivity values: 2 decimal places. Risk Score: integer (floor). From optimization trials or WFA windows.";
