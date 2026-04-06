/**
 * OOS Retention Ratio - Layer 2.5 definition and compute.
 */

import type { WFAWindowMetrics } from "../canonicalMetrics";
import type { MetricDefinition, MetricResult, MetricVerdict } from "../metricDefinitionContract";
import { calcRetention } from "../performanceRatios";

export const OOS_RETENTION_METRIC_DEFINITION: MetricDefinition = {
  metricName: "OOS_Retention_Ratio",
  version: "1.1",
  definition: "Ratio of mean OOS return to mean IS return across windows",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description: "mean(OOS returns) / mean(IS returns)",
    pseudocode: "mean(OOS_returns) / mean(IS_returns)",
    inputFields: ["wfaWindowMetrics[].isMetrics.totalReturn", "wfaWindowMetrics[].oosMetrics.totalReturn"],
    computationFunc: "computeOOSRetention",
  },
  validRange: {
    min: -1.5,
    max: 1.5,
    description:
      "For verdict only: thresholds use clamped [-150%, +150%]. Stored value is raw (unclamped) so oosRetention === sumOos/sumIs.",
  },
  thresholds: {
    note: "When mean IS > 0: < 0 = KILL, 0-0.2 = FAIL, 0.2-0.7 = WARN, >= 0.7 = PASS. When mean IS <= 0 or ~0: N/A (do not apply kill switch).",
  },
  applicability: {
    requiresMinPeriods: 2,
    requiresMinTrades: 0,
    requiresMeanISNotZero: true,
    fallback: "null",
  },
  uiLabel: "OOS/IS Return Ratio",
  uiTooltip:
    "Mean return ratio over all WFA windows: sum(OOS)/sum(IS) = mean(OOS)/mean(IS). When both IS and OOS are negative, this ratio is not interpretable as retention (share of profit preserved); it is shown for transparency and indicates relative magnitude of losses only. > 70% = good, < 20% = poor when both positive. When both negative: > 100% = OOS losses larger than IS (|OOS| > |IS|). WFE uses windows with IS > 0 only.",
  uiFormat: ".1%",
  changelog: [
    { version: "1.0", date: "2026-01", change: "Initial" },
    { version: "1.1", date: "2026-02", change: "Kill switch only when IS > 0; N/A when IS <= 0 or flat" },
  ],
};

const RETENTION_CLAMP_MIN = -1.5;
const RETENTION_CLAMP_MAX = 1.5;

function mean(arr: number[]): number {
  if (arr.length === 0) return Number.NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeOOSRetention(wfaWindowMetrics: WFAWindowMetrics[]): MetricResult<number | null> {
  const definition = OOS_RETENTION_METRIC_DEFINITION;
  if (
    !Array.isArray(wfaWindowMetrics) ||
    wfaWindowMetrics.length < definition.applicability.requiresMinPeriods
  ) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
      caveats: ["Insufficient windows for OOS Retention (min 2)."],
    };
  }

  const isReturns = wfaWindowMetrics
    .map((w) => w.isMetrics.totalReturn)
    .filter((v): v is number => Number.isFinite(v));
  const oosReturns = wfaWindowMetrics
    .map((w) => w.oosMetrics.totalReturn)
    .filter((v): v is number => Number.isFinite(v));

  if (isReturns.length === 0 || oosReturns.length === 0) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
    };
  }

  const retention = calcRetention(oosReturns, isReturns);
  if (retention == null) {
    return {
      value: null,
      definition,
      verdict: "N/A",
      definitionVersion: definition.version,
      caveats: ["Mean IS ~0; retention ratio undefined."],
    };
  }

  const meanIS = mean(isReturns);
  const clamped = Math.max(RETENTION_CLAMP_MIN, Math.min(RETENTION_CLAMP_MAX, retention));

  let verdict: MetricVerdict;
  if (meanIS > 0) {
    if (clamped < 0) {
      verdict = "KILL";
    } else if (clamped < 0.2) {
      verdict = "FAIL";
    } else if (clamped < 0.7) {
      verdict = "WARN";
    } else {
      verdict = "PASS";
    }
  } else {
    verdict = "N/A";
  }

  return {
    value: retention,
    definition,
    verdict,
    source: "wfaWindowMetrics",
    definitionVersion: definition.version,
    ...(verdict === "N/A" && meanIS <= 0
      ? { caveats: ["Mean IS negative; kill switch not applicable."] }
      : {}),
  };
}
