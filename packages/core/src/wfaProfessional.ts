/**
 * Professional WFA: 7 blocks (equity curve, WFE advanced, parameter stability,
 * regime, Monte Carlo, stress, institutional grade). Computed at submit when
 * payload has walkForwardAnalysis.periods (and optionally performanceTransfer).
 * See docs/PLAN_WFA_PROFESSIONAL_IMPLEMENTATION.md.
 */

import { toDecimalReturn } from "./normalize";
import type {
  InstitutionalGradeOverride,
  WfaProfessionalInput,
  WFEResult,
} from "@kiploks/engine-contracts";
import {
  FORMULA_VERSION,
  KiploksValidationError,
  WFE_PERMUTATION_P_WEAK_THRESHOLD,
} from "@kiploks/engine-contracts";
import { buildWfeResult } from "./wfa/wfeCalculator";
import {
  buildWfaFailedWindowsFromPeriods,
  computeWfaVerdict,
} from "./wfaStandaloneTransform";

const BOOTSTRAP_ITERATIONS = 1000;
const Z_SCORE_THRESHOLD = 2.0;
const MIN_CURVE_POINTS = 5;
const CHUNKS_COUNT = 4;
const DRIFT_STABLE_PCT = 10;
const DRIFT_ADAPTIVE_PCT = 30;
const PRO_WFA_VERSION = "pro-wfa-v1";

/** Max failed-window share before institutional grade is capped at BBB (submit-time guard). */
export const WFA_FAILURE_RATE_INSTITUTIONAL_CAP_THRESHOLD = 0.3;

function institutionalGradeCapPvalueReason(): string {
  return `WFE permutation p-value is >= ${WFE_PERMUTATION_P_WEAK_THRESHOLD.toFixed(2)}; institutional grade capped at A - ACCEPTABLE.`;
}

function institutionalGradeWeakPvalueBbbReason(): string {
  return `WFE permutation p-value is >= ${WFE_PERMUTATION_P_WEAK_THRESHOLD.toFixed(2)}; weak statistical significance for rank WFE (grade remains BBB - RESEARCH ONLY).`;
}

export interface NormalizedPeriod {
  optimizationReturn: number;
  validationReturn: number;
  parameters: Record<string, number>;
  validationMaxDD?: number;
}

export type ValidationResult =
  | {
      ok: true;
      normalizedPeriods: NormalizedPeriod[];
      normalizedCurves?: Array<{ date: string; value: number }[]>;
    }
  | {
      ok: false;
      errors: string[];
      stopperIds?: string[];
    };

export interface EquityCurveAnalysis {
  available: boolean;
  chunkStats?: Array<{ return: number; volatility: number; maxDrawdown: number }>;
  trendConsistency?: "HIGH" | "MEDIUM" | "LOW";
  overallTrend?: "UP" | "FLAT" | "DOWN";
  volatilityProgression?: number[];
  verdict?: "STRONG" | "ACCEPTABLE" | "WEAK";
}

export interface ParameterStability {
  available: boolean;
  parameterDrift?: Record<string, { mean: number; std: number; driftPct: number; stability: "STABLE" | "ADAPTIVE" | "FRAGILE" }>;
  fragileParameters?: string[];
  overallStability?: "ROBUST" | "ACCEPTABLE" | "FRAGILE";
  stabilityScore?: number | null;
}

export interface RegimeAnalysis {
  regimeChanges: Array<{ windowIndex: number; periodNumber: number; value: number; zScore: number; reason: string }>;
  hasOutliers: boolean;
  distributionShape?: "NORMAL" | "SKEWED_RIGHT" | "SKEWED_LEFT" | "HEAVY_TAILS";
  skewness?: number;
  kurtosis?: number;
  verdict?: "STABLE" | "REGIME_SHIFT" | "OUTLIER_DETECTED";
}

export interface MonteCarloValidation {
  actualMeanReturn: number;
  confidenceInterval95: [number, number];
  confidenceInterval68: [number, number];
  probabilityPositive: number;
  verdict: "CONFIDENT" | "PROBABLE" | "UNCERTAIN" | "DOUBTFUL";
}

export interface StressTest {
  worstCaseReturn: number;
  worstCaseWindow: number;
  worstCaseDD: number | null;
  worstCaseDDIsEstimate?: boolean;
  volatilitySpike?: { degradationPct: number; impact: "Minimal" | "Moderate" | "Significant" };
  recoveryCapability?: "HIGH" | "MODERATE" | "LOW" | "N/A";
  verdict?: "RESILIENT" | "ACCEPTABLE" | "FRAGILE";
}

export type InstitutionalGrade =
  | "AAA - INSTITUTIONAL GRADE"
  | "AA - PROFESSIONAL"
  | "A - ACCEPTABLE"
  | "BBB - RESEARCH ONLY";

export interface ProfessionalWfa {
  equityCurveAnalysis?: EquityCurveAnalysis;
  wfeAdvanced?: WFEResult;
  parameterStability?: ParameterStability;
  regimeAnalysis?: RegimeAnalysis;
  monteCarloValidation?: MonteCarloValidation;
  stressTest?: StressTest;
  institutionalGrade?: InstitutionalGrade;
  /**
   * Machine-readable override (single active reason; strongest guard wins at submit time).
   */
  institutionalGradeOverride?: InstitutionalGradeOverride;
  /**
   * Same as `institutionalGradeOverride.reason` for backward compatibility and simple renderers.
   */
  institutionalGradeOverrideReason?: string;
  recommendation?: string;
}

export interface ProfessionalMeta {
  version: string;
  /** Matches `FORMULA_VERSION` from engine-contracts when this block was built. */
  engineFormulaVersion: string;
  inputsSummary: {
    periodCount: number;
    hasPerformanceTransfer: boolean;
    hasValidationMaxDD: boolean;
    curvePointCount?: number;
  };
  guardsTriggered: string[];
  approximationsUsed: string[];
}

function getPeriodReturns(p: Record<string, unknown>): { validationReturn: number; optimizationReturn: number } {
  const metrics = p.metrics as Record<string, unknown> | undefined;
  const rawVal =
    p.validationReturn ??
    p.validation_return ??
    (metrics?.validation as Record<string, unknown>)?.totalReturn ??
    (metrics?.validation as Record<string, unknown>)?.total;
  const rawOpt =
    p.optimizationReturn ??
    p.optimization_return ??
    (metrics?.optimization as Record<string, unknown>)?.totalReturn ??
    (metrics?.optimization as Record<string, unknown>)?.total;
  return {
    validationReturn: toDecimalReturn(rawVal),
    optimizationReturn: toDecimalReturn(rawOpt),
  };
}

function getParametersAsNumbers(p: Record<string, unknown> | undefined): Record<string, number> {
  if (!p || typeof p !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(p)) {
    const n = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function toBalance(point: unknown): number | null {
  if (point == null) return null;
  if (typeof point === "number" && Number.isFinite(point)) return point;
  const p = point as Record<string, unknown>;
  const b = p?.balance ?? p?.value ?? p?.equity;
  return typeof b === "number" && Number.isFinite(b) ? b : null;
}

function toDate(point: unknown): string {
  if (point == null) return "";
  const p = point as Record<string, unknown>;
  const d = p?.date ?? p?.timestamp ?? p?.t;
  return typeof d === "string" ? d : typeof d === "number" ? String(d) : "";
}

/**
 * Validate and normalize WFA input. Returns normalized periods and optional curves.
 * S1: decimal returns; S2: periods.length >= 2; S5: sort curve by date.
 */
export function validateAndNormalizeWfaInput(wfa: WfaProfessionalInput | null | undefined): ValidationResult {
  const periods = Array.isArray(wfa?.periods)
    ? (wfa.periods as unknown as Record<string, unknown>[])
    : Array.isArray(wfa?.windows)
      ? (wfa.windows as unknown as Record<string, unknown>[])
      : [];

  if (periods.length < 2) {
    return {
      ok: false,
      errors: ["Professional WFA requires at least 2 periods"],
      stopperIds: ["S2"],
    };
  }

  const normalizedPeriods: NormalizedPeriod[] = periods.map((p) => {
    const { validationReturn, optimizationReturn } = getPeriodReturns(p);
    const params = getParametersAsNumbers(
      (p.parameters ?? p.params ?? p.optimization_params ?? p.optimized_params ?? {}) as Record<string, unknown>,
    );
    const validationMaxDD =
      typeof (p as Record<string, unknown>).validationMaxDD === "number" &&
      Number.isFinite((p as Record<string, unknown>).validationMaxDD)
        ? toDecimalReturn((p as Record<string, unknown>).validationMaxDD)
        : undefined;
    return {
      optimizationReturn,
      validationReturn,
      parameters: params,
      validationMaxDD,
    };
  });

  let normalizedCurves: Array<{ date: string; value: number }[]> | undefined;
  const pt = wfa?.performanceTransfer as { windows?: unknown[] } | undefined;
  if (pt?.windows && Array.isArray(pt.windows) && pt.windows.length > 0) {
    const curves: Array<{ date: string; value: number }[]> = [];
    for (const win of pt.windows as Record<string, unknown>[]) {
      const rawCurve = win.oosEquityCurve ?? win.equityCurve ?? win.curve;
      if (!Array.isArray(rawCurve)) continue;
      const points = rawCurve
        .map((pt: unknown) => {
          const date = toDate(pt);
          const value = toBalance(pt);
          return date && value !== null ? { date, value } : null;
        })
        .filter((x: unknown): x is { date: string; value: number } => x != null);
      points.sort((a, b) => a.date.localeCompare(b.date));
      if (points.length > 0) curves.push(points);
    }
    if (curves.length > 0) normalizedCurves = curves;
  }

  return {
    ok: true,
    normalizedPeriods,
    normalizedCurves,
  };
}

/** Build OOS curve: from performanceTransfer (stitched, sorted by date) or synthetic from periods. */
function buildOosCurve(
  normalizedPeriods: NormalizedPeriod[],
  normalizedCurves?: Array<{ date: string; value: number }[]>,
): { points: Array<{ date: string; value: number }>; synthetic: boolean } {
  if (normalizedCurves && normalizedCurves.length > 0) {
    const all: Array<{ date: string; value: number }> = [];
    for (const curve of normalizedCurves) {
      for (const p of curve) all.push(p);
    }
    all.sort((a, b) => a.date.localeCompare(b.date));
    return { points: all, synthetic: false };
  }

  let equity = 1;
  const points: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < normalizedPeriods.length; i++) {
    points.push({ date: `period-${i}`, value: equity });
    const r = normalizedPeriods[i].validationReturn;
    if (Number.isFinite(r)) equity = equity * (1 + r);
  }
  points.push({ date: `period-${normalizedPeriods.length}`, value: equity });
  return { points, synthetic: true };
}

function buildEquityCurveAnalysis(
  normalizedPeriods: NormalizedPeriod[],
  normalizedCurves?: Array<{ date: string; value: number }[]>,
  meta: { guardsTriggered: string[]; approximationsUsed: string[] } = { guardsTriggered: [], approximationsUsed: [] },
): EquityCurveAnalysis {
  const { points, synthetic } = buildOosCurve(normalizedPeriods, normalizedCurves);
  if (synthetic) meta.approximationsUsed.push("Equity curve from window returns only (synthetic)");
  if (points.length < MIN_CURVE_POINTS) {
    return { available: false };
  }
  const chunkSize = Math.max(1, Math.floor(points.length / CHUNKS_COUNT));
  const chunkReturns: number[] = [];
  const chunkVolatilities: number[] = [];
  const chunkDDs: number[] = [];

  for (let c = 0; c < CHUNKS_COUNT; c++) {
    const start = c * chunkSize;
    const end = c === CHUNKS_COUNT - 1 ? points.length : (c + 1) * chunkSize;
    if (end - start < 2) continue;
    const chunkPoints = points.slice(start, end);
    const startVal = chunkPoints[0].value;
    const endVal = chunkPoints[chunkPoints.length - 1].value;
    const ret = startVal !== 0 ? (endVal - startVal) / startVal : 0;
    chunkReturns.push(ret);

    const periodRets: number[] = [];
    for (let i = 1; i < chunkPoints.length; i++) {
      const v0 = chunkPoints[i - 1].value;
      const v1 = chunkPoints[i].value;
      if (v0 !== 0) periodRets.push((v1 - v0) / v0);
    }
    const vol =
      periodRets.length > 1
        ? Math.sqrt(
            periodRets.reduce(
              (s, r) => s + (r - periodRets.reduce((a, b) => a + b, 0) / periodRets.length) ** 2,
              0,
            ) / periodRets.length,
          )
        : 0;
    chunkVolatilities.push(vol);

    let peak = chunkPoints[0].value;
    let maxDD = 0;
    for (const p of chunkPoints) {
      if (p.value > peak) peak = p.value;
      const dd = peak > 0 ? (peak - p.value) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }
    chunkDDs.push(maxDD);
  }

  if (chunkReturns.length < 2) return { available: false };

  const meanReturn = chunkReturns.reduce((a, b) => a + b, 0) / chunkReturns.length;
  const stdReturn =
    chunkReturns.length > 1
      ? Math.sqrt(chunkReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / chunkReturns.length)
      : 0;

  const slope =
    chunkReturns.length >= 2
      ? (chunkReturns.reduce((s, r, i) => s + r * i, 0) -
          (chunkReturns.reduce((a, b) => a + b, 0) * (chunkReturns.length - 1)) / 2) /
        ((chunkReturns.length * (chunkReturns.length - 1)) / 2)
      : 0;

  const overallTrend: "UP" | "FLAT" | "DOWN" = Math.abs(slope) < 0.001 ? "FLAT" : slope > 0 ? "UP" : "DOWN";
  const cvReturn = Math.abs(meanReturn) > 1e-9 ? stdReturn / Math.abs(meanReturn) : 0;

  const meanVol = chunkVolatilities.reduce((a, b) => a + b, 0) / chunkVolatilities.length;
  const stdVol =
    chunkVolatilities.length > 1
      ? Math.sqrt(chunkVolatilities.reduce((s, v) => s + (v - meanVol) ** 2, 0) / chunkVolatilities.length)
      : 0;

  const cvVol = meanVol > 1e-9 ? stdVol / meanVol : 0;

  const trendConsistency: "HIGH" | "MEDIUM" | "LOW" = cvReturn < 0.5 ? "HIGH" : cvReturn < 1.5 ? "MEDIUM" : "LOW";

  // Preserve original behavior: volatilityConsistent exists but only affects verdict indirectly.
  const volatilityConsistent = cvVol < 0.5;
  void volatilityConsistent;

  let verdict: "STRONG" | "ACCEPTABLE" | "WEAK" = "WEAK";
  if (overallTrend === "DOWN" || trendConsistency === "LOW") verdict = "WEAK";
  else if (overallTrend === "UP" && trendConsistency === "HIGH") verdict = "STRONG";
  else if (overallTrend === "FLAT" && trendConsistency === "MEDIUM") verdict = "ACCEPTABLE";
  else verdict = "ACCEPTABLE";

  return {
    available: true,
    chunkStats: chunkReturns.map((r, i) => ({
      return: r,
      volatility: chunkVolatilities[i] ?? 0,
      maxDrawdown: chunkDDs[i] ?? 0,
    })),
    trendConsistency,
    overallTrend,
    volatilityProgression: chunkVolatilities,
    verdict,
  };
}

function alignedReturnsForRankWfe(periods: NormalizedPeriod[]): { is: number[]; oos: number[] } {
  const is: number[] = [];
  const oos: number[] = [];
  for (const p of periods) {
    if (Number.isFinite(p.optimizationReturn) && Number.isFinite(p.validationReturn)) {
      is.push(p.optimizationReturn);
      oos.push(p.validationReturn);
    }
  }
  if (is.length < 2) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      "Rank WFE requires at least 2 windows with finite optimizationReturn and validationReturn.",
    );
  }
  return { is, oos };
}

function buildParameterStability(normalizedPeriods: NormalizedPeriod[]): ParameterStability {
  const allKeys = new Set<string>();
  for (const p of normalizedPeriods) {
    for (const k of Object.keys(p.parameters)) allKeys.add(k);
  }
  if (allKeys.size === 0) return { available: false };

  const parameterDrift: ParameterStability["parameterDrift"] = {};
  for (const key of allKeys) {
    const values: number[] = [];
    for (const p of normalizedPeriods) {
      const v = p.parameters[key];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    if (values.length < 2) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const range = Math.max(...values) - Math.min(...values);
    const denom = Math.abs(mean) < 0.001 ? range || 0.001 : Math.abs(mean);
    const driftPct = (std / denom) * 100;

    const stability: "STABLE" | "ADAPTIVE" | "FRAGILE" =
      driftPct < DRIFT_STABLE_PCT ? "STABLE" : driftPct < DRIFT_ADAPTIVE_PCT ? "ADAPTIVE" : "FRAGILE";

    parameterDrift[key] = { mean, std, driftPct, stability };
  }

  const fragileParameters = Object.entries(parameterDrift ?? {})
    .filter(([, v]) => v.stability === "FRAGILE")
    .map(([k]) => k);

  const totalParams = Object.keys(parameterDrift ?? {}).length;
  const fragileRatio = totalParams > 0 ? fragileParameters.length / totalParams : 0;

  const overallStability: ParameterStability["overallStability"] =
    fragileRatio === 0 ? "ROBUST" : fragileRatio < 0.3 ? "ACCEPTABLE" : "FRAGILE";

  const stabilityScore = totalParams > 0 ? (1 - fragileRatio) * 100 : null;

  return {
    available: true,
    parameterDrift,
    fragileParameters: fragileParameters.length > 0 ? fragileParameters : undefined,
    overallStability,
    stabilityScore: stabilityScore != null ? Math.round(stabilityScore * 10) / 10 : null,
  };
}

function buildRegimeAnalysis(normalizedPeriods: NormalizedPeriod[]): RegimeAnalysis {
  const oosReturns = normalizedPeriods.map((p) => p.validationReturn).filter(Number.isFinite);
  if (oosReturns.length < 2) return { regimeChanges: [], hasOutliers: false };

  const mean = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
  const variance = oosReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / oosReturns.length;
  const std = Math.sqrt(variance) || 1e-12;

  const regimeChanges: RegimeAnalysis["regimeChanges"] = [];
  for (let i = 0; i < oosReturns.length; i++) {
    const z = (oosReturns[i] - mean) / std;
    if (Math.abs(z) >= Z_SCORE_THRESHOLD) {
      regimeChanges.push({
        windowIndex: i,
        periodNumber: i + 1,
        value: oosReturns[i],
        zScore: Math.round(z * 100) / 100,
        reason: z > 0 ? "high return" : "low return",
      });
    }
  }

  const n = oosReturns.length;
  const m2 = variance;
  const m3 = oosReturns.reduce((s, r) => s + (r - mean) ** 3, 0) / n;
  const m4 = oosReturns.reduce((s, r) => s + (r - mean) ** 4, 0) / n;

  const skewness = m2 > 1e-20 ? m3 / Math.pow(m2, 1.5) : 0;
  const kurtosis = m2 > 1e-20 ? m4 / (m2 * m2) - 3 : 0;

  let distributionShape: RegimeAnalysis["distributionShape"] = "NORMAL";
  if (Math.abs(kurtosis) > 1) distributionShape = "HEAVY_TAILS";
  else if (skewness > 0.5) distributionShape = "SKEWED_RIGHT";
  else if (skewness < -0.5) distributionShape = "SKEWED_LEFT";

  let verdict: RegimeAnalysis["verdict"] = "STABLE";
  if (regimeChanges.length > 0) verdict = regimeChanges.some((r) => Math.abs(r.zScore) >= 2.5) ? "REGIME_SHIFT" : "OUTLIER_DETECTED";

  return {
    regimeChanges,
    hasOutliers: regimeChanges.length > 0,
    distributionShape,
    skewness: Math.round(skewness * 100) / 100,
    kurtosis: Math.round(kurtosis * 100) / 100,
    verdict,
  };
}

/** Seeded RNG for deterministic bootstrap in tests. */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t ^ (t >>> 15));
    return (t >>> 0) / 4294967296;
  };
}

function buildMonteCarloValidation(normalizedPeriods: NormalizedPeriod[], seed?: number): MonteCarloValidation {
  const oosReturns = normalizedPeriods.map((p) => p.validationReturn).filter(Number.isFinite);
  const actualMeanReturn = oosReturns.length > 0 ? oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length : 0;
  const rng = seed != null ? mulberry32(seed) : Math.random;
  const bootstrapMeans: number[] = [];
  const n = oosReturns.length;
  if (n === 0) {
    return {
      actualMeanReturn: 0,
      confidenceInterval95: [0, 0],
      confidenceInterval68: [0, 0],
      probabilityPositive: 0,
      verdict: "DOUBTFUL",
    };
  }

  for (let iter = 0; iter < BOOTSTRAP_ITERATIONS; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      sum += oosReturns[idx];
    }
    bootstrapMeans.push(sum / n);
  }

  bootstrapMeans.sort((a, b) => a - b);
  const ci95Low = bootstrapMeans[Math.floor(0.025 * bootstrapMeans.length)] ?? 0;
  const ci95High = bootstrapMeans[Math.floor(0.975 * bootstrapMeans.length)] ?? 0;
  const ci68Low = bootstrapMeans[Math.floor(0.16 * bootstrapMeans.length)] ?? 0;
  const ci68High = bootstrapMeans[Math.floor(0.84 * bootstrapMeans.length)] ?? 0;
  const probabilityPositive = bootstrapMeans.filter((m) => m > 0).length / bootstrapMeans.length;
  const zeroInCi = ci95Low <= 0 && ci95High >= 0;

  let verdict: MonteCarloValidation["verdict"] = "DOUBTFUL";
  if (probabilityPositive >= 0.8 && !zeroInCi && actualMeanReturn > 0) verdict = "CONFIDENT";
  else if (probabilityPositive >= 0.6 && actualMeanReturn > 0) verdict = "PROBABLE";
  else if (probabilityPositive >= 0.5) verdict = "UNCERTAIN";

  return {
    actualMeanReturn,
    confidenceInterval95: [ci95Low, ci95High],
    confidenceInterval68: [ci68Low, ci68High],
    probabilityPositive: Math.round(probabilityPositive * 1000) / 1000,
    verdict,
  };
}

function buildStressTest(
  normalizedPeriods: NormalizedPeriod[],
  normalizedCurves?: Array<{ date: string; value: number }[]>,
  meta: { approximationsUsed: string[] } = { approximationsUsed: [] },
): StressTest {
  const oosReturns = normalizedPeriods.map((p) => p.validationReturn).filter(Number.isFinite);
  if (oosReturns.length === 0) return { worstCaseReturn: 0, worstCaseWindow: 0, worstCaseDD: null };

  let worstIdx = 0;
  for (let i = 1; i < oosReturns.length; i++) {
    if (oosReturns[i] < oosReturns[worstIdx]) worstIdx = i;
  }

  const worstCaseReturn = oosReturns[worstIdx];
  const worstCaseWindow = worstIdx + 1;

  let worstCaseDD: number | null = null;
  let worstCaseDDIsEstimate = false;

  const periodDD = normalizedPeriods[worstIdx]?.validationMaxDD;
  if (typeof periodDD === "number" && Number.isFinite(periodDD)) {
    worstCaseDD = periodDD;
  } else if (normalizedCurves && normalizedCurves[worstIdx]) {
    const curve = normalizedCurves[worstIdx];
    let peak = curve[0]?.value ?? 0;
    let maxDD = 0;
    for (const p of curve) {
      if (p.value > peak) peak = p.value;
      const dd = peak > 0 ? (peak - p.value) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }
    worstCaseDD = maxDD;
  } else {
    worstCaseDD = 0.5 * Math.abs(worstCaseReturn);
    worstCaseDDIsEstimate = true;
    meta.approximationsUsed.push("stressTest.worstCaseDD from estimate");
  }

  const meanRet = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
  const variance =
    oosReturns.length > 1 ? oosReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / oosReturns.length : 0;

  const normalVol = Math.sqrt(variance);
  const spikeVol = normalVol * 2;

  const sharpeNormal = normalVol > 1e-12 ? meanRet / normalVol : 0;
  const sharpeSpike = spikeVol > 1e-12 ? meanRet / spikeVol : 0;

  const degradationPct =
    sharpeNormal !== 0 ? ((sharpeSpike - sharpeNormal) / Math.abs(sharpeNormal)) * 100 : 0;

  const impact =
    degradationPct < -30 ? "Significant" : degradationPct < -10 ? "Moderate" : "Minimal";

  let recoveryCapability: StressTest["recoveryCapability"] = "N/A";
  if (normalizedCurves && normalizedCurves.length > 0) {
    let recovered = 0;
    for (const curve of normalizedCurves) {
      if (curve.length < 2) continue;
      let peak = curve[0].value;
      let peakIdx = 0;
      for (let i = 1; i < curve.length; i++) {
        if (curve[i].value > peak) {
          peak = curve[i].value;
          peakIdx = i;
        }
      }
      const afterPeak = curve.slice(peakIdx);
      const recoveredToPeak = afterPeak.some((p) => p.value >= peak * 0.999);
      if (recoveredToPeak) recovered++;
    }
    const pct = normalizedCurves.length > 0 ? (recovered / normalizedCurves.length) * 100 : 0;
    recoveryCapability = pct >= 100 ? "HIGH" : pct >= 50 ? "MODERATE" : "LOW";
  }

  const verdict: StressTest["verdict"] =
    worstCaseDD != null && worstCaseDD < 0.1 && recoveryCapability !== "LOW"
      ? "RESILIENT"
      : worstCaseDD != null && worstCaseDD < 0.2
        ? "ACCEPTABLE"
        : "FRAGILE";

  return {
    worstCaseReturn,
    worstCaseWindow,
    worstCaseDD,
    worstCaseDDIsEstimate: worstCaseDDIsEstimate || undefined,
    volatilitySpike: { degradationPct: Math.round(degradationPct * 10) / 10, impact },
    recoveryCapability,
    verdict,
  };
}

function verdictToScore(
  equity: EquityCurveAnalysis["verdict"],
  wfeVerdict: WFEResult["verdict"],
  param: ParameterStability["overallStability"],
  regime: RegimeAnalysis["verdict"],
  monteCarlo: MonteCarloValidation["verdict"],
  stress: StressTest["verdict"],
): { equity: number; wfe: number; param: number; regime: number; monteCarlo: number; stress: number } {
  const eq = { STRONG: 90, ACCEPTABLE: 70, WEAK: 40 }[equity ?? "WEAK"] ?? 50;
  const wf = { ROBUST: 95, ACCEPTABLE: 75, WEAK: 45, FAIL: 10 }[wfeVerdict] ?? 50;
  const pr = { ROBUST: 90, ACCEPTABLE: 70, FRAGILE: 30 }[param ?? "FRAGILE"] ?? 50;
  const rg = { STABLE: 85, REGIME_SHIFT: 50, OUTLIER_DETECTED: 60 }[regime ?? "STABLE"] ?? 50;
  const mc = { CONFIDENT: 90, PROBABLE: 75, UNCERTAIN: 50, DOUBTFUL: 20 }[monteCarlo] ?? 50;
  const st = { RESILIENT: 85, ACCEPTABLE: 65, FRAGILE: 30 }[stress ?? "FRAGILE"] ?? 50;
  return { equity: eq, wfe: wf, param: pr, regime: rg, monteCarlo: mc, stress: st };
}

function buildInstitutionalGrade(
  equityCurveAnalysis: EquityCurveAnalysis,
  wfeResult: WFEResult,
  parameterStability: ParameterStability,
  regimeAnalysis: RegimeAnalysis,
  monteCarloValidation: MonteCarloValidation,
  stressTest: StressTest,
): {
  grade: InstitutionalGrade;
  recommendation: string;
  institutionalGradeOverride?: InstitutionalGradeOverride;
} {
  const scores = verdictToScore(
    equityCurveAnalysis.verdict,
    wfeResult.verdict,
    parameterStability.overallStability,
    regimeAnalysis.verdict,
    monteCarloValidation.verdict,
    stressTest.verdict,
  );
  const composite = scores.wfe * 0.35 + scores.monteCarlo * 0.25 + scores.equity * 0.15 + scores.param * 0.1 + scores.regime * 0.1 + scores.stress * 0.05;

  let grade: InstitutionalGrade = "BBB - RESEARCH ONLY";
  if (composite >= 85 && scores.wfe >= 85 && scores.monteCarlo >= 80) grade = "AAA - INSTITUTIONAL GRADE";
  else if (composite >= 75 && scores.wfe >= 75 && scores.monteCarlo >= 70) grade = "AA - PROFESSIONAL";
  else if (composite >= 60 && scores.wfe >= 60) grade = "A - ACCEPTABLE";

  let institutionalGradeOverride: InstitutionalGradeOverride | undefined;
  const p = wfeResult.permutationPValue;
  if (typeof p === "number" && Number.isFinite(p) && p >= WFE_PERMUTATION_P_WEAK_THRESHOLD) {
    if (grade === "AAA - INSTITUTIONAL GRADE" || grade === "AA - PROFESSIONAL") {
      grade = "A - ACCEPTABLE";
      institutionalGradeOverride = {
        code: "WEAK_STATISTICAL_SIGNIFICANCE",
        reason: institutionalGradeCapPvalueReason(),
        threshold: WFE_PERMUTATION_P_WEAK_THRESHOLD,
        actualPValue: p,
      };
    } else if (grade === "BBB - RESEARCH ONLY") {
      institutionalGradeOverride = {
        code: "WEAK_STATISTICAL_SIGNIFICANCE",
        reason: institutionalGradeWeakPvalueBbbReason(),
        threshold: WFE_PERMUTATION_P_WEAK_THRESHOLD,
        actualPValue: p,
      };
    }
  }

  const recommendation =
    grade === "AAA - INSTITUTIONAL GRADE"
      ? "Institutional and professional deployment acceptable with standard controls."
      : grade === "AA - PROFESSIONAL"
        ? "Professional and acceptable deployment with monitoring."
        : grade === "A - ACCEPTABLE"
          ? "Acceptable for controlled allocation with periodic re-validation."
          : "Research only. Do not deploy to production without further validation.";

  return { grade, recommendation, institutionalGradeOverride };
}

/**
 * Build full Professional WFA. Entry guard: periods.length >= 2.
 * Call after validation; uses normalized periods and optional curves.
 * seed: optional for bootstrap (tests); omit in production for reproducibility use hash or accept variance.
 */
export function buildProfessionalWfa(
  validation: ValidationResult,
  options?: { seed?: number; permutationN?: number },
): { professional: ProfessionalWfa; professionalMeta: ProfessionalMeta } | null {
  if (!validation.ok) return null;
  const { normalizedPeriods, normalizedCurves } = validation;

  const meta: ProfessionalMeta = {
    version: PRO_WFA_VERSION,
    engineFormulaVersion: FORMULA_VERSION,
    inputsSummary: {
      periodCount: normalizedPeriods.length,
      hasPerformanceTransfer: !!normalizedCurves && normalizedCurves.length > 0,
      hasValidationMaxDD: normalizedPeriods.some(
        (p) => p.validationMaxDD != null && Number.isFinite(p.validationMaxDD),
      ),
      curvePointCount: normalizedCurves?.reduce((s, c) => s + c.length, 0),
    },
    guardsTriggered: [],
    approximationsUsed: [],
  };

  const equityCurveAnalysis = buildEquityCurveAnalysis(normalizedPeriods, normalizedCurves, meta);
  const seedEff = options?.seed ?? 42;
  const { is, oos } = alignedReturnsForRankWfe(normalizedPeriods);
  const wfeAdvanced = buildWfeResult(is, oos, seedEff, options?.permutationN);
  const parameterStability = buildParameterStability(normalizedPeriods);
  const regimeAnalysis = buildRegimeAnalysis(normalizedPeriods);
  const monteCarloValidation = buildMonteCarloValidation(normalizedPeriods, seedEff);
  const stressTest = buildStressTest(normalizedPeriods, normalizedCurves, meta);
  const { grade, recommendation, institutionalGradeOverride } = buildInstitutionalGrade(
    equityCurveAnalysis,
    wfeAdvanced,
    parameterStability,
    regimeAnalysis,
    monteCarloValidation,
    stressTest,
  );

  const professional: ProfessionalWfa = {
    equityCurveAnalysis: equityCurveAnalysis.available ? equityCurveAnalysis : undefined,
    wfeAdvanced,
    parameterStability: parameterStability.available ? parameterStability : undefined,
    regimeAnalysis,
    monteCarloValidation,
    stressTest,
    institutionalGrade: grade,
    recommendation,
    ...(institutionalGradeOverride
      ? {
          institutionalGradeOverride,
          institutionalGradeOverrideReason: institutionalGradeOverride.reason,
        }
      : {}),
  };

  return { professional, professionalMeta: meta };
}

function consistencyFromPeriods(periods: Record<string, unknown>[]): number {
  const normalized = periods.map((p) => getPeriodReturns(p));
  const posIs = normalized.filter(
    (r) => Number.isFinite(r.optimizationReturn) && r.optimizationReturn > 0,
  );
  if (posIs.length === 0) return NaN;
  return posIs.filter((r) => r.validationReturn > 0).length / posIs.length;
}

/**
 * Aligns submit-time guard with product WFA: failed windows from periods when needed, verdict from payload or `computeWfaVerdict`.
 */
function resolveProfessionalFailureRateGuardContext(wfa: Record<string, unknown>): {
  failRate: number;
  verdictIsFail: boolean;
} {
  const periods = Array.isArray(wfa.periods) ? (wfa.periods as Record<string, unknown>[]) : [];
  let fw = wfa.failedWindows as { count?: number; total?: number } | undefined;
  if (periods.length > 0) {
    const b = buildWfaFailedWindowsFromPeriods(periods);
    fw = { count: b.count, total: b.total };
  }
  const total = fw?.total ?? 0;
  const count = fw?.count ?? 0;
  const failRate = total > 0 ? count / total : 0;

  let verdict: "PASS" | "FAIL" | undefined;
  if (periods.length > 0) {
    const wfe = typeof wfa.wfe === "number" && Number.isFinite(wfa.wfe) ? wfa.wfe : undefined;
    const consistency = consistencyFromPeriods(periods);
    const ofRaw = wfa.overfittingRisk as { score?: number } | undefined;
    const overfittingScore =
      typeof ofRaw?.score === "number" && Number.isFinite(ofRaw.score) ? ofRaw.score : NaN;
    const zombieCount = periods.filter(
      (p) => typeof p.oosTradesCount === "number" && p.oosTradesCount === 0,
    ).length;
    const logicParalysis =
      periods.length > 0 &&
      zombieCount > periods.length / 2 &&
      periods.some((p) => typeof p.oosTradesCount === "number");
    verdict = computeWfaVerdict({
      wfe,
      consistency: Number.isFinite(consistency) ? consistency : NaN,
      failedWindows: { count, total },
      overfittingScore: Number.isFinite(overfittingScore) ? overfittingScore : NaN,
      logicParalysis,
    }).verdict;
  } else if (wfa.verdict === "FAIL" || wfa.verdict === "PASS") {
    verdict = wfa.verdict;
  }

  return { failRate, verdictIsFail: verdict === "FAIL" };
}

function applyFailureRateInstitutionalGuard(
  professional: ProfessionalWfa,
  meta: ProfessionalMeta,
  wfa: Record<string, unknown>,
): { professional: ProfessionalWfa; professionalMeta: ProfessionalMeta } {
  const { failRate, verdictIsFail } = resolveProfessionalFailureRateGuardContext(wfa);

  if (
    !verdictIsFail ||
    failRate <= WFA_FAILURE_RATE_INSTITUTIONAL_CAP_THRESHOLD
  ) {
    return { professional, professionalMeta: meta };
  }

  const reason = `Verdict FAIL and failure rate > ${(WFA_FAILURE_RATE_INSTITUTIONAL_CAP_THRESHOLD * 100).toFixed(0)}%; grade capped to BBB - RESEARCH ONLY.`;
  const override: InstitutionalGradeOverride = {
    code: "FAIL_VERDICT_HIGH_FAILURE_RATE",
    reason,
    threshold: WFA_FAILURE_RATE_INSTITUTIONAL_CAP_THRESHOLD,
    actualFailureRate: Math.round(failRate * 1e6) / 1e6,
  };

  return {
    professional: {
      ...professional,
      institutionalGrade: "BBB - RESEARCH ONLY",
      recommendation:
        "Research only. Do not deploy to production without further validation.",
      institutionalGradeOverride: override,
      institutionalGradeOverrideReason: override.reason,
    },
    professionalMeta: {
      ...meta,
      guardsTriggered: [...meta.guardsTriggered, "FAIL_VERDICT_HIGH_FAILURE_RATE"],
    },
  };
}

/**
 * Top-level: validate input, then build Professional WFA.
 * Returns null when validation fails (e.g. < 2 periods).
 */
export function runProfessionalWfa(
  wfa: WfaProfessionalInput | null | undefined,
  options?: { seed?: number; permutationN?: number },
): { professional: ProfessionalWfa; professionalMeta: ProfessionalMeta } | null {
  const validation = validateAndNormalizeWfaInput(wfa);
  if (!validation.ok) return null;
  const built = buildProfessionalWfa(validation, options);
  if (!built) return null;
  return applyFailureRateInstitutionalGuard(
    built.professional,
    built.professionalMeta,
    (wfa ?? {}) as Record<string, unknown>,
  );
}

