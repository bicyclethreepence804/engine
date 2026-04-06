/**
 * Final Verdict Engine - case classification and deployment gate.
 */

import type { TestResultDataLike, WalkForwardAnalysis } from "./analysisReportTypes";
import {
  getSummaryVerdictLabel,
  runSummaryBlockEngine,
  type SummaryBlockResult,
} from "./summaryBlockEngine";

export const VERDICT_ALGORITHM_VERSION = 1;

export type CaseType =
  | "OVER_OPTIMIZED_GRID"
  | "COMMISSION_SINK"
  | "BLACK_SWAN_MAGNET"
  | "STATISTICAL_GHOST"
  | "FADING_EDGE"
  | "BETA_RIDER"
  | "LIQUIDITY_VICTIM"
  | "FRAGILE_GENIUS"
  | "PURE_ALPHA"
  | "SLOW_STEADY_TORTOISE"
  | "NEUTRAL_INCUBATE";

export type VerdictSeverity = "REJECTED" | "FAIL" | "INCUBATE" | "WATCH" | "ROBUST";

export interface DeploymentGateItem {
  label: string;
  gateType: "hard" | "confidence";
  passed: boolean | null;
  value?: number | null;
  threshold?: number;
  unit?: string;
  isEstimated?: boolean;
  notApplicable?: boolean;
  notApplicableReason?: string;
  blockReason?: string;
}

export interface FinalVerdictResult {
  caseType: CaseType;
  verdict: VerdictSeverity;
  badge: "🔴" | "🟡" | "🟢";
  caseDisplayName: string;
  successProbability?: number;
  bottomLine: string;
  executiveSummary: string;
  criticalFailures: string[];
  recommendedAction: string;
  robustnessScore: number;
  deploymentGate: DeploymentGateItem[];
  scenarioTable?: Array<{
    scenario: string;
    robustness: number;
    verdict: string;
    action: string;
    category?: string;
  }>;
  diagnosticSummary?: SummaryBlockResult;
  executionWarning?: string;
  slippageScenarios?: Array<{
    label: string;
    slippageBps: number;
    impactedScore: number;
    verdict: string;
    isDead?: boolean;
  }>;
  operationalInsight?: string;
  version?: number;
  whatIfNote?: string;
  bayesianPassProbability?: number;
  slippageScenariosUnavailableReason?: "negative_edge" | "insufficient_data";
}

const CASE_DISPLAY_NAMES: Record<CaseType, string> = {
  STATISTICAL_GHOST: "The Statistical Ghost",
  COMMISSION_SINK: "The Commission Sink",
  FRAGILE_GENIUS: "The Fragile Genius",
  BLACK_SWAN_MAGNET: "The Black Swan Magnet",
  PURE_ALPHA: "The Pure Alpha",
  BETA_RIDER: "The Beta Rider",
  FADING_EDGE: "The Fading Edge",
  LIQUIDITY_VICTIM: "The Liquidity Victim",
  OVER_OPTIMIZED_GRID: "The Over-Optimized Grid",
  SLOW_STEADY_TORTOISE: "The Slow Steady Tortoise",
  NEUTRAL_INCUBATE: "Neutral / Incubate",
};

function parsePeriodMonths(start?: string, end?: string): number {
  if (!start || !end) return 48;
  try {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 48;
    return Math.max(1, (e - s) / (1000 * 60 * 60 * 24 * 30.44));
  } catch {
    return 48;
  }
}

type DataLike = TestResultDataLike & {
  turnoverAndCostDrag?: Record<string, unknown> | null;
  riskAnalysis?: Record<string, unknown> | null;
  benchmarkComparison?: Record<string, unknown> | null;
  proBenchmarkMetrics?: Record<string, unknown> | null;
  capacity?: Record<string, unknown> | null;
  dataQualityGuardResult?: { modules?: Array<{ module: string; verdict: string }> } | null;
};

function classifyStrategy(data: {
  walkForwardAnalysis?: WalkForwardAnalysis | null;
  turnoverAndCostDrag?: Record<string, unknown> | null;
  riskAnalysis?: Record<string, unknown> | null;
  benchmarkComparison?: Record<string, unknown> | null;
  proBenchmarkMetrics?: Record<string, unknown> | null;
  robustnessScore?: { overall?: number } | null;
  capacity?: Record<string, unknown> | null;
  strategy?: { testPeriodStart?: string; testPeriodEnd?: string };
}): CaseType {
  const overfit = data.walkForwardAnalysis?.overfittingRisk;
  const overfittingRisk = (overfit?.score ?? 0) as number;
  const toc = data.turnoverAndCostDrag;
  const avgNetProfitBps = toc?.avgNetProfitPerTradeBps as number | undefined;
  const profitFactorGross = (toc?.profitFactorGross ?? 0) as number;
  const risk = data.riskAnalysis;
  const kurtosis = (risk?.kurtosis ?? 0) as number;
  const skewness = (risk?.skewness ?? 0) as number;
  const bc = data.benchmarkComparison;
  const tStat = (typeof bc?.alphaTStat === "number" && Number.isFinite(bc.alphaTStat)
    ? bc.alphaTStat
    : NaN) as number;
  const correlation = (bc?.correlationToBTC ?? 0) as number;
  const beta = (bc?.betaToBTC ?? 0) as number;
  const maxDrawdown = (risk?.maxDrawdown ?? 0) as number;
  const sharpe = (risk?.sharpeRatio ?? 0) as number;
  const recoveryFactor = (risk?.recoveryFactor ?? 0) as number;
  const wfe = data.walkForwardAnalysis?.wfe ?? 0;
  const pm = data.proBenchmarkMetrics;
  const psi = (pm?.parameterStabilityIndex ?? NaN) as number;
  const edgeHalfLife = (pm?.edgeHalfLife as { days?: number } | undefined)?.days;
  const robustnessOverall = data.robustnessScore?.overall ?? 0;

  const months = parsePeriodMonths(
    data.strategy?.testPeriodStart,
    data.strategy?.testPeriodEnd
  );
  const avgTradesPerMonth = (toc?.avgTradesPerMonth ?? 0) as number;
  const totalTrades = avgTradesPerMonth * months;

  if (overfittingRisk >= 0.8) return "OVER_OPTIMIZED_GRID";
  if (avgNetProfitBps != null && avgNetProfitBps < 0 && profitFactorGross > 1)
    return "COMMISSION_SINK";
  if (kurtosis > 15 && skewness < 0) return "BLACK_SWAN_MAGNET";
  if (tStat < 0.5 || totalTrades < 30) return "STATISTICAL_GHOST";
  if (edgeHalfLife != null && edgeHalfLife < 20) return "FADING_EDGE";
  if (correlation > 0.8 && beta > 1.2) return "BETA_RIDER";
  if (
    (data.capacity?.slippageSensitivity as string) === "HIGH" &&
    robustnessOverall < 50
  ) return "LIQUIDITY_VICTIM";
  if (Number.isFinite(psi) && psi > 0.6 && robustnessOverall > 65)
    return "FRAGILE_GENIUS";
  if (maxDrawdown > -0.05 && sharpe > 1.0 && recoveryFactor > 3)
    return "SLOW_STEADY_TORTOISE";
  if (wfe > 0.6 && tStat > 1.96) return "PURE_ALPHA";
  return "NEUTRAL_INCUBATE";
}

function getVerdictSeverity(caseType: CaseType): VerdictSeverity {
  switch (caseType) {
    case "OVER_OPTIMIZED_GRID":
    case "BLACK_SWAN_MAGNET":
    case "STATISTICAL_GHOST":
      return "REJECTED";
    case "COMMISSION_SINK":
    case "FADING_EDGE":
      return "FAIL";
    case "FRAGILE_GENIUS":
    case "LIQUIDITY_VICTIM":
    case "NEUTRAL_INCUBATE":
      return "INCUBATE";
    case "BETA_RIDER":
      return "WATCH";
    case "PURE_ALPHA":
    case "SLOW_STEADY_TORTOISE":
      return "ROBUST";
    default:
      return "INCUBATE";
  }
}

function computeZScoreFromWfa(data: DataLike): number | null {
  const risk = data.riskAnalysis as Record<string, unknown> | undefined;
  const edgeZ = risk?.edgeStabilityZScore;
  if (edgeZ != null && Number.isFinite(edgeZ)) return edgeZ as number;
  const pm = data.proBenchmarkMetrics as Record<string, unknown> | undefined;
  const meanRet = pm?.avgOosMeanReturn as number | undefined;
  const stdRet = pm?.avgOosStdReturn as number | undefined;
  const n = (pm?.windowsCount ?? 0) as number;
  if (
    meanRet != null && Number.isFinite(meanRet) &&
    stdRet != null && Number.isFinite(stdRet) && stdRet > 0 && n >= 2
  ) {
    const tStat = meanRet / (stdRet / Math.sqrt(n));
    return Number.isFinite(tStat) ? tStat : null;
  }
  const windows = data.walkForwardAnalysis?.windows;
  if (Array.isArray(windows) && windows.length >= 2) {
    const returns = windows
      .map((w) => (w as { validationReturn?: number }).validationReturn)
      .filter((r): r is number => typeof r === "number" && Number.isFinite(r));
    if (returns.length >= 2) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      const std = Math.sqrt(variance);
      if (std > 0) {
        const tStat = mean / (std / Math.sqrt(returns.length));
        return Number.isFinite(tStat) ? tStat : null;
      }
    }
  }
  const dist = data.walkForwardAnalysis?.distribution as { validationReturns?: number[] } | undefined;
  const distReturns = dist?.validationReturns;
  if (Array.isArray(distReturns) && distReturns.length >= 2) {
    const returns = distReturns.filter((r): r is number => typeof r === "number" && Number.isFinite(r));
    if (returns.length >= 2) {
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      const std = Math.sqrt(variance);
      if (std > 0) {
        const tStat = mean / (std / Math.sqrt(returns.length));
        return Number.isFinite(tStat) ? tStat : null;
      }
    }
  }
  return null;
}

function getBadge(verdict: VerdictSeverity): "🔴" | "🟡" | "🟢" {
  if (verdict === "REJECTED" || verdict === "FAIL") return "🔴";
  if (verdict === "INCUBATE" || verdict === "WATCH") return "🟡";
  return "🟢";
}

const CASE_TEXTS: Record<
  CaseType,
  { bottomLine: string; executiveSummary: string; criticalFailures: string[]; recommendedAction: string }
> = {
  OVER_OPTIMIZED_GRID: { bottomLine: "Classic overfitting - model memorized historical noise.", executiveSummary: "The model has learned random patterns that do not repeat out-of-sample. In-sample performance is misleading; validation shows significant degradation.", criticalFailures: ["Overfitting risk above 0.8 - model fitted to noise.", "Sharp drop from IS to OOS performance indicates memorization."], recommendedAction: "DO NOT DEPLOY. Simplify the model, reduce the number of parameters, and increase walk-forward windows." },
  COMMISSION_SINK: { bottomLine: "Strategy feeds the exchange - net edge is negative.", executiveSummary: "Gross profit factor appears positive, but execution costs erode all edge. Net profit per trade is insufficient to cover exchange fees and slippage.", criticalFailures: ["Avg Net Profit per trade is negative - costs exceed gross edge.", "Execution buffer fails - cannot sustain real-world costs."], recommendedAction: "DO NOT DEPLOY. Reduce trading frequency, move to higher timeframes, or switch to Maker-only execution." },
  BLACK_SWAN_MAGNET: { bottomLine: "Rare but catastrophic drawdowns - tail risk will wipe capital.", executiveSummary: "Distribution shows heavy tails and negative skew. Strategy collects cents in front of a steamroller - one severe trade can destroy the account.", criticalFailures: ["Kurtosis > 15 indicates fat tails.", "Negative skewness - losses cluster in extreme events."], recommendedAction: "DO NOT DEPLOY. Address tail risk: tighten stops, reduce position size, or avoid strategies with convex payoff dependence." },
  STATISTICAL_GHOST: { bottomLine: "Statistically insignificant - result could be luck.", executiveSummary: "Too few trades or low t-Statistic means the observed performance may be random. No robust statistical evidence of alpha.", criticalFailures: ["t-Stat < 0.5 - alpha is not statistically significant.", "Insufficient trade count for reliable inference."], recommendedAction: "DO NOT DEPLOY. Extend test period or increase sample size before any deployment decision." },
  FADING_EDGE: { bottomLine: "Alpha decay - market inefficiency is disappearing.", executiveSummary: "Edge half-life is short; performance decays window-to-window. The market has likely arbitraged away the opportunity.", criticalFailures: ["Edge half-life < 20 days - alpha decays quickly.", "WFA trend declining across windows."], recommendedAction: "FAIL - Do not deploy. Return to research. Seek alternative alpha sources or adapt logic to regime shifts." },
  BETA_RIDER: { bottomLine: "No alpha - just leveraged BTC exposure with extra costs.", executiveSummary: "High correlation and beta to BTC with negative or near-zero alpha. Strategy behaves like leveraged buy-and-hold with added fees.", criticalFailures: ["Correlation > 0.8 and Beta > 1.2 - market-dependent.", "Alpha (excess return) is non-positive."], recommendedAction: "WATCH - Deploy only if intentional. Simpler to hold BTC. Monitor for regime shifts." },
  LIQUIDITY_VICTIM: { bottomLine: "Scale-limited - works at $10k, fails at $100k.", executiveSummary: "Strategy is suitable for small capital but degrades rapidly with scale. Slippage and market impact erode returns at higher AUM.", criticalFailures: ["Slippage sensitivity: HIGH.", "Capacity collapse at moderate AUM."], recommendedAction: "INCUBATE - Suitable for pocket-sized bot only. Do not scale without re-validation." },
  FRAGILE_GENIUS: { bottomLine: "Profitable but sits on a narrow parameter peak.", executiveSummary: "Robustness score is decent, but parameter stability index indicates fragility. Small parameter shifts can collapse performance.", criticalFailures: ["PSI > 0.6 - parameters drift across windows.", "High sensitivity on key parameters."], recommendedAction: "INCUBATE - Extend paper trading. Revalidate after regime change. Consider wider parameter margins." },
  PURE_ALPHA: { bottomLine: "Stable alpha transfer - high confidence deployment.", executiveSummary: "Strategy shows consistent out-of-sample performance, statistically significant alpha, and low market correlation. Suitable for deployment.", criticalFailures: [], recommendedAction: "Deploy within recommended allocation. Monitor WFE and slippage." },
  SLOW_STEADY_TORTOISE: { bottomLine: "Low-risk foundation - boring but robust.", executiveSummary: "Low drawdown, high recovery factor, and solid Sharpe. Ideal as a portfolio anchor. Modest returns but iron-clad risk profile.", criticalFailures: [], recommendedAction: "Deploy as portfolio foundation. Suitable for levered allocation." },
  NEUTRAL_INCUBATE: { bottomLine: "Insufficient evidence - needs more validation.", executiveSummary: "Strategy did not clearly fail critical filters but also did not meet high-confidence criteria. Requires extended paper trading.", criticalFailures: [], recommendedAction: "INCUBATE - Extend paper trading. Re-run WFA after additional data." },
};

const DATA_QUALITY_GATE_RECOMMENDED_DAYS = 730;

export function computeFinalVerdict(data: DataLike): FinalVerdictResult {
  const caseType = classifyStrategy({
    walkForwardAnalysis: data.walkForwardAnalysis,
    turnoverAndCostDrag: data.turnoverAndCostDrag ?? null,
    riskAnalysis: data.riskAnalysis ?? null,
    benchmarkComparison: data.benchmarkComparison ?? null,
    proBenchmarkMetrics: data.proBenchmarkMetrics ?? null,
    robustnessScore: data.robustnessScore ?? null,
    capacity: data.capacity ?? null,
    strategy: data.strategy,
  });
  const robustnessScore = data.robustnessScore?.overall ?? 0;
  const blockedByModule = data.robustnessScore?.blockedByModule;
  const blockedByModules = data.robustnessScore?.blockedByModules as string[] | undefined;
  const dataQualityBlocked =
    (Array.isArray(blockedByModules) && blockedByModules.includes("dataQuality")) || blockedByModule === "dataQuality";
  const scoreBlocked = robustnessScore === 0 || Boolean(blockedByModule) || (Array.isArray(blockedByModules) && blockedByModules.length > 0);

  let verdict = getVerdictSeverity(caseType);
  let badge = getBadge(verdict);
  const texts = CASE_TEXTS[caseType];
  const caseDisplayName = CASE_DISPLAY_NAMES[caseType];
  if (scoreBlocked) {
    verdict = dataQualityBlocked ? "FAIL" : "REJECTED";
    badge = getBadge(verdict);
  }

  const bc = data.benchmarkComparison as Record<string, unknown> | undefined;
  const toc = data.turnoverAndCostDrag as Record<string, unknown> | undefined;
  const tStat = (typeof bc?.alphaTStat === "number" && Number.isFinite(bc.alphaTStat) ? bc.alphaTStat : NaN) as number;
  const avgNetProfitBps = toc?.avgNetProfitPerTradeBps as number | undefined;
  const robustNetEdgeBps = toc?.robustNetEdgeBps as number | undefined;
  const dqgModules = data.dataQualityGuardResult?.modules ?? [];
  const outlierModule = dqgModules.find((m) => m.module === "Outlier Influence");
  const useRobustNetEdge = (outlierModule?.verdict === "REJECT" || outlierModule?.verdict === "FAIL") && robustNetEdgeBps != null && Number.isFinite(robustNetEdgeBps);
  const netEdgeForGate = useRobustNetEdge ? robustNetEdgeBps! : (avgNetProfitBps ?? 0);
  const benchmarkNetEdgeBps = (data.benchmarkComparison as { netEdgeBps?: number } | undefined)?.netEdgeBps;
  const canonicalNetEdgeNegative = benchmarkNetEdgeBps != null && Number.isFinite(benchmarkNetEdgeBps) && benchmarkNetEdgeBps < 0;
  const executionBufferPassed = canonicalNetEdgeNegative ? false : netEdgeForGate > 15;
  const executionBufferValue = canonicalNetEdgeNegative ? benchmarkNetEdgeBps : netEdgeForGate;
  const executionBufferIsPeriodLevel = canonicalNetEdgeNegative && benchmarkNetEdgeBps != null;
  const executionIsEstimated = toc?.executionIsEstimated === true;
  const wfeRaw = data.walkForwardAnalysis?.wfe;
  const wfeValidWindowCount = (data.proBenchmarkMetrics as { wfeValidWindowCount?: number } | undefined)?.wfeValidWindowCount;
  const wfeNA = wfeRaw === undefined && (wfeValidWindowCount === 0 || wfeValidWindowCount == null);
  const wfe = wfeNA ? 0 : (wfeRaw ?? 0);
  const zScore = computeZScoreFromWfa(data);
  const tNorm = Math.min(1, Math.max(0, (tStat + 1) / 3));
  const wfeNorm = Math.min(1, Math.max(0, wfe));
  const successProbability = Math.round(tNorm * 50 + wfeNorm * 50);
  const pm = data.proBenchmarkMetrics as { wfaPassProbability?: number } | undefined;
  const wfaPassProb = pm?.wfaPassProbability;
  const bayesianPassProbability = wfaPassProb != null && Number.isFinite(wfaPassProb) ? Math.round(Math.max(0, Math.min(1, wfaPassProb)) * 100) : undefined;

  const deploymentGate: DeploymentGateItem[] = [
    { label: "Statistical Significance (t-Stat > 1.96)", gateType: "confidence", passed: tStat > 1.96, value: tStat, threshold: 1.96, unit: "", ...(tStat <= 1.96 ? { blockReason: "t-Stat below 1.96 (insufficient statistical significance). Threshold 1.96 approximates two-tailed a=0.05; for small N use t-distribution (stricter)." } : {}) },
    { label: useRobustNetEdge ? "Execution Buffer - Net Edge (Robust, excl. top trade) > 15 bps" : executionBufferIsPeriodLevel ? "Execution Buffer - Net Edge (Net Profit > 15 bps, period-level)" : "Execution Buffer - Net Edge (Net Profit > 15 bps)", gateType: "hard", passed: executionBufferPassed, value: executionBufferValue ?? null, threshold: 15, unit: "bps", isEstimated: executionIsEstimated, ...(!executionBufferPassed ? { blockReason: "Net edge below 15 bps or edge deficit after fees" } : {}) },
    wfeNA
      ? { label: "Stability (WFE > 0.5)", gateType: "hard", passed: null, value: null, threshold: 0.5, unit: "", notApplicable: true, notApplicableReason: "N/A (insufficient IS>0 windows)" }
      : { label: "Stability (WFE > 0.5)", gateType: "hard", passed: wfe > 0.5, value: wfe, threshold: 0.5, unit: "", ...(wfe <= 0.5 ? { blockReason: "WFE below 0.5 (OOS/IS ratio too low)" } : {}) },
  ];

  const oosWindowCount = (data.riskAnalysis as { oosWindowCount?: number } | undefined)?.oosWindowCount;
  const singleOosWindow = oosWindowCount === 1;
  if (zScore != null) {
    deploymentGate.push({
      label: "t-Stat (OOS Edge) > 2.0 (same metric as above, stricter threshold)",
      gateType: "confidence",
      passed: zScore > 2.0,
      value: zScore,
      threshold: 2.0,
      unit: "",
      ...(zScore <= 2.0 ? { blockReason: singleOosWindow ? "t-Stat below 2.0 (OOS edge not significant). Same metric as Statistical Significance; 2.0 is stricter than 1.96. Single OOS window - interpret with caution." : "t-Stat below 2.0 (OOS edge not significant). Same metric as Statistical Significance gate; threshold 2.0 is stricter than 1.96." } : {}),
    });
  }

  const dataRangeDays = (data as Record<string, unknown>).dataRangeDays as number | undefined;
  const dataQualityGuardPassed = (dataRangeDays ?? 0) >= DATA_QUALITY_GATE_RECOMMENDED_DAYS;
  deploymentGate.push({
    label: "Data Quality Guard (test period ≥ 2 years)",
    gateType: "hard",
    passed: dataQualityGuardPassed,
    value: dataRangeDays ?? 0,
    threshold: DATA_QUALITY_GATE_RECOMMENDED_DAYS,
    unit: "days",
    ...(!dataQualityGuardPassed ? { blockReason: "Insufficient test period or DQG module failed" } : {}),
  });

  const failedHardGates = deploymentGate.filter((g) => g.gateType === "hard" && g.passed === false);
  const failedHardGatesPhrase = failedHardGates.length > 0 ? failedHardGates.map((g) => g.label).join("; ") : "one or more hard gates";
  const blockedByPeriodOnly = dataQualityBlocked && (dataRangeDays ?? 0) < DATA_QUALITY_GATE_RECOMMENDED_DAYS;
  const criticalFailures = dataQualityBlocked
    ? [blockedByPeriodOnly ? "Data Quality Guard failed (insufficient test period). Overall verdict: Reject." : "Data Quality Guard failed (Sampling / trade count or other module). Overall verdict: Reject.", ...texts.criticalFailures]
    : scoreBlocked
      ? [`Deployment is blocked because the following hard gate(s) failed: ${failedHardGatesPhrase}.`, ...texts.criticalFailures]
      : texts.criticalFailures;
  const richData = (dataRangeDays ?? 0) >= DATA_QUALITY_GATE_RECOMMENDED_DAYS && Number.isFinite(wfe) && wfe > 0.5;
  const bottomLine = dataQualityBlocked
    ? blockedByPeriodOnly ? "Data Quality Guard failed - insufficient test period. Overall verdict: Reject." : "Data Quality Guard failed - Sampling or other module (e.g. trade count). Overall verdict: Reject."
    : scoreBlocked
      ? "One or more hard gates failed. DO NOT DEPLOY until blocking modules are fixed."
      : caseType === "NEUTRAL_INCUBATE" && richData
        ? "Did not meet high-confidence criteria; extend paper trading for confirmation."
        : texts.bottomLine;
  const recommendedAction = dataQualityBlocked
    ? blockedByPeriodOnly ? "REJECT - Extend test period to at least 365 days and re-run analysis." : "REJECT - Increase trade count (e.g. lower timeframe or relax filters) and re-run analysis."
    : scoreBlocked
      ? `DO NOT DEPLOY. Address failing hard gate(s): ${failedHardGatesPhrase}. Then re-run analysis.`
      : texts.recommendedAction;

  const scenarioTable: FinalVerdictResult["scenarioTable"] = undefined;
  const diagnosticSummary = runSummaryBlockEngine(
    data as TestResultDataLike,
    getSummaryVerdictLabel(verdict)
  );
  const hasDiagnosticFindings = diagnosticSummary.checks.some((c) => c.severity > 0.5);
  const executiveSummary = hasDiagnosticFindings && diagnosticSummary.executiveSummaryParagraph ? diagnosticSummary.executiveSummaryParagraph : texts.executiveSummary;

  const safetyMargin = toc?.safetyMarginSlippage as number | undefined;
  const breakevenBps = toc?.breakevenSlippageBps as number | undefined;
  const besStatus = toc?.breakevenStatus as string | undefined;
  const hasOperationalInsight = besStatus != null && (besStatus === "EDGE_DEFICIT" ? true : Number.isFinite(safetyMargin) && Number.isFinite(breakevenBps));
  const statusLabel = besStatus === "CRITICAL" ? "Critical" : besStatus === "FRAGILE" ? "Fragile" : besStatus === "ROBUST" ? "Execution-Robust" : besStatus === "EDGE_DEFICIT" ? "Edge Deficit" : "";
  const safetyMarginDisplay = Number.isFinite(safetyMargin) && safetyMargin != null ? Number(safetyMargin).toFixed(1) : "";
  const operationalInsight = hasOperationalInsight && besStatus === "EDGE_DEFICIT"
    ? `Net edge is negative; no slippage headroom. Status: ${statusLabel}.`
    : hasOperationalInsight
      ? `Strategy has a Safety Margin of ${safetyMarginDisplay}x. It can withstand a slippage increase up to ${Math.round(breakevenBps ?? 0)} bps before losing all alpha. Status: ${statusLabel}.`
      : undefined;

  const baseScore = data.robustnessScore?.overall;
  const potentialOverall = data.robustnessScore?.potentialOverall;
  const grossEdgeBps = toc?.grossEdgeBps as number | undefined;
  const breakevenSlippageBps = toc?.breakevenSlippageBps as number | undefined;
  const scenarioBps = [0, 5, 15, 30];
  let slippageScenarios: FinalVerdictResult["slippageScenarios"];
  let slippageScenariosUnavailableReason: FinalVerdictResult["slippageScenariosUnavailableReason"];
  const scoreForSlippageTable = baseScore != null && baseScore === 0 && potentialOverall != null && Number.isFinite(potentialOverall) ? potentialOverall : baseScore;
  const canBuildSlippageTable = scoreForSlippageTable != null && Number.isFinite(scoreForSlippageTable) && grossEdgeBps != null && Number.isFinite(grossEdgeBps) && grossEdgeBps > 0;
  if (canBuildSlippageTable) {
    slippageScenarios = scenarioBps.map((slippageBps) => {
      const erosion = slippageBps === 0 ? 0 : Math.min(1, (slippageBps * 2) / grossEdgeBps);
      const impactedScore = Math.max(0, Math.min(100, Math.round(scoreForSlippageTable * (1 - erosion))));
      let verdictLabel: string;
      if (impactedScore >= 61) verdictLabel = "INVESTABLE";
      else if (impactedScore >= 41) verdictLabel = "TUNING";
      else if (impactedScore >= 21) verdictLabel = "FAIL";
      else verdictLabel = "TRASH";
      const isDead = breakevenSlippageBps != null && Number.isFinite(breakevenSlippageBps) && slippageBps >= breakevenSlippageBps;
      const label = slippageBps === 0 ? "0 bps (ideal)" : `${slippageBps} bps`;
      return { label, slippageBps, impactedScore, verdict: verdictLabel, ...(isDead ? { isDead: true } : {}) };
    });
  } else {
    if (grossEdgeBps == null || !Number.isFinite(grossEdgeBps) || grossEdgeBps <= 0) {
      slippageScenariosUnavailableReason = "negative_edge";
    } else {
      slippageScenariosUnavailableReason = "insufficient_data";
    }
  }

  const dqg = data.dataQualityGuardResult as { isCriticalFailure?: boolean } | undefined;
  let whatIfNote: string | undefined;
  if (dqg?.isCriticalFailure === true) {
    whatIfNote = "Note: All execution scenarios result in 0 score because Data Quality (Sampling) is the primary bottleneck. Fix trade count first.";
  } else if (
    robustnessScore === 0 &&
    (blockedByModule ?? (blockedByModules && blockedByModules.length > 0)) &&
    potentialOverall != null &&
    Number.isFinite(potentialOverall)
  ) {
    const trashNote = potentialOverall < 20 ? " Even unblocked, score remains in TRASH range (0-20) - no meaningful improvement." : "";
    whatIfNote = `Robustness score is 0 because a module blocks (e.g. Risk, Execution, or Stability). Potential score if unblocked: ${potentialOverall}. Fix blocking modules first.${trashNote}`;
  }

  return {
    caseType,
    caseDisplayName,
    verdict,
    badge,
    bottomLine,
    executiveSummary,
    criticalFailures,
    recommendedAction,
    robustnessScore,
    successProbability,
    deploymentGate,
    scenarioTable,
    diagnosticSummary,
    executionWarning:
      executionIsEstimated
        ? "Backtest execution settings were missing. The system applied a standard Safety Buffer (0.05% slippage, 0.1% fee). For Institutional Grade (AAA), provide exact exchange API fees and liquidity-based slippage. You can set slippage and commission in your backtest or integration config to use exact values and remove this note."
        : undefined,
    slippageScenarios,
    operationalInsight,
    version: VERDICT_ALGORITHM_VERSION,
    whatIfNote,
    ...(bayesianPassProbability != null && { bayesianPassProbability }),
    ...(slippageScenariosUnavailableReason != null && { slippageScenariosUnavailableReason }),
  };
}
