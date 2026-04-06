/**
 * Performance Degradation - Layer 2.5 definition and compute.
 */

import type { WFAWindowMetrics } from "../canonicalMetrics";
import type { MetricDefinition, MetricResult } from "../metricDefinitionContract";
import { calcDegradation } from "../performanceRatios";

export const PERFORMANCE_DEGRADATION_METRIC_DEFINITION: MetricDefinition = {
  metricName: "Performance_Degradation",
  version: "1.2",
  definition: "Percentage loss in return from optimization (IS) to validation (OOS)",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description: "(mean(OOS) - mean(IS)) / |mean(IS)|; same window returns as OOS Retention (no rounding)",
    pseudocode:
      "meanIS = mean(IS_returns); meanOOS = mean(OOS_returns); (meanOOS - meanIS) / abs(meanIS)",
    inputFields: ["wfaWindowMetrics[].isMetrics.totalReturn", "wfaWindowMetrics[].oosMetrics.totalReturn"],
    computationFunc: "computePerformanceDegradation",
  },
  validRange: {
    min: null,
    max: null,
    description: "Can be negative (OOS worse than IS) or positive (OOS better).",
  },
  thresholds: {
    note: "Do NOT confuse with WFE. Degradation is absolute change in returns; WFE is ratio.",
  },
  applicability: {
    requiresMinPeriods: 2,
    requiresMinTrades: 0,
    fallback: "null",
  },
  uiLabel: "Relative Change (OOS−IS)/|IS|",
  uiTooltip:
    "Relative change from IS to OOS: (mean OOS - mean IS) / |mean IS|. Same N as OOS Retention (all windows). When mean(IS) < 0: Relative Change = -(Retention - 1), so negative = OOS worse than IS.",
  uiFormat: ".2f",
  changelog: [
    { version: "1.0", date: "2026-02", change: "Explicit formula documented" },
    {
      version: "1.1",
      date: "2026-02",
      change: "Round period returns to 3 decimals so result matches hand calculation (e.g. -17% not -19%).",
    },
    {
      version: "1.2",
      date: "2026-02",
      change: "Remove rounding; use same canonical mean OOS/IS as OOS Retention so degradation = retention - 1 when IS > 0.",
    },
  ],
};

export function computePerformanceDegradation(
  wfaWindowMetrics: WFAWindowMetrics[],
): MetricResult<number | null> {
  const definition = PERFORMANCE_DEGRADATION_METRIC_DEFINITION;
  if (
    !Array.isArray(wfaWindowMetrics) ||
    wfaWindowMetrics.length < definition.applicability.requiresMinPeriods
  ) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
    };
  }

  const isReturns = wfaWindowMetrics
    .map((w) => w.isMetrics.totalReturn)
    .filter((v) => Number.isFinite(v)) as number[];
  const oosReturns = wfaWindowMetrics
    .map((w) => w.oosMetrics.totalReturn)
    .filter((v) => Number.isFinite(v)) as number[];

  if (isReturns.length === 0 || oosReturns.length === 0) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
    };
  }

  const degradation = calcDegradation(oosReturns, isReturns);
  if (degradation == null) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
      caveats: ["Mean IS ~0; degradation undefined."],
    };
  }

  const caveats: string[] = [];
  if (Number.isFinite(degradation) && degradation < -1) {
    caveats.push("Mean OOS and mean IS have opposite signs; not comparable to full backtest return.");
  }

  return {
    value: degradation,
    definition,
    verdict: "N/A",
    source: "wfaWindowMetrics",
    definitionVersion: definition.version,
    ...(caveats.length > 0 && { caveats }),
  };
}
