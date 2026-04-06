/**
 * Compute Parameter Sensitivity from raw Hyperopt trials.
 * Sensitivity = R^2 (correlation^2) between parameter value and trial score; strength of linear
 * relationship (predictability). Values rounded to 2 decimals for consistency with Risk Score and UI.
 */

import { calculateCorrelation, roundTo } from "./financialMath";
import {
  STABLE_THRESHOLD,
  PENALTY_THRESHOLD,
  NEEDS_TUNING_MAX,
  SENSITIVITY_PRECISION,
} from "./parameterSensitivityContract";

/** Sensitivity and Risk Score use this precision; table and copy block match. Single source: parameterSensitivityContract. */
export const SENSITIVITY_DISPLAY_PRECISION = SENSITIVITY_PRECISION;

export interface HyperoptTrial {
  parameters: Record<string, number>;
  score: number;
}

const MAX_CURVE_POINTS = 20;

export type ParameterDisplayTone = "green" | "yellow" | "red";

/** Maps sensitivity (0-1) to display label and tone for UI. Bands: Stable [0, 0.30), Reliable [0.30, 0.40), Needs Tuning [0.40, 0.60), Fragile >= 0.60. */
export function getParameterDisplayLabelAndTone(sensitivity: number): {
  displayLabel: string;
  tone: ParameterDisplayTone;
} {
  if (sensitivity < STABLE_THRESHOLD) {
    return { displayLabel: "Stable", tone: "green" };
  }
  if (sensitivity < PENALTY_THRESHOLD) {
    return { displayLabel: "Reliable", tone: "green" };
  }
  if (sensitivity < NEEDS_TUNING_MAX) {
    return { displayLabel: "Needs Tuning", tone: "yellow" };
  }
  return { displayLabel: "Fragile", tone: "red" };
}

export interface ParameterSensitivityParameter {
  name: string;
  sensitivity: number;
  bestValue: number;
  worstValue: number;
  impact: "high" | "medium" | "low";
  overfittingRisk: boolean;
  /** Per-parameter (value, score) for Surface Topology sparkline. Sorted by value; downsampled to MAX_CURVE_POINTS. */
  curvePoints?: Array<{ value: number; score: number }>;
  /** Ready-made label for UI (e.g. Stable, Fragile). Host-computed. */
  displayLabel?: string;
  /** CSS tone: green | yellow | red. Host-computed. */
  tone?: ParameterDisplayTone;
  /** Optional governance note (e.g. Time-decay enforced). Host-computed from param name + sensitivity. */
  governanceNote?: string;
}

export interface ParameterSensitivityResult {
  parameters: ParameterSensitivityParameter[];
}

const MIN_TRIALS = 3;
const MAX_TRIALS = 50_000;

/** WFA-like: has periods or windows with optional parameters and validationReturn. */
export interface WfaLike {
  periods?: Array<{
    parameters?: Record<string, unknown>;
    validationReturn?: number;
    optimizationReturn?: number;
  }>;
  windows?: Array<{
    parameters?: Record<string, unknown>;
    validationReturn?: number;
    optimizationReturn?: number;
  }>;
}

function isNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v);
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Build synthetic trials from WFA periods/windows (one point per period).
 * Used when payload has no hyperoptTrials but has WFA with >= 3 periods.
 */
export function buildTrialsFromWfa(
  wfa: WfaLike | null | undefined
): HyperoptTrial[] {
  const periods = Array.isArray(wfa?.periods)
    ? wfa.periods
    : Array.isArray(wfa?.windows)
      ? wfa.windows
      : [];
  if (periods.length < MIN_TRIALS) return [];

  const normalizeParams = (p: Record<string, unknown> | undefined): Record<string, number> => {
    if (!p || typeof p !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(p)) {
      const n = toNum(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return out;
  };

  const firstParams = normalizeParams(periods[0]?.parameters as Record<string, unknown> | undefined);
  return periods.map((period) => {
    const params = normalizeParams(period?.parameters as Record<string, unknown> | undefined);
    const score = toNum(period?.validationReturn ?? period?.optimizationReturn);
    return {
      parameters: Object.keys(params).length > 0 ? params : firstParams,
      score: Number.isFinite(score) ? score : 0,
    };
  });
}

function formatParamName(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim() || key;
}

/** Governance note from parameter name and sensitivity (e.g. Time-decay enforced, Liquidity Gated). */
function getGovernanceNote(paramName: string, sensitivity: number): string | undefined {
  const lower = (paramName || "").toLowerCase();
  if (sensitivity < 0.2) return undefined;
  if (lower.includes("time") || lower.includes("lifetime")) {
    return "Time-decay enforced";
  }
  if (lower.includes("volume") || lower.includes("liquidity")) {
    return "Liquidity Gated";
  }
  return undefined;
}

/**
 * Compute ParameterSensitivity from array of trials (same contract as integration hyperoptTrials).
 * Returns null if trials.length < 3 or no numeric parameters.
 */
export function computeParameterSensitivityFromTrials(
  trials: unknown[]
): ParameterSensitivityResult | null {
  if (!Array.isArray(trials) || trials.length < MIN_TRIALS) {
    return null;
  }
  if (trials.length > MAX_TRIALS) {
    return null;
  }

  const dataPoints: HyperoptTrial[] = [];
  for (const t of trials) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const o = t as Record<string, unknown>;
    const params = o.parameters;
    if (!params || typeof params !== "object" || Array.isArray(params)) continue;
    const score = typeof o.score === "number" && Number.isFinite(o.score) ? o.score : 0;
    const flat: Record<string, number> = {};
    for (const [k, v] of Object.entries(params)) {
      if (isNumeric(v) && typeof v !== "boolean") {
        flat[k] = v;
      }
    }
    if (Object.keys(flat).length === 0) continue;
    dataPoints.push({ parameters: flat, score });
  }

  if (dataPoints.length < MIN_TRIALS) {
    return null;
  }

  const paramNames = new Set<string>();
  for (const p of dataPoints) {
    for (const k of Object.keys(p.parameters)) {
      paramNames.add(k);
    }
  }
  if (paramNames.size === 0) return null;

  const scores = dataPoints.map((p) => p.score);
  const bestIdx = scores.reduce((best, _, i) => (scores[i] > scores[best] ? i : best), 0);
  const worstIdx = scores.reduce((best, _, i) => (scores[i] < scores[best] ? i : best), 0);

  const parametersOut: ParameterSensitivityParameter[] = [];
  for (const name of [...paramNames].sort()) {
    const vals: number[] = [];
    const scs: number[] = [];
    for (const p of dataPoints) {
      const v = p.parameters[name];
      if (isNumeric(v)) {
        vals.push(v);
        scs.push(p.score);
      }
    }
    if (vals.length < MIN_TRIALS) continue;

    const corr = calculateCorrelation(vals, scs);
    // R^2: strength of linear relationship (predictability); high = fragility
    const importance = Math.min(1, Math.max(0, corr * corr));
    const sensitivity = importance < 1e-6 ? 0 : roundTo(importance, SENSITIVITY_DISPLAY_PRECISION);

    const bestParams = dataPoints[bestIdx].parameters;
    const worstParams = dataPoints[worstIdx].parameters;
    const bestValue = isNumeric(bestParams[name]) ? (bestParams[name] as number) : 0;
    const worstValue = isNumeric(worstParams[name]) ? (worstParams[name] as number) : 0;

    let impact: "high" | "medium" | "low" = "low";
    if (sensitivity >= 0.5) impact = "high";
    else if (sensitivity >= 0.3) impact = "medium";

    const overfittingRisk = sensitivity >= 0.35;

    const sortedPairs = vals.map((v, i) => ({ value: v, score: scs[i] })).sort((a, b) => a.value - b.value);
    let curvePoints: Array<{ value: number; score: number }> | undefined;
    if (sortedPairs.length >= 3) {
      if (sortedPairs.length <= MAX_CURVE_POINTS) {
        curvePoints = sortedPairs;
      } else {
        const step = (sortedPairs.length - 1) / (MAX_CURVE_POINTS - 1);
        curvePoints = [];
        for (let i = 0; i < MAX_CURVE_POINTS; i++) {
          const idx = Math.min(Math.round(i * step), sortedPairs.length - 1);
          curvePoints.push(sortedPairs[idx]!);
        }
      }
    }

    const { displayLabel, tone } = getParameterDisplayLabelAndTone(sensitivity);
    const governanceNote = getGovernanceNote(name, sensitivity);

    parametersOut.push({
      name: formatParamName(name),
      sensitivity,
      bestValue,
      worstValue,
      impact,
      overfittingRisk,
      curvePoints,
      displayLabel,
      tone,
      ...(governanceNote && { governanceNote }),
    });
  }

  if (parametersOut.length === 0) return null;

  return { parameters: parametersOut };
}
