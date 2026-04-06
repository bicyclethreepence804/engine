import { calculateMean, calculateStdDev, roundTo } from "./financialMath";
import { toDecimalReturn } from "./normalize";

export interface HistoricalDataLike {
  data?: Array<{ close: number; volume: number; timestamp: number }>;
}

export function normalizeRate(value?: number): number {
  return toDecimalReturn(value);
}

export function estimateAdvAndVolatility(historicalData?: HistoricalDataLike | null): {
  advNotional: number;
  dailyVolatility: number;
} {
  if (!historicalData?.data?.length) {
    return { advNotional: Number.NaN, dailyVolatility: Number.NaN };
  }

  const closes = historicalData.data.map((row) => row.close);
  const volumes = historicalData.data.map((row) => row.volume);
  const timestamps = historicalData.data.map((row) => row.timestamp);
  const returns: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (!Number.isFinite(prev) || prev === 0 || !Number.isFinite(curr)) continue;
    returns.push((curr - prev) / prev);
  }

  const mean = calculateMean(returns);
  const std = calculateStdDev(returns, mean);
  const avgIntervalMs =
    timestamps.length > 1
      ? (timestamps[timestamps.length - 1] - timestamps[0]) / (timestamps.length - 1)
      : 0;
  const stepsPerDay = avgIntervalMs > 0 ? (24 * 60 * 60 * 1000) / avgIntervalMs : Number.NaN;
  const dailyVolatility =
    Number.isFinite(std) && Number.isFinite(stepsPerDay) ? std * Math.sqrt(stepsPerDay) : Number.NaN;

  const totalNotionalVolume = volumes.reduce((sum, vol, idx) => {
    const close = closes[idx];
    if (!Number.isFinite(vol) || !Number.isFinite(close)) return sum;
    return sum + vol * close;
  }, 0);
  const days =
    timestamps.length > 1
      ? (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24)
      : Number.NaN;
  const advNotional =
    Number.isFinite(days) && days > 0 ? totalNotionalVolume / days : Number.NaN;

  return { advNotional, dailyVolatility };
}

export type BreakevenMargin = "Low" | "Medium" | "High";
export type BreakevenStatus = "CRITICAL" | "FRAGILE" | "ROBUST";

export interface BreakevenAssessment {
  slippageBpsPerTrade: number;
  netEdgeBps: number;
  netEdgePositive: boolean;
  breakevenSlippageBps?: number;
  breakevenMargin?: BreakevenMargin;
  breakevenStatus?: BreakevenStatus;
  safetyMarginSlippage?: number;
  breakevenFailureMode?: string;
}

export function assessBreakevenFromTradeEdge(
  avgNetProfitPerTrade: number,
  avgTradeNotional: number,
  slippageRate: number,
  defaultSlippageBps = 5,
): BreakevenAssessment {
  const slippageBpsPerTrade = Number.isFinite(slippageRate) ? slippageRate * 10000 * 2 : Number.NaN;
  const avgNetProfitPerTradeBps =
    Number.isFinite(avgNetProfitPerTrade) &&
    Number.isFinite(avgTradeNotional) &&
    avgTradeNotional > 0
      ? (avgNetProfitPerTrade / avgTradeNotional) * 10000
      : Number.NaN;
  const netEdgeBps = Number.isFinite(avgNetProfitPerTradeBps)
    ? avgNetProfitPerTradeBps - (Number.isFinite(slippageBpsPerTrade) ? slippageBpsPerTrade : 0)
    : Number.NaN;

  const netEdgePositive = Number.isFinite(netEdgeBps) && netEdgeBps > 0;
  const breakevenSlippageBpsRaw =
    Number.isFinite(avgNetProfitPerTrade) &&
    Number.isFinite(avgTradeNotional) &&
    avgTradeNotional > 0
      ? (avgNetProfitPerTrade / avgTradeNotional) * 10000 / 2
      : Number.NaN;
  const breakevenSlippageBps =
    netEdgePositive && Number.isFinite(breakevenSlippageBpsRaw) ? breakevenSlippageBpsRaw : undefined;
  const breakevenMargin = breakevenSlippageBps == null
    ? undefined
    : breakevenSlippageBps <= 5
      ? "Low"
      : breakevenSlippageBps <= 15
        ? "Medium"
        : "High";
  const breakevenStatus = breakevenSlippageBps == null
    ? undefined
    : breakevenSlippageBps < 5
      ? "CRITICAL"
      : breakevenSlippageBps <= 15
        ? "FRAGILE"
        : "ROBUST";
  const safetyMarginSlippage =
    breakevenSlippageBps != null && breakevenSlippageBps > 0
      ? breakevenSlippageBps / defaultSlippageBps
      : undefined;
  const breakevenFailureMode = breakevenSlippageBps == null
    ? undefined
    : breakevenSlippageBps <= 5
      ? "Spread expansion + adverse fill"
      : breakevenSlippageBps <= 15
        ? "Spread expansion"
        : "Adverse fill";

  return {
    slippageBpsPerTrade,
    netEdgeBps,
    netEdgePositive,
    breakevenSlippageBps,
    breakevenMargin,
    breakevenStatus,
    safetyMarginSlippage,
    breakevenFailureMode,
  };
}

export type TurnoverConfidenceLevel = "Low" | "Medium" | "High";

export type TurnoverDeploymentClass =
  | "Micro-cap / Research-only"
  | "Production-ready"
  | "Incubator";

/** Z threshold for production-ready deployment class (95% one-sided). */
export const TURNOVER_Z_SCORE_PRODUCTION_READY = 1.96;

export function computeTradeReturnZScore(tradeReturnBps: readonly number[]): number {
  const arr = [...tradeReturnBps];
  const tradeMean = calculateMean(arr);
  const tradeStd = calculateStdDev(arr, tradeMean);
  const tradeCount = arr.length;
  return tradeCount > 1 && Number.isFinite(tradeStd) && tradeStd > 0
    ? tradeMean / (tradeStd / Math.sqrt(tradeCount))
    : Number.NaN;
}

export function classifyTurnoverConfidenceLevel(
  zScore: number,
  tradeCount: number,
  avgTradesPerMonth?: number,
): TurnoverConfidenceLevel {
  if (!Number.isFinite(zScore)) return "Low";
  if (tradeCount < 30 || (avgTradesPerMonth ?? 0) < 8) return "Low";
  if (zScore < 0) return "Low";
  const absZ = Math.abs(zScore);
  if (absZ < 1.5) return "Low";
  if (absZ < 2.5) return "Medium";
  return "High";
}

export function formatAvgTradesPerMonthLabel(avgTradesPerMonth?: number): string {
  if (
    Number.isFinite(avgTradesPerMonth) &&
    (avgTradesPerMonth as number) < 1 &&
    (avgTradesPerMonth as number) > 0
  ) {
    return "< 1";
  }
  if (Number.isFinite(avgTradesPerMonth)) return (avgTradesPerMonth as number).toFixed(0);
  return "";
}

export function buildTurnoverConfidenceNote(input: {
  avgTradesPerMonth?: number;
  tradesPerMonthLabel: string;
  confidenceLevel: TurnoverConfidenceLevel;
  zScore: number;
}): string {
  const base =
    Number.isFinite(input.avgTradesPerMonth) && input.tradesPerMonthLabel
      ? `${input.tradesPerMonthLabel} trades/mo, ${input.confidenceLevel.toLowerCase()} signal-to-noise`
      : "Low data density";
  if (Number.isFinite(input.zScore) && input.zScore < 0 && input.confidenceLevel === "Low") {
    return `${base}. Negative Z suggests loss-making; low confidence (small sample).`;
  }
  return base;
}

export function turnoverLowSignificanceCagrDisclaimer(
  confidenceLevel: TurnoverConfidenceLevel,
  avgTradesPerMonth?: number,
): string | undefined {
  return confidenceLevel === "Low" && (avgTradesPerMonth ?? 0) < 2
    ? "Low statistical significance: few trades; Net CAGR is extrapolated and may not be representative."
    : undefined;
}

export function classifyTurnoverDeploymentClass(input: {
  netEdgeBps: number;
  costAdaptability?: "PASS" | "FAIL" | "WARNING";
  zScore: number;
}): TurnoverDeploymentClass {
  const baseOk =
    Number.isFinite(input.netEdgeBps) &&
    input.netEdgeBps > 0 &&
    input.costAdaptability === "PASS";
  if (!baseOk) return "Micro-cap / Research-only";
  if (
    Number.isFinite(input.zScore) &&
    input.zScore >= TURNOVER_Z_SCORE_PRODUCTION_READY
  ) {
    return "Production-ready";
  }
  return "Incubator";
}

/**
 * Win rate sensitivity: % drop in expected profit when win rate is stressed by -5 percentage points.
 * Returns 0-100; API consumers often divide by 100 and cap at 1.
 */
export function computeWinRateSensitivityPct(tradeReturnBps: readonly number[]): number {
  const arr = [...tradeReturnBps];
  const wins = arr.filter((v) => v > 0);
  const lossesAbs = arr.filter((v) => v < 0).map((v) => Math.abs(v));
  const avgWinBps = wins.length > 0 ? calculateMean(wins) : Number.NaN;
  const avgLossBps = lossesAbs.length > 0 ? calculateMean(lossesAbs) : Number.NaN;
  const winRateFromTrades = arr.length > 0 ? wins.length / arr.length : Number.NaN;
  if (
    !Number.isFinite(winRateFromTrades) ||
    !Number.isFinite(avgWinBps) ||
    !Number.isFinite(avgLossBps) ||
    winRateFromTrades <= 0
  ) {
    return Number.NaN;
  }
  const wr = winRateFromTrades;
  const baseProfitBps = wr * avgWinBps - (1 - wr) * avgLossBps;
  if (baseProfitBps <= 0) return Number.NaN;
  const winRateStressed = Math.max(0, wr - 0.05);
  const stressedProfitBps =
    winRateStressed * avgWinBps - (1 - winRateStressed) * avgLossBps;
  const drop = (baseProfitBps - stressedProfitBps) / baseProfitBps;
  return Math.max(0, Math.min(drop * 100, 100));
}

/** Participation above this at a scenario AUM flags slippage sensitivity row as out of range. */
export const TURNOVER_PARTICIPATION_GATE = 0.15;

/** Minimum trades to report alpha half-life from WFA validation returns. */
export const MIN_TRADES_FOR_ALPHA_HALFLIFE = 30;

export const TURNOVER_ZOMBIE_AUM_THRESHOLD = 10_000_000;

export interface WfaPeriodForHalfLife {
  validationReturn?: number;
  validation_return?: number;
  validationStartDate?: string;
  validation_start_date?: string;
  startDate?: string;
  start?: string;
  validationEndDate?: string;
  validation_end_date?: string;
  endDate?: string;
  end?: string;
}

export function computeAlphaHalfLifeDays(input: {
  totalTrades: number;
  dateRangeDays: number;
  periods: readonly WfaPeriodForHalfLife[];
  minTrades?: number;
}): number {
  const minTrades = input.minTrades ?? MIN_TRADES_FOR_ALPHA_HALFLIFE;
  if (input.totalTrades < minTrades) return Number.NaN;
  const periods = input.periods;
  if (periods.length === 0) return Number.NaN;
  const validationReturns = periods
    .map((p) => p.validationReturn ?? p.validation_return)
    .filter((v) => Number.isFinite(v)) as number[];
  const avgOosDaysRaw =
    periods.reduce<number>((sum, p) => {
      const startStr = p.validationStartDate ?? p.validation_start_date ?? p.startDate ?? p.start ?? "";
      const endStr = p.validationEndDate ?? p.validation_end_date ?? p.endDate ?? p.end ?? "";
      const start = new Date(String(startStr || 0)).getTime();
      const end = new Date(String(endStr || 0)).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
      return sum + (end - start) / (1000 * 60 * 60 * 24);
    }, 0) / periods.length;
  const avgOosDays =
    Number.isFinite(avgOosDaysRaw) && avgOosDaysRaw > 0
      ? avgOosDaysRaw
      : Number.isFinite(input.dateRangeDays) && input.dateRangeDays > 0
        ? input.dateRangeDays / periods.length
        : Number.NaN;
  if (validationReturns.length === 0)
    return Number.isFinite(avgOosDays) ? avgOosDays : Number.NaN;
  const absSeries = validationReturns.map((v) => Math.abs(v));
  const base = absSeries.find((v) => v > 0) ?? absSeries[0];
  if (!Number.isFinite(base) || base === 0)
    return Number.isFinite(avgOosDays) ? avgOosDays : Number.NaN;
  const target = base * 0.5;
  const idx = absSeries.findIndex((v) => v <= target);
  if (idx <= 0) return Number.isFinite(avgOosDays) ? avgOosDays * absSeries.length : Number.NaN;
  return Number.isFinite(avgOosDays) ? avgOosDays * idx : Number.NaN;
}

export function turnoverAlphaHalfLifeDisclaimer(
  alphaHalfLifeDays: number,
  avgTradesPerMonth?: number,
): string | undefined {
  if (
    Number.isFinite(alphaHalfLifeDays) &&
    alphaHalfLifeDays > 365 &&
    (avgTradesPerMonth ?? 0) > 6
  ) {
    return "Long half-life from WFA validation; high-turnover strategies may have shorter effective decay in practice.";
  }
  return undefined;
}

export function classifyTurnoverPrimaryConstraint(input: {
  grossEdgeNegative: boolean;
  netEdgeBps: number;
  costEdgeRatioPct: number;
  advPortfolioWeightedPct: number;
  limitFillProbabilityPct: number;
}): string {
  if (input.grossEdgeNegative) return "Gross edge negative (alpha-deficit)";
  if (Number.isFinite(input.netEdgeBps) && input.netEdgeBps <= 0) return "Net edge < execution costs";
  if (Number.isFinite(input.costEdgeRatioPct) && input.costEdgeRatioPct >= 40) return "High fee/edge ratio";
  if (Number.isFinite(input.advPortfolioWeightedPct) && input.advPortfolioWeightedPct > 0.5)
    return "Liquidity/ADV constraint";
  if (Number.isFinite(input.limitFillProbabilityPct) && input.limitFillProbabilityPct < 50)
    return "Low fill probability";
  return "Execution friction";
}

export type ControlLeverEffectiveness = "Low" | "Medium" | "High";

export function classifyControlLeverEffectiveness(input: {
  grossEdgeNegative: boolean;
  costEdgeRatioPct: number;
}): ControlLeverEffectiveness {
  if (input.grossEdgeNegative) return "Low";
  if (Number.isFinite(input.costEdgeRatioPct) && input.costEdgeRatioPct >= 40) return "Low";
  if (Number.isFinite(input.costEdgeRatioPct) && input.costEdgeRatioPct >= 20) return "Medium";
  return "High";
}

export function buildTurnoverAvailableControlLevers(
  effectiveness: ControlLeverEffectiveness,
): Array<{ label: string; effectiveness: ControlLeverEffectiveness }> {
  return [
    { label: "Reduce trading frequency", effectiveness },
    { label: "Increase entry threshold (signal strength)", effectiveness },
    { label: "Shift to maker-only execution", effectiveness },
  ];
}

export type SlippageSensitivityRowCore = {
  aum: number;
  status?: "OutOfRange" | "Zombie";
  slippageCagrPct?: number;
  netCagrPct?: number;
};

const DEFAULT_SLIPPAGE_AUM_LADDER = [100_000, 1_000_000, 5_000_000, 10_000_000] as const;

export function computeSlippageSensitivityRows(input: {
  initialBalance: number;
  slippagePct: number;
  netCagrPct: number;
  avgParticipation: number;
  advUtilPct: number;
  participationGate?: number;
  zombieAumThreshold?: number;
  aumLadder?: readonly number[];
}): SlippageSensitivityRowCore[] {
  if (
    !Number.isFinite(input.initialBalance) ||
    input.initialBalance <= 0 ||
    !Number.isFinite(input.slippagePct)
  ) {
    return [];
  }
  const gate = input.participationGate ?? TURNOVER_PARTICIPATION_GATE;
  const zombieTh = input.zombieAumThreshold ?? TURNOVER_ZOMBIE_AUM_THRESHOLD;
  const ladder = input.aumLadder ?? DEFAULT_SLIPPAGE_AUM_LADDER;
  const participationAtRowAum = (aum: number) =>
    Number.isFinite(input.avgParticipation) && input.initialBalance > 0
      ? input.avgParticipation * (aum / input.initialBalance)
      : 0;
  const rowOutOfRange = (aum: number) => participationAtRowAum(aum) > gate;

  return ladder.map((aum) => {
    if (rowOutOfRange(aum)) {
      return {
        aum,
        status: "OutOfRange" as const,
        slippageCagrPct: undefined,
        netCagrPct: undefined,
      };
    }
    const rawScale = Math.sqrt(aum / input.initialBalance);
    const participationAtAum =
      Number.isFinite(input.advUtilPct) && input.advUtilPct > 0
        ? input.advUtilPct * (aum / input.initialBalance)
        : 1;
    const dampen = participationAtAum < 5 ? Math.sqrt(participationAtAum / 5) : 1;
    const scale = 1 + (rawScale - 1) * Math.max(0.1, dampen);
    const slippageAbs = Math.abs(input.slippagePct);
    const scaledSlippage = Math.min(slippageAbs * scale, 100);
    const netCagr = Number.isFinite(input.netCagrPct)
      ? input.netCagrPct - (scaledSlippage - slippageAbs)
      : Number.NaN;
    const status = aum >= zombieTh ? ("Zombie" as const) : undefined;
    return { aum, slippageCagrPct: -scaledSlippage, netCagrPct: netCagr, status };
  });
}

export function buildTurnoverInterpretiveSummary(input: {
  netEdgeBps: number;
  grossEdgeNegative: boolean;
  grossPerTradeBpsInstitutional: number;
  avgNetProfitPerTradeBps: number;
}): string {
  if (!Number.isFinite(input.netEdgeBps)) return "Net edge is not measurable with current inputs.";
  if (input.grossEdgeNegative) {
    const perTradeGrossPositive =
      Number.isFinite(input.grossPerTradeBpsInstitutional) &&
      input.grossPerTradeBpsInstitutional >= 0;
    if (perTradeGrossPositive) {
      return "Period gross is negative (profit factor < 1) but per-trade gross is positive. Strategy loses at calendar level; accumulated costs exceed profit. Required Alpha Boost is execution offset only.";
    }
    return "Gross edge is negative; strategy is loss-making before execution costs (alpha-deficit). Not execution-constrained.";
  }
  if (input.netEdgeBps <= 0)
    return "Net edge fully consumed by execution costs at baseline AUM. Strategy is execution-constrained and non-scalable beyond micro capital.";
  return "Net edge remains positive at baseline AUM with manageable execution drag.";
}

export function buildTurnoverCostDominanceNote(
  exchangeFeesPct?: number,
  slippagePct?: number,
  marketImpactPct?: number,
): string | undefined {
  const fees = Math.abs(exchangeFeesPct ?? Number.NaN);
  const slip = Math.abs(slippagePct ?? Number.NaN);
  const impact = Math.abs(marketImpactPct ?? Number.NaN);
  const max = Math.max(fees, slip, impact);
  if (!Number.isFinite(max) || max === 0) return undefined;
  if (max === fees) return "Fees dominate; slippage is secondary.";
  if (max === slip) return "Slippage dominates; fees are secondary.";
  return "Market impact dominates; fees/slippage are secondary.";
}

/** Required alpha boost (bps) from institutional per-trade gross/net vs cost per trade. */
export function computeRequiredAlphaBoostBps(input: {
  grossPerTradeBpsInstitutional: number;
  avgNetProfitPerTradeBps: number;
  costBpsPerTrade: number;
}): number {
  if (
    Number.isFinite(input.grossPerTradeBpsInstitutional) &&
    input.grossPerTradeBpsInstitutional < 0 &&
    Number.isFinite(input.costBpsPerTrade)
  ) {
    return Math.abs(input.grossPerTradeBpsInstitutional) + input.costBpsPerTrade;
  }
  if (Number.isFinite(input.avgNetProfitPerTradeBps) && input.avgNetProfitPerTradeBps < 0) {
    return Math.abs(input.avgNetProfitPerTradeBps);
  }
  return 0;
}

/** Round alpha half-life for API when trade count threshold met. */
export function formatAlphaHalfLifeDaysForApi(
  totalTrades: number,
  alphaHalfLifeDays: number,
  minTrades?: number,
): number | undefined {
  const min = minTrades ?? MIN_TRADES_FOR_ALPHA_HALFLIFE;
  if (totalTrades >= min && Number.isFinite(alphaHalfLifeDays)) return roundTo(alphaHalfLifeDays, 1);
  return undefined;
}
