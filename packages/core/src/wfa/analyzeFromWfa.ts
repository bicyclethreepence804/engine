/**
 * Public WFA entrypoints: analyzeFromWindows, analyzeFromTrades.
 * Orchestrates wfaProfessional plus calculateRobustnessScoreFromWfa with a small **imputed** risk/benchmark
 * envelope when the full product payload is absent (neutral PF / estimated OOS Sharpe from periods only).
 * Narrative, DQG, and kill-switch verdict stay off with explicit BlockResult reasons.
 */

import {
  CONTRACT_VERSION,
  DEFAULT_DECIMALS,
  ENGINE_VERSION,
  FORMULA_VERSION,
  RISK_ANALYSIS_VERSION,
  WFA_PUBLIC_ANALYSIS_SCHEMA_VERSION,
  type AnalyzeConfig,
  type EquityPoint,
  type KiploksWarning,
  type PrecomputedWFAInput,
  type RobustnessScoreFromWfaInput,
  type Trade,
  type TradeBasedWFAInput,
  type WFAAnalysisOutput,
  type WFAWindow,
  type WFEResult,
  KiploksValidationError,
  WFE_PERMUTATION_P_WEAK_THRESHOLD,
} from "@kiploks/engine-contracts";
import { calculateRobustnessScoreFromWfa } from "../robustnessScoreFromWfa";
import { calculateCagr, calculateMaxDrawdown } from "../financialMath";
import { hashCanonical } from "../hash";
import {
  buildProfessionalWfa,
  type NormalizedPeriod,
  type ValidationResult,
} from "../wfaProfessional";
import { MS_PER_MONTH, sliceTradesIntoWindows } from "./windowSlicer";
import { normalizePermutationN } from "./wfeCalculator";

function roundWithDecimals(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function windowsToNormalizedPeriods(windows: WFAWindow[]): NormalizedPeriod[] {
  return windows.map((w) => ({
    optimizationReturn: w.inSample.return,
    validationReturn: w.outOfSample.return,
    parameters: w.parameters ?? {},
    validationMaxDD:
      typeof w.outOfSample.maxDrawdown === "number" && Number.isFinite(w.outOfSample.maxDrawdown)
        ? w.outOfSample.maxDrawdown
        : undefined,
  }));
}

function equityPointsToNormalizedCurves(
  equity: EquityPoint[] | undefined,
): Array<{ date: string; value: number }[]> | undefined {
  if (!equity || equity.length < 2) return undefined;
  const sorted = [...equity].sort((a, b) => a.timestamp - b.timestamp);
  const curve = sorted.map((p) => ({
    date: new Date(p.timestamp).toISOString(),
    value: p.value,
  }));
  return [curve];
}

function estimateOosSharpe(periods: NormalizedPeriod[]): number {
  const r = periods.map((p) => p.validationReturn).filter((x) => Number.isFinite(x));
  if (r.length < 2) return 1;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  const std = Math.sqrt(variance);
  return std > 1e-12 ? mean / std : 0;
}

function buildImputedRobustnessInput(periods: NormalizedPeriod[]): RobustnessScoreFromWfaInput {
  const sharpe = estimateOosSharpe(periods);
  return {
    walkForwardAnalysis: {
      periods: periods.map((p) => ({
        optimizationReturn: p.optimizationReturn,
        validationReturn: p.validationReturn,
      })),
      failedWindows: { count: 0, total: periods.length },
    },
    proBenchmarkMetrics: {
      windowsCount: periods.length,
      avgOosSharpe: sharpe,
    },
    riskAnalysis: {
      metrics: { profitFactor: 1.05 },
      sharpeRatio: sharpe,
      recoveryFactor: 0.5,
      kurtosis: 3,
    },
    parameterSensitivity: { parameters: [] },
    turnoverAndCostDrag: { annualTurnover: 5 },
  };
}

function tradeSummaryFromList(trades: Trade[], decimals: number) {
  const totalTrades = trades.length;
  const netProfit = roundWithDecimals(
    trades.reduce((sum, trade) => sum + trade.profit, 0),
    decimals,
  );
  const avgTradeProfit =
    totalTrades > 0 ? roundWithDecimals(netProfit / totalTrades, decimals) : 0;
  return { totalTrades, netProfit, avgTradeProfit };
}

function tradeSummaryFromWindows(windows: WFAWindow[], decimals: number) {
  let eq = 1;
  for (const w of windows) {
    if (Number.isFinite(w.outOfSample.return)) eq *= 1 + w.outOfSample.return;
  }
  const netProfit = roundWithDecimals(eq - 1, decimals);
  return { totalTrades: 0, netProfit, avgTradeProfit: 0 };
}

function collectTradePathWarnings(trades: Trade[], windows: WFAWindow[]): KiploksWarning[] {
  const warnings: KiploksWarning[] = [];
  if (trades.length > 0 && trades.length < 30) {
    warnings.push({
      code: "LOW_TRADE_COUNT",
      block: "wfe",
      message: `Only ${trades.length} trades; WFE and related metrics are less reliable below ~30 trades.`,
    });
  }
  const dirs = new Set(trades.map((t) => t.direction).filter(Boolean));
  if (dirs.size === 1 && trades.length > 0) {
    const d = [...dirs][0];
    warnings.push({
      code: "SINGLE_DIRECTION_ONLY",
      block: "wfe",
      message: `All trades are ${d}; direction mix is not validated.`,
    });
  }
  const sorted = trades
    .filter((t) => t.closeTime != null)
    .sort((a, b) => (a.closeTime as number) - (b.closeTime as number));
  if (sorted.length >= 2) {
    const spanMonths =
      ((sorted[sorted.length - 1].closeTime as number) - (sorted[0].closeTime as number)) /
      MS_PER_MONTH;
    if (spanMonths < 12) {
      warnings.push({
        code: "SHORT_HISTORY",
        block: "wfe",
        message: `History span is about ${spanMonths.toFixed(1)} months; prefer 12+ months for stability views.`,
      });
    }
  }
  return warnings;
}

function collectWindowPathWarnings(windows: WFAWindow[]): KiploksWarning[] {
  const warnings: KiploksWarning[] = [];
  if (windows.length >= 2 && windows.length < 5) {
    warnings.push({
      code: "LOW_WINDOW_COUNT",
      block: "wfe",
      message: `Only ${windows.length} windows; treat WFE/consistency as directional only. Prefer 5+ windows for meaningful inference.`,
    });
  } else if (windows.length < 30) {
    warnings.push({
      code: "LOW_TRADE_COUNT",
      block: "wfe",
      message: `Only ${windows.length} windows; more windows improve reliability.`,
    });
  }
  const starts = windows.map((w) => new Date(w.period.start).getTime());
  const ends = windows.map((w) => new Date(w.period.end).getTime());
  const t0 = Math.min(...starts);
  const t1 = Math.max(...ends);
  const spanMonths = (t1 - t0) / MS_PER_MONTH;
  if (Number.isFinite(spanMonths) && spanMonths < 12) {
    warnings.push({
      code: "SHORT_HISTORY",
      block: "wfe",
      message: `Window span is about ${spanMonths.toFixed(1)} months; prefer 12+ months where possible.`,
    });
  }
  return warnings;
}

function buildBenchmarkBlock(equity: EquityPoint[] | undefined): WFAAnalysisOutput["benchmark"] {
  if (!equity || equity.length < 2) {
    return { available: false, reason: "equity_curve_not_provided" };
  }
  const sorted = [...equity].sort((a, b) => a.timestamp - b.timestamp);
  const v0 = sorted[0].value;
  const v1 = sorted[sorted.length - 1].value;
  const t0 = sorted[0].timestamp;
  const t1 = sorted[sorted.length - 1].timestamp;
  const cagr = calculateCagr(v0, v1, t0, t1);
  const mddPct = calculateMaxDrawdown(sorted.map((p) => ({ balance: p.value })));
  const mddFrac = Number.isFinite(mddPct) ? mddPct / 100 : Number.NaN;
  return {
    available: true,
    data: {
      pointCount: sorted.length,
      cagr: Number.isFinite(cagr) ? cagr : null,
      maxDrawdownFraction: Number.isFinite(mddFrac) ? mddFrac : null,
      firstTimestamp: t0,
      lastTimestamp: t1,
    },
  };
}

function wfeAdvancedToRecord(obj: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

/**
 * Analyze precomputed WFA windows (public contract).
 */
export function analyzeFromWindows(
  input: PrecomputedWFAInput,
  config: AnalyzeConfig = {},
): WFAAnalysisOutput {
  if (!input.windows || input.windows.length < 2) {
    throw new KiploksValidationError(
      "INSUFFICIENT_WINDOWS_FROM_TRADES",
      "Precomputed WFA requires at least 2 windows.",
    );
  }

  const decimals = config.decimals ?? DEFAULT_DECIMALS;
  const seed = config.seed ?? 42;
  const permutationN = normalizePermutationN(config.permutationN);
  const normalizedPeriods = windowsToNormalizedPeriods(input.windows);
  const normalizedCurves = equityPointsToNormalizedCurves(input.equityCurve);

  const validation: ValidationResult = {
    ok: true,
    normalizedPeriods,
    normalizedCurves,
  };

  const built = buildProfessionalWfa(validation, { seed, permutationN });
  if (!built) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      "Professional WFA failed after normalization (unexpected).",
    );
  }

  const { professional, professionalMeta } = built;
  const wfeAdv = professional.wfeAdvanced;
  if (!wfeAdv) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      "WFE block missing from professional WFA output.",
    );
  }

  const robustnessInput = buildImputedRobustnessInput(normalizedPeriods);
  // Public WFA currently computes robustness from the imputed envelope path.
  // Keep this explicit flag so future non-imputed paths can toggle warnings/metadata correctly.
  const isRobustnessScoreImputed = true;
  const robustness = calculateRobustnessScoreFromWfa(robustnessInput);

  const summary = tradeSummaryFromWindows(input.windows, decimals);
  const hashPayload = {
    mode: input.wfaInputMode,
    windows: input.windows,
    equityLen: input.equityCurve?.length ?? 0,
  };
  const inputHash = hashCanonical(hashPayload, decimals);
  const configHash = hashCanonical({ seed, decimals, permutationN }, decimals);

  const paramBlock: WFAAnalysisOutput["parameterStability"] =
    professional.parameterStability && professional.parameterStability.available
      ? { available: true, data: wfeAdvancedToRecord(professional.parameterStability) }
      : { available: false, reason: "parameters_not_provided" };

  const warnings = collectWindowPathWarnings(input.windows);
  if (isRobustnessScoreImputed) {
    warnings.push({
      code: "ROBUSTNESS_SCORE_USES_IMPUTED_DATA",
      block: "robustnessScore",
      message: "robustnessScore is computed with imputed envelope inputs in public WFA mode.",
    });
  }
  if (wfeAdv.permutationPValue >= WFE_PERMUTATION_P_WEAK_THRESHOLD) {
    warnings.push({
      code: "WEAK_STATISTICAL_SIGNIFICANCE",
      block: "wfe",
      message: `WFE permutation p-value = ${wfeAdv.permutationPValue.toFixed(3)} (>= ${WFE_PERMUTATION_P_WEAK_THRESHOLD.toFixed(2)}). Strategy rank WFE may not differ from random OOS shuffles across ${wfeAdv.windowCount} windows.`,
    });
  }

  const out: WFAAnalysisOutput = {
    summary,
    metadata: {
      engineVersion: ENGINE_VERSION,
      formulaVersion: FORMULA_VERSION,
      riskAnalysisVersion: RISK_ANALYSIS_VERSION,
      contractVersion: CONTRACT_VERSION,
      inputHash,
      configHash,
      seed,
      decimals,
      wfaSchemaVersion: WFA_PUBLIC_ANALYSIS_SCHEMA_VERSION,
      wfaInputMode: input.wfaInputMode,
      robustnessScoreImputed: isRobustnessScoreImputed,
    },
    robustnessScore: robustness?.overall,
    wfe: JSON.parse(JSON.stringify(wfeAdv)) as WFEResult,
    consistency: {
      verdict: wfeAdv.verdict,
      compositeScore: wfeAdv.compositeScore,
      rankWfe: wfeAdv.rankWfe,
      permutationPValue: wfeAdv.permutationPValue,
    },
    parameterStability: paramBlock,
    benchmark: buildBenchmarkBlock(input.equityCurve),
    robustnessNarrative: { available: false, reason: "narrative_not_in_public_wfa" },
    dqg: { available: false, reason: "dqg_not_in_public_wfa" },
    killSwitch: { available: false, reason: "kill_switch_verdict_not_in_public_wfa" },
    warnings,
  };

  return out;
}

/**
 * Analyze trades by slicing into pseudo-WFA windows, then delegating to `analyzeFromWindows`.
 */
export function analyzeFromTrades(
  input: TradeBasedWFAInput,
  config: AnalyzeConfig = {},
): WFAAnalysisOutput {
  const trades = input.trades ?? [];
  if (trades.length < 3) {
    throw new KiploksValidationError(
      "INSUFFICIENT_TRADES",
      "Trade-based WFA requires at least 3 trades.",
    );
  }
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    if (t.openTime == null || t.closeTime == null || !Number.isFinite(t.openTime) || !Number.isFinite(t.closeTime)) {
      throw new KiploksValidationError(
        "MISSING_TIMESTAMPS",
        `Trade at index ${i} is missing openTime/closeTime (unix ms) required for analyzeFromTrades.`,
      );
    }
  }

  const windows = sliceTradesIntoWindows(trades, input.windowConfig);
  const winWarnings = collectTradePathWarnings(trades, windows);

  const precomputed: PrecomputedWFAInput = {
    windows,
    wfaInputMode: "precomputed",
    equityCurve: input.equityCurve,
  };

  const result = analyzeFromWindows(precomputed, config);
  const decimals = config.decimals ?? DEFAULT_DECIMALS;
  const tradeSummary = tradeSummaryFromList(trades, decimals);
  const inputHash = hashCanonical(
    {
      mode: input.wfaInputMode,
      trades: input.trades,
      windowConfig: input.windowConfig,
      equityLen: input.equityCurve?.length ?? 0,
    },
    decimals,
  );

  return {
    ...result,
    summary: tradeSummary,
    metadata: {
      ...result.metadata,
      inputHash,
      wfaInputMode: input.wfaInputMode,
    },
    warnings: [
      {
        code: "PSEUDO_WFA_INTERPRETATION",
        block: "wfe",
        message:
          "tradeSlicedPseudoWfa uses period slicing without per-window re-optimization; interpret WFE as pseudo-WFA robustness.",
      },
      ...winWarnings,
      ...result.warnings,
    ],
  };
}
