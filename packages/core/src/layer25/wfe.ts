/**
 * WFE (Walk-Forward Efficiency) - Layer 2.5 definition and compute.
 */

import type { WFAWindowMetrics } from "../canonicalMetrics";
import type { MetricDefinition, MetricResult, MetricVerdict } from "../metricDefinitionContract";

export const WFE_METRIC_DEFINITION: MetricDefinition = {
  metricName: "WFE",
  version: "2.0",
  definition: "Walk-Forward Efficiency: robustness measure of out-of-sample performance vs in-sample",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description: "Median of per-window OOS/IS return ratios",
    pseudocode: "median([oos_ret / is_ret for each window])",
    inputFields: [
      "wfaWindowMetrics[].oosMetrics.totalReturn",
      "wfaWindowMetrics[].isMetrics.totalReturn",
    ],
    computationFunc: "computeWFEMetric_v2",
  },
  validRange: {
    min: null,
    max: null,
    description: "Unbounded; typically -2 to +2. Negative when OOS return opposite sign to IS.",
  },
  thresholds: {
    fail: 0.2,
    warn: 0.5,
    pass: 0.7,
    note: "Threshold applies to positive WFE only. If WFE < 0 (OOS negative, IS positive), verdict is FAIL. 0 to 0.2 = FAIL, 0.2 to 0.5 = WARN, >= 0.7 = PASS.",
  },
  applicability: {
    requiresMinPeriods: 2,
    requiresMinTrades: 5,
    requiresPositiveIS: false,
    fallback: "null",
  },
  uiLabel: "WFE (Median OOS/IS)",
  uiTooltip:
    "Median of per-window OOS/IS ratios over windows with IS > 0 only. Selection bias: windows with IS <= 0 are excluded from the ratio; failed (OOS <= 0) windows are included when IS > 0. So WFE uses a subset of windows (IS-positive only); different N from OOS Retention. Min/median/max and variance use the same N; median is the middle value (odd N) or average of the two middle values (even N). WFE distribution variance is population variance. When IS and OOS are both negative in a window, ratio > 1 means OOS is more negative than IS (worse). > 0.7 = robust, < 0.2 = weak.",
  uiFormat: ".2f",
  changelog: [
    { version: "1.0", date: "2026-01", change: "Initial: mean of per-window ratios" },
    { version: "2.0", date: "2026-02", change: "Changed to MEDIAN; added explicit threshold logic for negative WFE" },
  ],
};

const WFE_MIN_NORMAL_WINDOWS = 3;
const IS_EPSILON = 1e-9;

export function computeWFEMetric_v2(wfaWindowMetrics: WFAWindowMetrics[]): MetricResult<number | null> {
  const definition = WFE_METRIC_DEFINITION;
  if (
    !Array.isArray(wfaWindowMetrics) ||
    wfaWindowMetrics.length < definition.applicability.requiresMinPeriods
  ) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
      caveats: ["Insufficient windows for WFE (min 2)."],
    };
  }

  const classification = { normal: 0, recovery: 0, doubleNegative: 0, undefined: 0 };
  const normalRatios: number[] = [];

  for (const w of wfaWindowMetrics) {
    const isRet = w.isMetrics.totalReturn;
    const oosRet = w.oosMetrics.totalReturn;
    if (
      typeof isRet !== "number" ||
      typeof oosRet !== "number" ||
      !Number.isFinite(isRet) ||
      !Number.isFinite(oosRet)
    ) {
      classification.undefined += 1;
      continue;
    }
    if (Math.abs(isRet) < IS_EPSILON) {
      classification.undefined += 1;
      continue;
    }
    if (isRet > 0) {
      classification.normal += 1;
      const ratio = oosRet / isRet;
      if (Number.isFinite(ratio)) normalRatios.push(ratio);
    } else {
      if (oosRet > 0) classification.recovery += 1;
      else classification.doubleNegative += 1;
    }
  }

  if (normalRatios.length < WFE_MIN_NORMAL_WINDOWS) {
    const caveats = [
      normalRatios.length === 0
        ? "No windows with positive IS return; WFE undefined."
        : `Insufficient positive IS windows for WFE (${normalRatios.length} < ${WFE_MIN_NORMAL_WINDOWS}).`,
    ];
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
      caveats,
      wfeValidWindowCount: normalRatios.length,
      wfeWindowClassification: classification,
    };
  }

  const sorted = [...normalRatios].sort((a, b) => a - b);
  const nMed = sorted.length;
  const median =
    nMed % 2 === 1
      ? sorted[Math.floor(nMed / 2)]!
      : (sorted[nMed / 2 - 1]! + sorted[nMed / 2]!) / 2;
  const min = sorted[0]!;
  const max = sorted[nMed - 1]!;
  const mean = normalRatios.reduce((a, b) => a + b, 0) / normalRatios.length;
  const variance =
    normalRatios.reduce((s, v) => s + (v - mean) ** 2, 0) / normalRatios.length;

  let verdict: MetricVerdict;
  if (median < 0) {
    verdict = "FAIL";
  } else if (median < 0.2) {
    verdict = "FAIL";
  } else if (median < 0.5) {
    verdict = "WARN";
  } else {
    verdict = "PASS";
  }

  const nNegativeWfe = normalRatios.filter((r) => r < 0).length;
  const nPositiveWfe = normalRatios.filter((r) => r >= 0).length;
  const profitableAmongPositiveIsCount = normalRatios.filter((r) => r > 0).length;

  return {
    value: median,
    definition,
    verdict,
    source: "wfaWindowMetrics",
    definitionVersion: definition.version,
    wfeDistribution: { min, median, max, variance, nNegativeWfe, nPositiveWfe },
    wfeValidWindowCount: normalRatios.length,
    wfeWindowClassification: classification,
    profitableAmongPositiveIsCount,
  };
}
