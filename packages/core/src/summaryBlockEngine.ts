/**
 * Summary Block Engine - 7 diagnostic modules per SUMMARY_BLOCK_AUDIT_SPEC.md.
 * Used to build Executive Summary and Diagnostic Summary (Symptom - Solution).
 */

import type { TestResultDataLike, WalkForwardAnalysis } from "./analysisReportTypes";

export type SummaryModuleId =
  | "alphaInversion"
  | "logicParalysis"
  | "executionBleed"
  | "biasDetection"
  | "regimeMismatch"
  | "fatTailRisk"
  | "stabilityDecay";

export interface DiagnosticCheck {
  moduleId: SummaryModuleId;
  moduleName: string;
  severity: number;
  message: string;
  actionPlan: string;
}

export interface SummaryBlockResult {
  checks: DiagnosticCheck[];
  operationalLines: string[];
  statisticalLines: string[];
  integrityLines: string[];
  recommendationLines: string[];
  executiveSummaryParagraph: string;
  allocatable: boolean;
}

const KURTOSIS_FAT_TAIL_THRESHOLD = 3;
const NET_EDGE_CRITICAL_BPS = 0;
const EDGE_HALF_LIFE_DAYS_THRESHOLD = 20;

function checkAlphaInversion(
  wfa: WalkForwardAnalysis | null | undefined,
  oosWindowCountFromRisk?: number
): DiagnosticCheck | null {
  const windows = wfa?.windows;
  if (!Array.isArray(windows) || windows.length === 0) return null;

  const alphaReversalWindows: string[] = [];
  for (const w of windows) {
    const optRet = (w as { optimizationReturn?: number }).optimizationReturn;
    const valRet = (w as { validationReturn?: number }).validationReturn;
    const diagnosis = (w as { diagnosis?: string }).diagnosis;
    const isReversal =
      diagnosis === "Alpha Reversal (Overfitted)" ||
      (Number.isFinite(optRet) &&
        Number.isFinite(valRet) &&
        (optRet as number) > 0 &&
        (valRet as number) < 0);
    if (isReversal) {
      const period = (w as { period?: string }).period ?? "?";
      alphaReversalWindows.push(period);
    }
  }

  if (alphaReversalWindows.length === 0) return null;

  const severity =
    alphaReversalWindows.length === windows.length
      ? 1
      : Math.min(0.95, 0.3 + (alphaReversalWindows.length / windows.length) * 0.65);
  const singleOosContext = oosWindowCountFromRisk === 1 || windows.length === 1;
  const windowList = singleOosContext
    ? "the OOS window"
    : alphaReversalWindows.length <= 3
      ? alphaReversalWindows.join(", ")
      : `Windows ${alphaReversalWindows.slice(0, 2).join(", ")} and ${alphaReversalWindows.length - 2} more`;

  return {
    moduleId: "alphaInversion",
    moduleName: "Alpha Inversion",
    severity,
    message: `Detected Alpha Inversion in ${windowList}, indicating significant curve-fitting.`,
    actionPlan:
      "Simplify: Reduce number of parameters (n_indicators). Add regularisation or complexity penalty.",
  };
}

function checkLogicParalysis(
  wfa: WalkForwardAnalysis | null | undefined
): DiagnosticCheck | null {
  const verdictExplanation = wfa?.verdictExplanation ?? "";
  const isLogicParalysis = verdictExplanation
    .toLowerCase()
    .includes("logic paralysis");

  const windows = wfa?.windows;
  if (!Array.isArray(windows) || windows.length === 0) {
    if (isLogicParalysis)
      return {
        moduleId: "logicParalysis",
        moduleName: "Logic Paralysis",
        severity: 0.9,
        message: "Logic Paralysis: Strategy unable to find entries in OOS.",
        actionPlan:
          "Widen funnel: Relax entry conditions. Check that filters are not too specific to one year.",
      };
    return null;
  }

  const withOosTrades = windows.filter((w) => {
    const n = (w as { oosTradesCount?: number }).oosTradesCount;
    return typeof n === "number" && n > 0;
  });
  const zombieCount = windows.length - withOosTrades.length;
  const zombieFraction = zombieCount / windows.length;

  if (zombieFraction < 0.5 && !isLogicParalysis) return null;

  const severity = isLogicParalysis ? 1 : Math.min(0.95, 0.4 + zombieFraction * 0.55);
  const windowRef =
    zombieCount <= 3
      ? `Windows ${zombieCount}`
      : `Windows 2-${zombieCount}`;

  return {
    moduleId: "logicParalysis",
    moduleName: "Logic Paralysis",
    severity,
    message: `Logic Paralysis in ${windowRef} suggests the strategy is over-tuned to specific historical noise.`,
    actionPlan:
      "Widen funnel: Relax entry conditions. Check that filters are not too specific to one year.",
  };
}

function checkExecutionBleed(
  turnover: Record<string, unknown> | null | undefined,
  benchmark: Record<string, unknown> | null | undefined
): DiagnosticCheck | null {
  const netBpsPerTrade = turnover?.avgNetProfitPerTradeBps as number | undefined;
  const netBpsPerPeriod = benchmark?.netEdgeBps as number | undefined;
  const netBps =
    (Number.isFinite(netBpsPerTrade) ? netBpsPerTrade : undefined) ??
    (Number.isFinite(netBpsPerPeriod) ? netBpsPerPeriod : undefined) ??
    undefined;

  if (netBps == null || !Number.isFinite(netBps)) return null;
  if (netBps >= NET_EDGE_CRITICAL_BPS) return null;

  const severity = netBps < 0 ? 1 : Math.min(0.9, 0.5 + (NET_EDGE_CRITICAL_BPS - netBps) / 50);
  const label = netBps < 0 ? "Negative edge due to costs (Scalping hell)" : "Critical fragility";
  const perTradeFinite = Number.isFinite(netBpsPerTrade);
  const perPeriodFinite = Number.isFinite(netBpsPerPeriod);
  let edgePhrase: string;
  if (perPeriodFinite && perTradeFinite) {
    edgePhrase = `Net Edge (per period): ${netBpsPerPeriod!.toFixed(2)} bps; per trade: ${netBpsPerTrade!.toFixed(2)} bps`;
  } else if (perPeriodFinite) {
    edgePhrase = `Net Edge (per period): ${netBpsPerPeriod!.toFixed(2)} bps`;
  } else {
    edgePhrase = `Net Edge (per trade): ${netBpsPerTrade!.toFixed(2)} bps`;
  }

  return {
    moduleId: "executionBleed",
    moduleName: "Execution & Commission Bleed",
    severity,
    message: `Strategy is in "${label}" (${edgePhrase}). Trading costs will consume the account regardless of market direction.`,
    actionPlan:
      "Change timeframe: Move to higher TF (1H+). Increase Take Profit so it is 5-10x larger than commission.",
  };
}

function checkBiasDetection(
  risk: Record<string, unknown> | null | undefined,
  benchmark: Record<string, unknown> | null | undefined
): DiagnosticCheck | null {
  const zeroDdWarning = benchmark?.zeroDrawdownWarning === true;
  const maxDrawdown = risk?.maxDrawdown as number | undefined;
  const strategyCAGR = benchmark?.strategyCAGR as number | undefined;
  const hasPositiveReturn =
    typeof strategyCAGR === "number" &&
    Number.isFinite(strategyCAGR) &&
    strategyCAGR > 0;

  const ddAbs = maxDrawdown != null ? Math.abs(maxDrawdown) : NaN;
  const zeroDdWithProfit =
    zeroDdWarning ||
    (Number.isFinite(ddAbs) && ddAbs < 0.0001 && hasPositiveReturn);

  if (!zeroDdWithProfit) return null;

  return {
    moduleId: "biasDetection",
    moduleName: "Bias Detection",
    severity: 0.85,
    message: "Look-ahead Bias suspected (Zero Drawdown anomaly).",
    actionPlan:
      "Debug timing: Shift entry to next bar (offset=1). Ensure entry price is not current bar's High or Low.",
  };
}

function checkRegimeMismatch(
  proMetrics: Record<string, unknown> | null | undefined
): DiagnosticCheck | null {
  const matrix = proMetrics?.regimeSurvivalMatrix as Record<string, { pass?: boolean }> | undefined;
  if (!matrix || typeof matrix !== "object") return null;

  const regimes = ["Trend", "Range", "HighVol"] as const;
  const totalRegimes = regimes.length;
  const passCount = regimes.filter((r) => matrix[r]?.pass === true).length;

  if (passCount > 0) return null;

  return {
    moduleId: "regimeMismatch",
    moduleName: "Regime Mismatch",
    severity: 0.8,
    message:
      `Regime Failure: Logic not adapted for Range. Strategy failed across all tested market regimes (${passCount}/${totalRegimes} pass). Data from Benchmark/Pro regime matrix.`,
    actionPlan:
      "Adaptiveness: Add volatility filter (ATR) or trend filter (ADX). Separate parameters for Buy and Sell regimes.",
  };
}

function checkFatTailRisk(
  risk: Record<string, unknown> | null | undefined
): DiagnosticCheck | null {
  const kurtosis = risk?.kurtosis as number | undefined;
  if (kurtosis == null || !Number.isFinite(kurtosis) || kurtosis <= KURTOSIS_FAT_TAIL_THRESHOLD)
    return null;

  const severity = Math.min(1, 0.5 + (kurtosis - KURTOSIS_FAT_TAIL_THRESHOLD) / 10);

  return {
    moduleId: "fatTailRisk",
    moduleName: "Fat-Tail Risk",
    severity,
    message:
      "Unstable Tails. Returns depend on rare anomalous moves that may not repeat.",
    actionPlan:
      "Risk management: Enforce hard stop-loss. Use median instead of mean in optimisation.",
  };
}

function checkStabilityDecay(
  proMetrics: Record<string, unknown> | null | undefined,
  wfa: WalkForwardAnalysis | null | undefined
): DiagnosticCheck | null {
  const edgeHalfLife = proMetrics?.edgeHalfLife as { days?: number } | undefined;
  const halfLifeDays = edgeHalfLife?.days;
  const paramDrift = wfa?.paramDrift;

  const shortHalfLife =
    typeof halfLifeDays === "number" &&
    Number.isFinite(halfLifeDays) &&
    halfLifeDays < EDGE_HALF_LIFE_DAYS_THRESHOLD;

  const highDrift = paramDrift === "High";

  if (!shortHalfLife && !highDrift) return null;

  const severity = shortHalfLife
    ? Math.min(1, 0.4 + (EDGE_HALF_LIFE_DAYS_THRESHOLD - halfLifeDays!) / 20)
    : 0.6;

  const message = shortHalfLife
    ? `Fast alpha decay (Edge Half-Life T1/2: ${halfLifeDays} days). Performance falls below initial level quickly.`
    : "Parameter drift is High - strategy has no stable foundation across windows.";

  return {
    moduleId: "stabilityDecay",
    moduleName: "Stability & Decay",
    severity,
    message,
    actionPlan:
      "Dynamic retraining: Shorten re-optimisation cycle. Use sliding window instead of fixed dates.",
  };
}

export function getSummaryVerdictLabel(
  verdict: "REJECTED" | "FAIL" | "INCUBATE" | "WATCH" | "ROBUST"
): "DO NOT DEPLOY" | "CAUTION" | "ROBUST" {
  if (verdict === "REJECTED" || verdict === "FAIL") return "DO NOT DEPLOY";
  if (verdict === "ROBUST") return "ROBUST";
  return "CAUTION";
}

export function runSummaryBlockEngine(
  data: TestResultDataLike,
  finalVerdictLabel?: "DO NOT DEPLOY" | "CAUTION" | "ROBUST"
): SummaryBlockResult {
  const wfa = data.walkForwardAnalysis;
  const turnover = data.turnoverAndCostDrag as Record<string, unknown> | undefined;
  const benchmark = (data.benchmarkComparison ?? null) as Record<string, unknown> | null;
  const risk = data.riskAnalysis as Record<string, unknown> | undefined;
  const proMetrics = (data.proBenchmarkMetrics ?? null) as Record<string, unknown> | null;
  const oosWindowCountFromRisk = risk?.oosWindowCount as number | undefined;

  const checks: DiagnosticCheck[] = [];

  const c1 = checkAlphaInversion(wfa ?? undefined, oosWindowCountFromRisk);
  if (c1) checks.push(c1);
  const c2 = checkLogicParalysis(wfa ?? undefined);
  if (c2) checks.push(c2);
  const c3 = checkExecutionBleed(turnover ?? null, benchmark);
  if (c3) checks.push(c3);
  const c4 = checkBiasDetection(risk ?? null, benchmark);
  if (c4) checks.push(c4);
  const c5 = checkRegimeMismatch(proMetrics);
  if (c5) checks.push(c5);
  const c6 = checkFatTailRisk(risk ?? null);
  if (c6) checks.push(c6);
  const c7 = checkStabilityDecay(proMetrics, wfa ?? undefined);
  if (c7) checks.push(c7);

  const operationalLines: string[] = [];
  const statisticalLines: string[] = [];
  const integrityLines: string[] = [];
  const recommendationLines: string[] = [];
  const actionPlans = new Set<string>();

  for (const c of checks) {
    if (c.severity > 0.5) actionPlans.add(c.actionPlan);
    if (c.moduleId === "executionBleed") operationalLines.push(c.message);
    else if (
      c.moduleId === "alphaInversion" ||
      c.moduleId === "logicParalysis" ||
      c.moduleId === "stabilityDecay" ||
      c.moduleId === "regimeMismatch" ||
      c.moduleId === "fatTailRisk"
    ) statisticalLines.push(c.message);
    else if (c.moduleId === "biasDetection") integrityLines.push(c.message);
  }

  if (actionPlans.size > 0) {
    recommendationLines.push(...Array.from(actionPlans));
  }

  const criticalSeverity = checks.some((c) => c.severity > 0.5);
  const allocatable = !criticalSeverity;
  const verdictLabel =
    finalVerdictLabel ?? (allocatable ? "PASS / INCUBATE" : "REJECT");
  const allocatableLine = allocatable
    ? "Current model may be allocatable with limits."
    : "Current model is Not Allocatable.";

  const recommendationText =
    recommendationLines.length > 0
      ? `${recommendationLines.join(". ")}. ${allocatableLine}`
      : allocatableLine;

  const parts: string[] = [];
  parts.push(`[Diagnostic Verdict: ${verdictLabel}]`);
  if (operationalLines.length > 0) parts.push(`Operational: ${operationalLines.join(" ")}`);
  if (statisticalLines.length > 0) parts.push(`Statistical: ${statisticalLines.join(" ")}`);
  if (integrityLines.length > 0) parts.push(`Integrity: ${integrityLines.join(" ")}`);
  parts.push(`Recommendation: ${recommendationText}`);

  const executiveSummaryParagraph = parts.join("\n");

  return {
    checks,
    operationalLines,
    statisticalLines,
    integrityLines,
    recommendationLines,
    executiveSummaryParagraph,
    allocatable,
  };
}
