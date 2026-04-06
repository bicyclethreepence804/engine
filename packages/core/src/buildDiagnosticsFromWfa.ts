/**
 * Fill rare diagnostics from WFA-only data (Surface Gini, Avg Safety Margin,
 * Max Correlation Pair, Interdependency Risk, OOS Variance Attribution, Deployment Status,
 * and Governance Impact: sharpeRetention, performanceDecayPct, signalAttenuation, efficiencyGain, maxTailRiskReduction).
 * Used when payload has no study-level parameter sensitivity. Single source of truth for these metrics (host pipeline only).
 */

import {
  calculateCorrelation,
  roundTo,
  calculateMean,
  calculateStdDev,
} from "./financialMath";
import {
  PENALTY_THRESHOLD,
  NEEDS_TUNING_MAX,
  NEEDS_TUNING_PENALTY,
  FRAGILE_PENALTY,
  RISK_SCORE_CEILING_PER_PENALISED,
  RISK_SCORE_PASS_THRESHOLD,
  RISK_CLASS_THRESHOLDS,
  SENSITIVITY_PRECISION,
} from "./parameterSensitivityContract";
import { toDecimalReturn } from "./normalize";

export interface WfaPeriodLike {
  optimizationReturn?: number;
  validationReturn?: number;
  parameters?: Record<string, unknown>;
  metrics?: {
    optimization?: { totalReturn?: number; total?: number };
    validation?: { totalReturn?: number; total?: number };
  };
}

/** WFA input for diagnostics (distinct name from parameterSensitivity.WfaLike to avoid export clash). */
export interface WfaDiagnosticsLike {
  windows?: WfaPeriodLike[];
  periods?: WfaPeriodLike[];
  verdict?: string;
}

export interface RobustnessLike {
  overall?: number;
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function normalizeParams(params: Record<string, unknown> | undefined): Record<string, number> {
  if (!params || typeof params !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    const n = toNum(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** Gini coefficient (0-1). Values sorted ascending. */
function gini(values: number[]): number {
  if (values.length < 2) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    weighted += (2 * (i + 1) - n - 1) * sorted[i];
  }
  return weighted / (n * sum);
}

function formatParamName(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim() || key;
}

/** Empirical CVaR 95%: average of worst 5% of returns (sorted ascending). */
function cvar95(returns: number[]): number {
  if (returns.length === 0) return NaN;
  const sorted = [...returns].sort((a, b) => a - b);
  const k = Math.max(1, Math.floor(sorted.length * 0.05));
  const tail = sorted.slice(0, k);
  return tail.reduce((s, x) => s + x, 0) / tail.length;
}

function isFiniteNum(x: number): boolean {
  return typeof x === "number" && Number.isFinite(x) && !Number.isNaN(x);
}

/** Round to 3 decimal places so Governance Impact matches hand calculation with 1-decimal % display (consistent with Performance Degradation v1.1). */
const PERIOD_RETURN_DECIMALS = 3;
function roundToDecimals(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

/**
 * Build Governance Impact diagnostics from WFA periods (IS/OOS returns only).
 * Parity with former integration script formulas. Sets sharpeRetention, performanceDecayPct,
 * signalAttenuation, efficiencyGain, maxTailRiskReduction when >= 3 periods with both returns.
 * Period returns rounded to 3 decimals so signalAttenuation aligns with WFA Performance Degradation (e.g. 17% not 18.9%).
 */
function buildGovernanceImpactFromPeriods(
  periods: Array<Record<string, unknown>>
): Pick<
  DiagnosticsPatch,
  "sharpeRetention" | "performanceDecayPct" | "signalAttenuation" | "efficiencyGain" | "sharpeDriftPct" | "maxTailRiskReduction"
> {
  const patch: DiagnosticsPatch = {};
  const isReturns: number[] = [];
  const oosReturns: number[] = [];
  for (const raw of periods) {
    let opt =
      (raw.optimizationReturn as number | undefined) ??
      (raw.optimization_return as number | undefined);
    let val =
      (raw.validationReturn as number | undefined) ??
      (raw.validation_return as number | undefined);
    const m = raw.metrics as Record<string, Record<string, unknown>> | undefined;
    if (opt == null && m?.optimization)
      opt = (m.optimization.totalReturn ?? m.optimization.total) as number | undefined;
    if (val == null && m?.validation)
      val = (m.validation.totalReturn ?? m.validation.total) as number | undefined;
    const o = toNum(opt);
    const v = toNum(val);
    if (!Number.isFinite(o) || !Number.isFinite(v)) continue;
    const decOpt = toDecimalReturn(o);
    const decVal = toDecimalReturn(v);
    if (!Number.isFinite(decOpt) || !Number.isFinite(decVal)) continue;
    isReturns.push(roundToDecimals(decOpt, PERIOD_RETURN_DECIMALS));
    oosReturns.push(roundToDecimals(decVal, PERIOD_RETURN_DECIMALS));
  }
  if (isReturns.length < 3 || oosReturns.length < 3) return patch;

  const meanIs = calculateMean(isReturns);
  const meanOos = calculateMean(oosReturns);
  const stdIs = calculateStdDev(isReturns, meanIs);
  const stdOos = calculateStdDev(oosReturns, meanOos);
  const isSharpe = stdIs > 0 ? meanIs / stdIs : NaN;
  const oosSharpe = stdOos > 0 ? meanOos / stdOos : NaN;

  // Clamp wide enough so high retention (e.g. 1500%) is visible; avoid infinite display.
  const SHARPE_RETENTION_CLAMP = 2000;
  let sharpeRet: number | undefined;
  if (isFiniteNum(isSharpe) && isSharpe !== 0 && isFiniteNum(oosSharpe)) {
    const raw = (oosSharpe / isSharpe) * 100;
    sharpeRet = roundTo(Math.max(-SHARPE_RETENTION_CLAMP, Math.min(SHARPE_RETENTION_CLAMP, raw)), 2);
  }
  if (sharpeRet != null && isFiniteNum(sharpeRet)) patch.sharpeRetention = sharpeRet;

  // Performance Degradation N/A when mean IS <= 0 (contract: do not apply when IS non-positive).
  const meanIsEpsilon = 1e-9;
  let perfDecay: number | undefined;
  if (meanIs > meanIsEpsilon && isFiniteNum(isSharpe) && isSharpe !== 0) {
    if (oosSharpe <= 0 && isFiniteNum(oosSharpe)) {
      perfDecay = 100;
    } else {
      const raw = (1 - oosSharpe / isSharpe) * 100;
      perfDecay = roundTo(Math.max(0, Math.min(100, raw)), 2);
    }
  }
  if (perfDecay != null && isFiniteNum(perfDecay)) patch.performanceDecayPct = perfDecay;

  if (meanIs !== 0 && isFiniteNum(meanIs)) {
    const sigAttRaw = ((meanOos - meanIs) / Math.abs(meanIs)) * 100;
    if (isFiniteNum(sigAttRaw))
      patch.signalAttenuation = roundTo(Math.max(0, Math.min(100, Math.abs(sigAttRaw))), 2);
  }

  // Efficiency (Governance label) = 100 - Sharpe Retention. Sharpe Drift (display) = Sharpe Retention - 100; positive = improvement.
  if (patch.sharpeRetention != null && isFiniteNum(patch.sharpeRetention)) {
    const eff = 100 - patch.sharpeRetention;
    patch.efficiencyGain = roundTo(Math.max(-100, Math.min(100, eff)), 2);
    const drift = patch.sharpeRetention - 100;
    patch.sharpeDriftPct = roundTo(Math.max(-100, Math.min(100, drift)), 2);
  }

  // Max Tail-Risk: (OOS CVaR − IS CVaR) / |IS CVaR| × 100. Defined only when CVaR represents loss (negative). Guard: if IS CVaR >= 0 do not compute (data error; avoids inverted interpretation).
  const isCvar = cvar95(isReturns);
  const oosCvar = cvar95(oosReturns);
  if (isFiniteNum(isCvar) && isCvar >= 0) {
    // Do not set maxTailRiskReduction; treat as data error per spec.
  } else if (isFiniteNum(isCvar) && isCvar < 0 && isFiniteNum(oosCvar)) {
    const tailRedRaw = ((oosCvar - isCvar) / Math.abs(isCvar)) * 100;
    if (isFiniteNum(tailRedRaw))
      patch.maxTailRiskReduction = roundTo(Math.max(-100, Math.min(100, tailRedRaw)), 2);
  }

  return patch;
}

export interface DiagnosticsPatch {
  surfaceGini?: number;
  avgSafetyMarginPct?: number;
  oosVarianceAttribution?: { entry: number; exit: number } | null;
  maxCorrelation?: { pair: string; value: number };
  interdependencyRisk?: "Low" | "Moderate" | "High";
  /** Sensitivity-weighted coupling: high when two high-sensitivity params correlate strongly. */
  couplingRisk?: "Low" | "Moderate" | "High";
  couplingRiskPair?: string;
  deploymentStatus?: "APPROVED" | "APPROVED (Conditional)" | "REJECTED" | "HOLD";
  aggregateRiskScore?: number;
  /** Base Score = 100*(1 - maxSensitivity) before penalty; for UI breakdown (Problem 0.39). */
  riskScoreBase?: number;
  /** Penalty = 2×needsTuningCount + 5×fragileCount (before ceiling); for UI breakdown. */
  riskScorePenalty?: number;
  /** Governance Impact (from WFA IS/OOS returns only). Host pipeline only. */
  sharpeRetention?: number;
  performanceDecayPct?: number;
  signalAttenuation?: number;
  efficiencyGain?: number;
  /** Sharpe Drift = Sharpe Retention - 100. Positive = improvement (OOS > IS). Use for "Sharpe Drift (OOS vs IS)" display. */
  sharpeDriftPct?: number;
  maxTailRiskReduction?: number;
}

/**
 * Audit Verdict from parameter sensitivities. Differentiated penalty + ceiling.
 * Spec: Base = 100*(1−maxSensitivity). Penalty = 2 per Needs Tuning [0.40, 0.60) + 5 per Fragile >=0.60. Raw = Base − Penalty. Ceiling = 100 − 5×penalisedCount. Final = max(0, floor(min(Raw, ceiling))).
 * 50 <= score < 65 → APPROVED (Conditional); score >= 65 → APPROVED.
 */
export function computeAuditVerdictFromParameters(
  parameters: Array<{ sensitivity: number }>
): {
  aggregateRiskScore: number;
  deploymentStatus: "APPROVED" | "APPROVED (Conditional)" | "REJECTED";
  riskScoreBase?: number;
  riskScorePenalty?: number;
} {
  if (!parameters?.length) {
    return { aggregateRiskScore: 0, deploymentStatus: "REJECTED" };
  }
  const rounded = (s: number) => roundTo(Number.isFinite(s) ? s : 0, SENSITIVITY_PRECISION);
  const maxSens = Math.max(...parameters.map((p) => rounded(p.sensitivity)));
  const needsTuningCount = parameters.filter((p) => {
    const r = rounded(p.sensitivity);
    return r >= PENALTY_THRESHOLD && r < NEEDS_TUNING_MAX;
  }).length;
  const fragileCount = parameters.filter((p) => rounded(p.sensitivity) >= NEEDS_TUNING_MAX).length;
  const penalisedCount = needsTuningCount + fragileCount;
  const riskScoreBase = Math.round(100 * (1 - maxSens));
  const riskScorePenalty = needsTuningCount * NEEDS_TUNING_PENALTY + fragileCount * FRAGILE_PENALTY;
  let score = riskScoreBase - riskScorePenalty;
  const ceiling = Math.max(0, 100 - RISK_SCORE_CEILING_PER_PENALISED * penalisedCount);
  score = Math.min(score, ceiling);
  score = Math.max(0, Math.floor(score));
  const deploymentStatus =
    score < RISK_SCORE_PASS_THRESHOLD
      ? "REJECTED"
      : score >= RISK_CLASS_THRESHOLDS.LOW
        ? "APPROVED"
        : "APPROVED (Conditional)";
  return {
    aggregateRiskScore: score,
    deploymentStatus,
    riskScoreBase,
    riskScorePenalty,
  };
}

/**
 * Build diagnostics that require multiple data points (from WFA periods).
 * Merges into existing diagnostics; only sets keys that are missing or NaN.
 */
export function buildDiagnosticsFromWfa(
  wfa: WfaDiagnosticsLike | null | undefined,
  robustnessScore: RobustnessLike | null | undefined
): DiagnosticsPatch {
  const out: DiagnosticsPatch = {};

  const periods = Array.isArray(wfa?.periods)
    ? wfa.periods
    : Array.isArray(wfa?.windows)
      ? wfa.windows
      : [];
  const dataPoints = periods
    .map((p) => {
      const raw = p as Record<string, unknown>;
      const params =
        normalizeParams((raw.parameters ?? raw.params) as Record<string, unknown>) ??
        (raw.parameters ?? raw.params);
      let opt =
        (raw.optimizationReturn as number | undefined) ??
        (raw.optimization_return as number | undefined);
      let val =
        (raw.validationReturn as number | undefined) ??
        (raw.validation_return as number | undefined);
      const m = raw.metrics as Record<string, Record<string, unknown>> | undefined;
      if (opt == null && m?.optimization) opt = (m.optimization.totalReturn ?? m.optimization.total) as number | undefined;
      if (val == null && m?.validation) val = (m.validation.totalReturn ?? m.validation.total) as number | undefined;
      const score = toNum(val);
      if (!Number.isFinite(score)) return null;
      return {
        parameters: normalizeParams(params as Record<string, unknown>),
        score: toDecimalReturn(val),
      };
    })
    .filter((x): x is { parameters: Record<string, number>; score: number } => x != null && Number.isFinite(x.score));

  const verdict = (wfa as WfaDiagnosticsLike | undefined)?.verdict?.toUpperCase();
  const overall = robustnessScore?.overall;
  if (typeof overall === "number" && Number.isFinite(overall)) {
    if (overall >= 60 && verdict === "PASS") out.deploymentStatus = "APPROVED";
    else if (overall >= 50 && verdict === "PASS") out.deploymentStatus = "APPROVED (Conditional)";
    else if (overall < 40 || verdict === "FAIL") out.deploymentStatus = "REJECTED";
    else out.deploymentStatus = "HOLD";
  } else if (verdict === "PASS") out.deploymentStatus = "HOLD";
  else if (verdict === "FAIL") out.deploymentStatus = "REJECTED";

  if (dataPoints.length < 3) return out;

  const paramNames = new Set<string>();
  for (const pt of dataPoints) {
    for (const k of Object.keys(pt.parameters)) paramNames.add(k);
  }
  const scores = dataPoints.map((p) => p.score);

  const paramStats = new Map<
    string,
    { min: number; max: number; values: number[] }
  >();
  for (const name of paramNames) {
    const values = dataPoints.map((p) => p.parameters[name]).filter(Number.isFinite) as number[];
    if (values.length < 3) continue;
    paramStats.set(name, {
      min: Math.min(...values),
      max: Math.max(...values),
      values,
    });
  }

  const sensitivityByParam = new Map<string, number>();
  const sensitivities: number[] = [];
  for (const name of paramNames) {
    const vals = dataPoints.map((p) => (p.parameters[name] as number) ?? NaN).filter(Number.isFinite);
    if (vals.length < 3) continue;
    const corr = calculateCorrelation(vals, scores.slice(0, vals.length));
    const sens = Math.min(1, Math.max(0, Math.abs(corr)));
    sensitivityByParam.set(name, sens);
    sensitivities.push(sens);
  }
  if (sensitivities.length >= 2) {
    const g = gini(sensitivities);
    if (Number.isFinite(g)) out.surfaceGini = roundTo(g, 2);
  }

  const margins: number[] = [];
  paramStats.forEach((stats) => {
    const { min, max } = stats;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    const mid = (max + min) / 2;
    if (!Number.isFinite(mid) || mid === 0) return;
    const halfRange = Math.abs(max - min) / 2;
    margins.push((halfRange / Math.abs(mid)) * 100);
  });
  if (margins.length > 0) {
    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
    if (Number.isFinite(avg)) out.avgSafetyMarginPct = roundTo(avg, 1);
  }

  const keys = Array.from(paramStats.keys());
  let bestPair: string | null = null;
  let bestValue = 0;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const keyA = keys[i];
      const keyB = keys[j];
      const valsA = (paramStats.get(keyA)?.values ?? []) as number[];
      const valsB = (paramStats.get(keyB)?.values ?? []) as number[];
      if (valsA.length < 3 || valsB.length < 3) continue;
      const len = Math.min(valsA.length, valsB.length);
      const corr = calculateCorrelation(valsA.slice(0, len), valsB.slice(0, len));
      if (Number.isFinite(corr) && Math.abs(corr) > Math.abs(bestValue)) {
        bestValue = corr;
        bestPair = `${formatParamName(keyA)} <-> ${formatParamName(keyB)}`;
      }
    }
  }
  if (bestPair != null && Number.isFinite(bestValue)) {
    out.maxCorrelation = { pair: bestPair, value: roundTo(bestValue, 2) };
    const absVal = Math.abs(bestValue);
    if (absVal >= 0.7) out.interdependencyRisk = "High";
    else if (absVal >= 0.5) out.interdependencyRisk = "Moderate";
    else out.interdependencyRisk = "Low";
  }

  const COUPLING_SENS_THRESHOLD = 0.3;
  const COUPLING_CORR_HIGH = 0.7;
  const COUPLING_CORR_MODERATE = 0.5;
  let couplingAbsMax = 0;
  let couplingPair: string | null = null;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const sensA = sensitivityByParam.get(keys[i]) ?? 0;
      const sensB = sensitivityByParam.get(keys[j]) ?? 0;
      if (sensA < COUPLING_SENS_THRESHOLD || sensB < COUPLING_SENS_THRESHOLD) continue;
      const valsA = (paramStats.get(keys[i])?.values ?? []) as number[];
      const valsB = (paramStats.get(keys[j])?.values ?? []) as number[];
      if (valsA.length < 3 || valsB.length < 3) continue;
      const len = Math.min(valsA.length, valsB.length);
      const corr = calculateCorrelation(valsA.slice(0, len), valsB.slice(0, len));
      if (Number.isFinite(corr) && Math.abs(corr) > couplingAbsMax) {
        couplingAbsMax = Math.abs(corr);
        couplingPair = `${formatParamName(keys[i])} <-> ${formatParamName(keys[j])}`;
      }
    }
  }
  if (couplingPair != null && couplingAbsMax >= COUPLING_CORR_MODERATE) {
    out.couplingRiskPair = couplingPair;
    if (couplingAbsMax >= COUPLING_CORR_HIGH) out.couplingRisk = "High";
    else out.couplingRisk = "Moderate";
  } else if (keys.length >= 2) {
    out.couplingRisk = "Low";
  }

  const entryKeywords = ["buy", "entry", "signal", "threshold", "rsi", "ema", "long"];
  const exitKeywords = ["sell", "exit", "stoploss", "roi", "trailing"];
  let entrySum = 0;
  let exitSum = 0;
  for (const name of paramNames) {
    const lower = name.toLowerCase();
    const isEntry = entryKeywords.some((k) => lower.includes(k));
    const isExit = exitKeywords.some((k) => lower.includes(k));
    const sens = sensitivityByParam.get(name) ?? 0;
    if (isEntry && !isExit) entrySum += sens;
    else if (isExit && !isEntry) exitSum += sens;
  }
  const total = entrySum + exitSum;
  if (total > 0) {
    const entryPct = Math.round((entrySum / total) * 100);
    out.oosVarianceAttribution = { entry: entryPct, exit: 100 - entryPct };
  } else if (paramNames.size > 0) {
    out.oosVarianceAttribution = { entry: 50, exit: 50 };
  }

  const governance = buildGovernanceImpactFromPeriods(periods as Array<Record<string, unknown>>);
  if (governance.sharpeRetention != null) out.sharpeRetention = governance.sharpeRetention;
  if (governance.performanceDecayPct != null) out.performanceDecayPct = governance.performanceDecayPct;
  if (governance.signalAttenuation != null) out.signalAttenuation = governance.signalAttenuation;
  if (governance.efficiencyGain != null) out.efficiencyGain = governance.efficiencyGain;
  if (governance.sharpeDriftPct != null) out.sharpeDriftPct = governance.sharpeDriftPct;
  if (governance.maxTailRiskReduction != null) out.maxTailRiskReduction = governance.maxTailRiskReduction;

  // Performance Decay >= 80% means near-complete loss of edge IS->OOS; do not allow APPROVED.
  if (
    out.performanceDecayPct != null &&
    out.performanceDecayPct >= 80 &&
    (out.deploymentStatus === "APPROVED" || out.deploymentStatus === "APPROVED (Conditional)")
  ) {
    out.deploymentStatus = "REJECTED";
  }

  // Optional: REJECT when Sharpe Retention exceeds threshold (e.g. 200% = very high OOS vs IS; set to null to disable).
  const SHARPE_RETENTION_REJECT_THRESHOLD_PCT: number | null = null;
  if (
    SHARPE_RETENTION_REJECT_THRESHOLD_PCT != null &&
    out.sharpeRetention != null &&
    out.sharpeRetention >= SHARPE_RETENTION_REJECT_THRESHOLD_PCT &&
    (out.deploymentStatus === "APPROVED" || out.deploymentStatus === "APPROVED (Conditional)")
  ) {
    out.deploymentStatus = "REJECTED";
  }

  return out;
}
