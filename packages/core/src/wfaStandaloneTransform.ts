/**
 * Transformers for standalone analyze: WFA and robustness score.
 * Duplicated from frontend src/lib/api/test-result/transformers.ts (subset) - keep in sync.
 */

import { toDecimalReturn } from "./normalize";
import {
  calculateRobustnessScoreFromWfa,
  type RobustnessScoreFromWfaInput,
} from "./robustnessScoreFromWfa";
import type {
  RobustnessScoreFromWfaResult,
} from "@kiploks/engine-contracts";

/**
 * Walk-forward analysis block for standalone analyze (structurally matches full-report WalkForwardAnalysis).
 */
export type WalkForwardStandaloneShape = {
  performanceTransfer: { windows: unknown[] };
  wfe?: number;
  consistency: number;
  degradationRatio: number;
  failedWindows: { count: number; total: number; windows: unknown[] };
  overfittingRisk: { score: number; level: "LOW" | "MEDIUM" | "HIGH"; note?: string };
  verdict: "PASS" | "FAIL";
  verdictExplanation: string;
  windows?: unknown[];
  paramDrift?: "Low" | "Medium" | "High";
  textPayload?: {
    wfeNaReason?: string;
    consistencyNaReason?: string;
    failedWindowsSummary?: string;
    verdictExplanation?: string;
  };
  heavyRef?: unknown;
  wfaConfig?: unknown;
  statisticalSignificance?: unknown;
  distribution?: unknown;
  isDisabled?: boolean;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return NaN;
}

function getPeriodReturns(p: Record<string, unknown>): {
  validationReturn: number;
  optimizationReturn: number;
} {
  const metrics = p.metrics as Record<string, unknown> | undefined;
  const validation = metrics?.validation as Record<string, unknown> | undefined;
  const optimization = metrics?.optimization as Record<string, unknown> | undefined;
  const rawVal = p.validationReturn ?? validation?.totalReturn ?? validation?.total;
  const rawOpt = p.optimizationReturn ?? optimization?.totalReturn ?? optimization?.total;
  return {
    validationReturn: toDecimalReturn(rawVal),
    optimizationReturn: toDecimalReturn(rawOpt),
  };
}

function getOverfittingLevel(score: number): "LOW" | "MEDIUM" | "HIGH" {
  if (Number.isNaN(score)) return "MEDIUM";
  if (score <= 0.25) return "LOW";
  if (score <= 0.4) return "MEDIUM";
  return "HIGH";
}

/** Failure mode diagnosis per window (Dead Zone, Edge Erosion, Alpha Reversal, Volatility Collapse). */
function getFailureModeDiagnosis(
  optimizationReturn: number,
  validationReturn: number,
  oosTradesCount: number | undefined,
  isProfitFactor: number | undefined,
  oosProfitFactor: number | undefined
): string | undefined {
  if (typeof oosTradesCount === "number" && oosTradesCount === 0) {
    return "Dead Zone (Inactivity)";
  }
  if (
    typeof isProfitFactor === "number" &&
    Number.isFinite(isProfitFactor) &&
    typeof oosProfitFactor === "number" &&
    Number.isFinite(oosProfitFactor) &&
    isProfitFactor > 1.2 &&
    oosProfitFactor < 1
  ) {
    return "Edge Erosion";
  }
  if (
    Number.isFinite(optimizationReturn) &&
    Number.isFinite(validationReturn) &&
    optimizationReturn > 0 &&
    validationReturn < 0
  ) {
    return "Alpha Reversal (Overfitted)";
  }
  if (
    typeof oosTradesCount === "number" &&
    oosTradesCount > 0 &&
    Number.isFinite(validationReturn) &&
    Math.abs(validationReturn) < 0.0005
  ) {
    return "Volatility Collapse";
  }
  return undefined;
}

/**
 * Param Drift: stability of numeric parameters across WFA windows.
 * High drift (e.g. period 20 -> 200) suggests overfitting/unstable strategy.
 */
function computeParamDrift(
  windows: Array<{ parameters?: Record<string, unknown> }>
): "Low" | "Medium" | "High" | undefined {
  if (windows.length < 2) return undefined;
  const keys = new Set<string>();
  for (const w of windows) {
    if (w.parameters && typeof w.parameters === "object") {
      for (const k of Object.keys(w.parameters)) {
        if (k === "strategy") continue;
        const v = (w.parameters as Record<string, unknown>)[k];
        if (typeof v === "number" && Number.isFinite(v)) keys.add(k);
      }
    }
  }
  let maxRelativeRange = 0;
  for (const key of keys) {
    const values: number[] = [];
    for (const w of windows) {
      const v = (w.parameters as Record<string, unknown>)?.[key];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    if (values.length < 2) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const range = max - min;
    const denom = Math.abs(mean) + 1e-9;
    const relativeRange = range / denom;
    if (relativeRange > maxRelativeRange) maxRelativeRange = relativeRange;
  }
  if (maxRelativeRange <= 0) return undefined;
  if (maxRelativeRange >= 1) return "High";
  if (maxRelativeRange >= 0.3) return "Medium";
  return "Low";
}

/** Min OOS trades to consider a window statistically valid; below this we treat as failed (insufficient sample). */
const MIN_OOS_TRADES_FOR_VALID_WINDOW = 2;

/**
 * Canonical OOS return for a period: p.validationReturn ?? metrics.validation.totalReturn.
 * Use this same source for failed-window reason and any period table OOS display to avoid contradiction (e.g. table "OOS > 0" vs reason "non-positive").
 */
function getPeriodValidationReturn(p: Record<string, unknown>): number {
  const val = (p?.metrics as Record<string, unknown>)?.validation as Record<string, unknown> | undefined;
  return toDecimalReturn(toNumber(p?.validationReturn ?? val?.totalReturn));
}

/**
 * Compute WFA verdict and explanation. Single place for verdict logic; called by transformers
 * (with wfe undefined) and by buildTestResultData (with Layer 2.5 wfe). WFE is the responsibility of Layer 2.5 only.
 */
export function computeWfaVerdict(params: {
  wfe: number | undefined;
  consistency: number;
  failedWindows: { count: number; total: number };
  overfittingScore: number;
  logicParalysis: boolean;
  verdictExplanationFromPayload?: string;
}): { verdict: "PASS" | "FAIL"; verdictExplanation: string } {
  const { wfe, consistency, failedWindows, overfittingScore, logicParalysis, verdictExplanationFromPayload } = params;
  const failRate =
    failedWindows.total > 0 ? failedWindows.count / failedWindows.total : 0;
  const hasEnoughForVerdict =
    typeof wfe === "number" && Number.isFinite(wfe) && !Number.isNaN(consistency);

  if (logicParalysis) {
    return { verdict: "FAIL", verdictExplanation: "Logic Paralysis (Strategy unable to find entries in OOS)." };
  }

  const verdict: "PASS" | "FAIL" =
    overfittingScore >= 0.8 ||
    failRate > 0.3 ||
    !hasEnoughForVerdict ||
    (typeof wfe === "number" && (wfe < 0.75 || consistency < 0.6))
      ? "FAIL"
      : "PASS";

  const verdictExplanation =
    verdictExplanationFromPayload ??
    (overfittingScore >= 0.8
      ? "Overfitting risk is HIGH - verdict forced to FAIL."
      : failRate > 0.3
        ? "Failure rate exceeds 30% - verdict forced to FAIL."
        : hasEnoughForVerdict
          ? "Derived from WFE and consistency thresholds."
          : "Insufficient data to determine verdict.");
  return { verdict, verdictExplanation };
}

/** Single definition of "fail": insufficient OOS trades or validationReturn <= 0. Count and windows list use this same rule. */
function buildFailedWindows(periods: Record<string, unknown>[]) {
  if (periods.length === 0) {
    return { count: 0, total: 0, windows: [] };
  }
  const failedWithIndex = periods
    .map((period, originalIndex) => ({ period, originalIndex }))
    .filter(({ period }) => {
      const p = period as Record<string, unknown>;
      const validationReturn = getPeriodValidationReturn(p);
      const oosTradesCount = typeof p?.oosTradesCount === "number" ? p.oosTradesCount : undefined;
      const insufficientTrades =
        oosTradesCount !== undefined && oosTradesCount < MIN_OOS_TRADES_FOR_VALID_WINDOW;
      const nonPositiveReturn = Number.isFinite(validationReturn) && validationReturn <= 0;
      return insufficientTrades || nonPositiveReturn;
    });
  const windows = failedWithIndex.map(({ period, originalIndex }) => {
      const p = period as Record<string, unknown>;
      const validationReturn = getPeriodValidationReturn(p);
      const oosTradesCount = typeof p?.oosTradesCount === "number" ? p.oosTradesCount : undefined;
      const insufficientTrades =
        oosTradesCount !== undefined && oosTradesCount < MIN_OOS_TRADES_FOR_VALID_WINDOW;
      const periodLabel =
        (p?.periodName as string) || (p?.period as string) || `Period ${originalIndex + 1}`;
      const reason =
        validationReturn > 0 && insufficientTrades
          ? `Insufficient trade count (${oosTradesCount ?? 0} < ${MIN_OOS_TRADES_FOR_VALID_WINDOW})`
          : Number.isFinite(validationReturn) && validationReturn <= 0
            ? "Validation return is non-positive"
            : "Insufficient sample size";
      return {
        period: periodLabel,
        reason,
        ...(p?.regime != null && { regime: p.regime }),
      };
    });
  return {
    count: windows.length,
    total: periods.length,
    windows,
  };
}

/** Used by `runProfessionalWfa` failure-rate institutional guard (same failed-window definition as WFA UI). */
export function buildWfaFailedWindowsFromPeriods(periods: Record<string, unknown>[]) {
  return buildFailedWindows(periods);
}

export function createEmptyWalkForwardAnalysis(options?: {
  isDisabled?: boolean;
  verdictExplanation?: string;
}): WalkForwardStandaloneShape {
  return {
    performanceTransfer: { windows: [] },
    wfe: undefined,
    consistency: 0,
    degradationRatio: 0,
    failedWindows: { count: 0, total: 0, windows: [] },
    overfittingRisk: { score: 0, level: "MEDIUM" },
    verdict: "FAIL",
    verdictExplanation: options?.verdictExplanation ?? "Data not available",
    windows: [],
    isDisabled: options?.isDisabled ?? false,
  };
}

/** Payload shape with results.topResults[] (used to resolve walkForwardAnalysis by result id). */
interface ResearchLike {
  results?: string | { topResults?: unknown[] };
}

export function transformToWalkForwardAnalysis(
  research: ResearchLike | null,
  resultId?: string,
  options?: { onError?: (error: unknown) => void }
): WalkForwardStandaloneShape | null {
  if (!research?.results || !resultId) return null;

  try {
    const resultsData =
      typeof research.results === "string"
        ? (JSON.parse(research.results) as { topResults?: unknown[] })
        : (research.results as { topResults?: unknown[] });

    if (!resultsData?.topResults || !Array.isArray(resultsData.topResults)) {
      return null;
    }

    const specificResult = resultsData.topResults.find(
      (r: unknown) => (r as { id?: string }).id === resultId
    ) as Record<string, unknown> | undefined;

    if (!specificResult) return null;

    const wfaRaw =
      specificResult.walkForwardAnalysis ??
      specificResult.wfaResult ??
      specificResult.wfaData;

    if (!wfaRaw || typeof wfaRaw !== "object") {
      return createEmptyWalkForwardAnalysis();
    }

    const wfa = wfaRaw as Record<string, unknown>;
    const periods = Array.isArray(wfa.periods) ? wfa.periods : [];
    // Integration rule: when periods.length > 0, cross-window stats and wfe/consistency from payload are ignored; host pipeline computes from periods (and performanceTransfer).
    const normalizedPeriods = periods.map((p: unknown) =>
      getPeriodReturns((p as Record<string, unknown>) ?? {})
    );
    const sumOpt =
      normalizedPeriods.reduce(
        (s, r) => s + (Number.isFinite(r.optimizationReturn) ? r.optimizationReturn : 0),
        0
      ) || 0;
    const sumVal =
      normalizedPeriods.reduce(
        (s, r) => s + (Number.isFinite(r.validationReturn) ? r.validationReturn : 0),
        0
      ) || 0;
    const avgOptReturn =
      periods.length > 0
        ? normalizedPeriods.reduce(
            (s, r) => s + (Number.isFinite(r.optimizationReturn) ? r.optimizationReturn : 0),
            0
          ) / periods.length
        : toDecimalReturn(toNumber(wfa.averageOptimizationReturn));
    const avgValReturn =
      periods.length > 0
        ? normalizedPeriods.reduce(
            (s, r) => s + (Number.isFinite(r.validationReturn) ? r.validationReturn : 0),
            0
          ) / periods.length
        : toDecimalReturn(toNumber(wfa.averageValidationReturn));

    // WFE is NOT computed here. Layer 2.5 (buildTestResultData + computeWFEMetric_v2) is the single source for wfe.
    // Transformers output wfe: undefined; verdict uses "Insufficient data" until Layer 2.5 sets wfe and re-applies verdict.

    const degradationFromPeriods =
      periods.length > 0 && sumOpt !== 0 && Number.isFinite(sumVal)
        ? sumVal / sumOpt
        : NaN;
    const degradationRatio = Number.isFinite(degradationFromPeriods)
      ? degradationFromPeriods
      : !Number.isNaN(avgOptReturn) && avgOptReturn !== 0
        ? avgValReturn / avgOptReturn
        : (() => {
            const returnDegradation = toNumber(wfa.returnDegradation);
            if (!Number.isNaN(returnDegradation)) return 1 - returnDegradation / 100;
            return NaN;
          })();

    // Same base as WFE: only windows with IS (optimizationReturn) > 0. Consistency = share of those with OOS > 0.
    const periodsWithPositiveIs = normalizedPeriods.filter(
      (r) => Number.isFinite(r.optimizationReturn) && r.optimizationReturn > 0
    );
    const consistency =
      periodsWithPositiveIs.length > 0
        ? periodsWithPositiveIs.filter((r) => r.validationReturn > 0).length /
          periodsWithPositiveIs.length
        : toDecimalReturn(toNumber(wfa.consistency));
    const overfittingScore = toNumber(wfa.overfittingScore);
    // Always build from periods so period labels use original indices (e.g. Period 1, 4, 5, 6 not 1, 2, 3, 4).
    const failedWindows = buildFailedWindows(periods as Record<string, unknown>[]);

    // Zombie windows: OOS has 0 trades (only when oosTradesCount is explicitly provided)
    const periodsWithOosTrades = periods as Array<Record<string, unknown>>;
    const zombieCount = periodsWithOosTrades.filter(
      (p) => typeof p?.oosTradesCount === "number" && p.oosTradesCount === 0
    ).length;
    const totalWindows = periods.length;
    const logicParalysis =
      totalWindows > 0 &&
      zombieCount > totalWindows / 2 &&
      periodsWithOosTrades.some((p) => typeof p?.oosTradesCount === "number");

    const { verdict, verdictExplanation } = computeWfaVerdict({
      wfe: undefined,
      consistency,
      failedWindows: failedWindows as { count: number; total: number },
      overfittingScore,
      logicParalysis,
    });

    const windows =
      periods.length > 0
        ? periods.map((period: unknown, idx: number) => {
            const p = period as Record<string, unknown>;
            const m = p?.metrics as Record<string, unknown> | undefined;
            const opt = m?.optimization as Record<string, unknown> | undefined;
            const val = m?.validation as Record<string, unknown> | undefined;
            const optimizationReturn = toDecimalReturn(toNumber(p?.optimizationReturn ?? opt?.totalReturn));
            const validationReturn = toDecimalReturn(toNumber(p?.validationReturn ?? val?.totalReturn));
            const oosTradesCount = typeof p?.oosTradesCount === "number" ? p.oosTradesCount : undefined;
            const isProfitFactor = typeof p?.isProfitFactor === "number" && Number.isFinite(p.isProfitFactor as number) ? (p.isProfitFactor as number) : undefined;
            const oosProfitFactor = typeof p?.oosProfitFactor === "number" && Number.isFinite(p.oosProfitFactor as number) ? (p.oosProfitFactor as number) : undefined;
            const diagnosis = getFailureModeDiagnosis(optimizationReturn, validationReturn, oosTradesCount, isProfitFactor, oosProfitFactor);
            return {
              period: p?.periodName ?? p?.period ?? `Period ${idx + 1}`,
              optimizationReturn,
              validationReturn,
              parameters: (p?.parameters as Record<string, unknown>) ?? {},
              isProfitable: validationReturn > 0,
              regime: p?.regime,
              ...(typeof p?.oosTradesCount === "number" && { oosTradesCount: p.oosTradesCount as number }),
              ...(typeof p?.isTradesCount === "number" && { isTradesCount: p.isTradesCount as number }),
              ...(typeof p?.isProfitFactor === "number" && Number.isFinite(p.isProfitFactor as number) && { isProfitFactor: p.isProfitFactor as number }),
              ...(typeof p?.oosProfitFactor === "number" && Number.isFinite(p.oosProfitFactor as number) && { oosProfitFactor: p.oosProfitFactor as number }),
              ...(diagnosis && { diagnosis }),
            };
          })
        : [];

    const failedCount = (failedWindows as { count?: number }).count ?? 0;
    const totalCount = (failedWindows as { total?: number }).total ?? 0;
    const failRate = totalCount > 0 ? failedCount / totalCount : 0;
    const retention = Number.isFinite(degradationFromPeriods) ? degradationFromPeriods : NaN;
    const forceHighOverfitting =
      failRate > 0.5 && Number.isFinite(retention) && retention < 0.2;
    const overfittingLevel = forceHighOverfitting
      ? "HIGH"
      : getOverfittingLevel(overfittingScore);
    const textPayload = {
      wfeNaReason:
        "WFE is n/a when there are fewer than 3 OOS trades, when there is no IS performance to compare (e.g. all IS returns zero), or when OOS variance is zero (e.g. all windows dead zone / no activity).",
      consistencyNaReason:
        "Consistency is the share of OOS windows with positive return. N/a when no windows.",
      failedWindowsSummary:
        totalCount > 0
          ? `Failed Windows: ${failedCount}/${totalCount}`
          : "No window data.",
      verdictExplanation,
    };

    return {
      performanceTransfer: {
        windows:
          (wfa.performanceTransfer as { windows?: unknown[] })?.windows &&
          Array.isArray((wfa.performanceTransfer as { windows: unknown[] }).windows)
            ? (wfa.performanceTransfer as { windows: unknown[] }).windows
            : [],
      },
      wfe: undefined,
      consistency,
      degradationRatio,
      failedWindows: failedWindows as WalkForwardStandaloneShape["failedWindows"],
      overfittingRisk: {
        score: overfittingScore,
        level: overfittingLevel,
        ...(Number.isNaN(overfittingScore) || !Number.isFinite(overfittingScore)
          ? {
              note:
                periods.length === 0
                  ? "Insufficient WFA windows or no performance transfer data."
                  : "Score not available: insufficient validation data or few trades.",
            }
          : {}),
      },
      verdict,
      verdictExplanation,
      windows,
      paramDrift: computeParamDrift(windows),
      textPayload,
      heavyRef: (wfa.heavyRef as WalkForwardStandaloneShape["heavyRef"]) ?? null,
      wfaConfig: wfa.config
        ? {
            windowLength: (wfa.config as { windowLength?: string }).windowLength ?? "",
            step: (wfa.config as { step?: string }).step ?? "",
            isOosSplit: (wfa.config as { isOosSplit?: string }).isOosSplit ?? "",
            optimizationScope: (wfa.config as { optimizationScope?: string }).optimizationScope ?? "",
          }
        : undefined,
      statisticalSignificance: wfa.statisticalSignificance as WalkForwardStandaloneShape["statisticalSignificance"],
      distribution: wfa.distribution as WalkForwardStandaloneShape["distribution"],
    };
  } catch (error) {
    options?.onError?.(error);
    return null;
  }
}

export function calculateRobustnessScore(
  backtestResult: unknown,
  walkForwardAnalysis: unknown,
  _monteCarloAnalysis?: unknown,
  proBenchmarkMetrics?: unknown,
  riskAnalysis?: unknown,
  parameterSensitivity?: unknown,
  turnoverAndCostDrag?: unknown
): RobustnessScoreFromWfaResult | null {
  return calculateRobustnessScoreFromWfa({
    backtestResult: backtestResult as RobustnessScoreFromWfaInput["backtestResult"],
    walkForwardAnalysis: walkForwardAnalysis as RobustnessScoreFromWfaInput["walkForwardAnalysis"],
    proBenchmarkMetrics: proBenchmarkMetrics as RobustnessScoreFromWfaInput["proBenchmarkMetrics"],
    riskAnalysis: riskAnalysis as Record<string, unknown> | null,
    parameterSensitivity: parameterSensitivity as Record<string, unknown> | null,
    turnoverAndCostDrag: turnoverAndCostDrag as Record<string, unknown> | null,
  });
}
