/**
 * Static Layer 2.5 metric definitions for pro-benchmark API (no compute here).
 */

import type { MetricDefinition } from "../metricDefinitionContract";

export const OOS_CALMAR_METRIC_DEFINITION: MetricDefinition = {
  metricName: "OOS_Calmar",
  version: "1.1",
  definition:
    "Calmar ratio from OOS return series: mean OOS return (same as Exp. OOS Return) / |OOS max drawdown%|",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description:
      "(mean OOS return x 100) / maxDrawdownPct; same return as Exp. OOS Return; maxDD from equity curve built from validation returns",
    pseudocode:
      "meanReturn = mean(validationReturns); equityCurve = buildEquityFromReturns(validationReturns); maxDD_pct = maxDrawdown(equityCurve); Calmar = (meanReturn * 100) / maxDD_pct",
    inputFields: ["validationReturns[] or oosEquityCurve"],
    computationFunc: "fillProMetricsFromWfaPeriods",
  },
  validRange: {
    min: null,
    max: null,
    description: "Can be negative when OOS mean return is negative. Positive Calmar with negative return is a bug.",
  },
  thresholds: {
    note: "Display with source label: OOS (window-level) or OOS (stitched equity). Consistent with Exp. OOS Return and OOS Max DD.",
  },
  applicability: {
    requiresMinPeriods: 2,
    requiresMinTrades: 0,
    fallback: "null",
  },
  uiLabel: "OOS Calmar",
  uiTooltip:
    "Mean OOS return% / |OOS max drawdown%|. Same return as Exp. OOS Return; same max DD as OOS Max DD in bench block. Negative when OOS return is negative.",
  uiFormat: ".2f",
  changelog: [
    { version: "1.0", date: "2026-02", change: "Explicit: same series as OOS Sharpe; sign must match return" },
    {
      version: "1.1",
      date: "2026-02",
      change:
        "Formula: use mean OOS return (not compounded) so Calmar matches Exp. OOS Return and OOS Max DD; single source for bench bucket [A]",
    },
  ],
};

export const OOS_CVAR95_METRIC_DEFINITION: MetricDefinition = {
  metricName: "OOS_CVaR_95",
  version: "1.0",
  definition: "95% Conditional Value at Risk: mean of worst 5% of OOS returns",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description: "Mean of worst 5% of OOS returns (same series as Calmar/Sharpe)",
    pseudocode: "sorted = sort(returns); tail = sorted[0 : ceil(0.05*n)]; CVaR = mean(tail)",
    inputFields: ["validationReturns[] or oosEquityCurve step returns"],
    computationFunc: "fillProMetricsFromWfaPeriods or from stitched OOS curve",
  },
  validRange: {
    min: null,
    max: null,
    description: "Typically negative. Same units (decimal) as volatility of the series.",
  },
  thresholds: { note: "Display with source. Consistency: |CVaR| >= |VaR| for same quantile." },
  applicability: {
    requiresMinPeriods: 2,
    requiresMinTrades: 0,
    fallback: "null",
  },
  uiLabel: "OOS CVaR (95%)",
  uiTooltip: "Average of worst 5% of OOS returns. Same series as OOS Calmar/Sharpe.",
  uiFormat: ".2%",
  changelog: [{ version: "1.0", date: "2026-02", change: "Explicit: same series as OOS metrics" }],
};

export const OOS_DOMINANCE_RATIO_METRIC_DEFINITION: MetricDefinition = {
  metricName: "OOS_Dominance_Ratio",
  version: "1.0",
  definition: "Share of WFA windows where OOS return exceeds 90% of IS return",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description: "count(validationReturn > 0.9 * optimizationReturn) / total windows",
    pseudocode: "count = 0; for each window: if valRet > 0.9*optRet then count++; ratio = count / n",
    inputFields: ["wfaWindowMetrics[].validationReturn", "wfaWindowMetrics[].optimizationReturn"],
    computationFunc: "fillProMetricsFromWfaPeriods",
  },
  validRange: {
    min: 0,
    max: 1,
    description: "0 to 1 (0% to 100%).",
  },
  thresholds: { note: "Display as percentage. No pass/fail threshold in contract." },
  applicability: {
    requiresMinPeriods: 1,
    requiresMinTrades: 0,
    fallback: "null",
  },
  uiLabel: "OOS Dominance Ratio",
  uiTooltip: "Share of windows where validation return > 90% of optimization return.",
  uiFormat: ".1%",
  changelog: [{ version: "1.0", date: "2026-02", change: "Explicit formula: 0.9*IS threshold" }],
};

export const WFA_PASS_PROBABILITY_CRITICAL_LOW_THRESHOLD = 0.35;

export const WFA_PASS_PROBABILITY_METRIC_DEFINITION: MetricDefinition = {
  metricName: "WFA_Pass_Probability",
  version: "1.0",
  definition:
    "Bayesian posterior probability that next window passes (validation return > 0), uniform prior",
  canonicalSource: "wfaWindowMetrics",
  formula: {
    description: "(successes + 1) / (n + 2) where successes = count(validationReturn > 0)",
    pseudocode: "successes = count(valRet > 0); prob = (successes + 1) / (periods.length + 2)",
    inputFields: ["wfaWindowMetrics[].validationReturn"],
    computationFunc: "fillProMetricsFromWfaPeriods",
  },
  validRange: {
    min: 0,
    max: 1,
    description: "0 to 1. 50% at 3/6 pass is neutral, not 'critically low'.",
  },
  thresholds: {
    note: "Narrative 'critically low' only when < 35%. 50% is neutral.",
  },
  applicability: {
    requiresMinPeriods: 1,
    requiresMinTrades: 0,
    fallback: "null",
  },
  uiLabel: "WFA Pass Probability (Bayesian)",
  uiTooltip: "Posterior probability next window passes (val return > 0). 50% at 3/6 is neutral.",
  uiFormat: ".1%",
  changelog: [{ version: "1.0", date: "2026-02", change: "Explicit formula; narrative threshold 35%" }],
};
