/**
 * Turnover and cost drag block: single open implementation for host applications and integrators.
 * Input trades should come from normalizeTradesForTurnover.
 */

import { computeExecutionGrade } from "./executionGrade";
import {
  calculateMean,
  calculateStdDev,
  roundTo,
} from "./financialMath";
import { computeMarketImpactWarnings } from "./marketImpactWarnings";
import type { NormalizedTrade } from "./normalizeTrades";
import {
  assessBreakevenFromTradeEdge,
  buildTurnoverAvailableControlLevers,
  buildTurnoverConfidenceNote,
  buildTurnoverCostDominanceNote,
  buildTurnoverInterpretiveSummary,
  classifyControlLeverEffectiveness,
  classifyTurnoverConfidenceLevel,
  classifyTurnoverDeploymentClass,
  classifyTurnoverPrimaryConstraint,
  computeAlphaHalfLifeDays,
  computeRequiredAlphaBoostBps,
  computeSlippageSensitivityRows,
  computeTradeReturnZScore,
  computeWinRateSensitivityPct,
  estimateAdvAndVolatility,
  formatAlphaHalfLifeDaysForApi,
  formatAvgTradesPerMonthLabel,
  normalizeRate,
  TURNOVER_PARTICIPATION_GATE,
  turnoverAlphaHalfLifeDisclaimer,
  turnoverLowSignificanceCagrDisclaimer,
  type HistoricalDataLike,
  type WfaPeriodForHalfLife,
} from "./turnoverCore";

export interface BacktestResultLike {
  config: {
    initialBalance?: number;
    startDate?: string;
    endDate?: string;
    commission?: number;
    slippage?: number;
  };
  results: {
    totalTrades?: number;
    profitFactor?: number;
    annualizedReturn?: number;
    totalReturn?: number;
  };
  trades: NormalizedTrade[];
}

/** WFA raw shape: periods with validationReturn, validationStartDate, validationEndDate. */
export interface WfaRawLike {
  periods?: Array<{
    validationReturn?: number;
    validationStartDate?: string;
    validationEndDate?: string;
  }>;
}


/** Default execution assumptions when config omits them (Conservative Estimation). */
const DEFAULT_SLIPPAGE = 0.0005; // 5 bps (0.05%) one-way
const DEFAULT_COMMISSION = 0.001; // 10 bps (0.1%) taker
const DEFAULT_SLIPPAGE_BPS = 5;

export interface TurnoverAndCostDragResult {
  baselineAum?: number;
  avgTradesPerMonth?: number;
  annualTurnover?: number;
  avgHoldingTimeHours?: number;
  interpretiveSummary?: string;
  deploymentClass?: string;
  requiredAlphaBoostBps?: number;
  primaryConstraint?: string;
  availableControlLevers?: Array<{ label: string; effectiveness: "Low" | "Medium" | "High" }>;
  confidence?: { zScore?: number; level?: string; note?: string };
  profitFactorGross?: number;
  profitFactorNet?: number;
  costEdgeRatioPct?: number;
  avgNetProfitPerTradeBps?: number;
  /** Average net profit per trade in bps excluding the top (max pnl) trade. Use in Deployment Gate when DQG Outlier is REJECT/FAIL. */
  robustNetEdgeBps?: number;
  breakevenSlippageBps?: number;
  breakevenMargin?: "Low" | "Medium" | "High";
  breakevenStatus?: "CRITICAL" | "FRAGILE" | "ROBUST" | "EDGE_DEFICIT";
  breakevenFailureMode?: string;
  /** BES / default slippage (5 bps). How many times strategy can absorb default slippage before breakeven. */
  safetyMarginSlippage?: number;
  /** True when slippage and/or commission were missing and defaults were applied. Triggers IG penalty and "Estimated" in UI. */
  executionIsEstimated?: boolean;
  /** Source of ADV data: api = from worker/klines; estimated = ADV unavailable, utilization may be null; user_provided = future. */
  advSource?: "api" | "estimated" | "user_provided";
  /** Gross profit per trade in bps (before slippage deduction). Used for What-If slippage scenarios. */
  grossEdgeBps?: number;
  /** Gross edge per trade in bps at institutional turnover (same base as cost and Required Alpha Boost). Use for block consistency. */
  grossEdgePerTradeBpsInstitutional?: number;
  opportunityCostBps?: number;
  adverseSelectionCostBps?: number;
  costDecomposition?: {
    exchangeFeesPct?: number;
    slippagePct?: number;
    marketImpactPct?: number;
    totalCostDragPct?: number;
    rebateCaptureBps?: number;
    /** Rebate as % CAGR (decimal). Same turnover as block: (rebateBps/10000) × annualTurnover (institutional). */
    rebateCaptureCagrPct?: number;
    costDominance?: string;
  };
  /** Set when turnover (holding-based) vs trades×utilization ratio is outside [0.77, 1.3]. */
  turnoverConsistencyWarning?: string;
  /** Cross-check: tradesPerYear × utilizationPct (for display). */
  turnoverFromTradesCrossCheck?: number;
  /** holdingPeriodTurnover / annualTurnover when both finite; >1 suggests overlapping positions. */
  overlapFactor?: number;
  /** Holding-period-based turnover (position velocity). Can overstate when overlapping; reference only. */
  holdingPeriodTurnover?: number;
  /** True when participation ratio > 15% ADV; model out of range, impact not computed (Bug 3+4). */
  marketImpactOutOfRange?: boolean;
  /** Execution data quality tier (Bug 0): simple = estimated fees/slippage; professional = real fee/slippage; institutional = real fee + real ADV. */
  executionGrade?: "simple" | "professional" | "institutional";
  capacity?: {
    alphaMinus10Aum?: number;
    alphaMinus25Aum?: number;
    alphaCollapseAum?: number;
    alphaCollapseNote?: string;
    /** When baseline AUM is large vs ADV; trading at this scale may be infeasible. */
    aumExceedsAdvNote?: string;
  };
  sensitivityToAlphaDecay?: {
    alphaHalfLifeDays?: number;
    winRateSensitivityPct?: number;
    /** When half-life is long and turnover high, WFA-based decay may not reflect short-term strategy. */
    alphaHalfLifeDisclaimer?: string;
  };
  /** Avg trade notional / initial balance (0-1). Explains turnover vs holding time: turnover = utilization * (365.25 / avgHoldingDays). */
  utilizationPct?: number;
  advUtilization?: { top5PairsPct?: number; portfolioWeightedPct?: number };
  marketImpactModel?: { assumption?: string; liquidityRegime?: string };
  slippageSensitivity?: Array<{
    aum: number;
    /** Omitted when model out of range (participation > 15% ADV at this AUM). */
    slippageCagrPct?: number;
    /** Omitted when model out of range (participation > 15% ADV at this AUM). */
    netCagrPct?: number;
    status?: string;
  }>;
  executionHedging?: {
    orderTypeBias?: string;
    takerMakerRatio?: string;
    limitFillProbabilityPct?: number;
    latencySensitivity?: "Low" | "Medium" | "High";
    toxicFlowRisk?: "Low" | "Medium" | "High";
    adverseSelectionNote?: string;
  };
  status?: {
    costAdaptability?: "PASS" | "FAIL" | "WARNING";
    capacityGovernance?: string;
    executionRisk?: string;
  };
  costDrag?: number;
  grossToNetDegradation?: number;
  /** Shown when confidence is Low and trades/mo < 2; host-controlled disclaimer for Net CAGR. */
  lowSignificanceCagrDisclaimer?: string;
  interpretation?: string;
}

export function buildTurnoverAndCostDrag(
  backtestResult: BacktestResultLike,
  historicalData?: HistoricalDataLike | null,
  wfa?: WfaRawLike | null
): TurnoverAndCostDragResult | null {
  const trades = backtestResult.trades || [];
  if (!trades.length) return null;

  const config = backtestResult.config;
  const initialBalance = Number(config.initialBalance) || 0;
  const start = new Date(String(config.startDate || 0)).getTime();
  const end = new Date(String(config.endDate || 0)).getTime();
  const dateRangeDays =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? (end - start) / (1000 * 60 * 60 * 24)
      : NaN;
  const years = Number.isFinite(dateRangeDays) ? dateRangeDays / 365.25 : NaN;

  const totalTrades = backtestResult.results?.totalTrades ?? trades.length;
  const totalTradeNotional = trades.reduce(
    (sum, trade) => sum + Math.abs(trade.price * trade.quantity),
    0
  );
  /** Institutional turnover: min(Purchases, Sales) / AUM, annualized (SEC/Morningstar style). Closer to true capital turnover for cost drag when positions overlap. */
  const buyNotional = trades.reduce(
    (sum, t) => sum + (t.side === "BUY" ? Math.abs(t.price * t.quantity) : 0),
    0
  );
  const sellNotional = trades.reduce(
    (sum, t) => sum + (t.side === "SELL" ? Math.abs(t.price * t.quantity) : 0),
    0
  );
  const minBuySellNotional =
    Number.isFinite(buyNotional) && Number.isFinite(sellNotional) && buyNotional > 0 && sellNotional > 0
      ? Math.min(buyNotional, sellNotional)
      : NaN;
  const institutionalTurnover =
    Number.isFinite(dateRangeDays) &&
    dateRangeDays > 0 &&
    initialBalance > 0 &&
    Number.isFinite(minBuySellNotional) &&
    minBuySellNotional > 0
      ? (minBuySellNotional / initialBalance) * (365.25 / dateRangeDays)
      : NaN;
  const avgTradeNotional = totalTrades > 0 ? totalTradeNotional / totalTrades : NaN;

  const avgTradesPerMonth =
    Number.isFinite(dateRangeDays) && dateRangeDays > 0
      ? totalTrades / (dateRangeDays / 30.44)
      : NaN;

  const holdingTimes: number[] = [];
  const openPositions: Record<string, Array<{ side: "BUY" | "SELL"; time: number }>> = {};
  trades.forEach((trade) => {
    const key = trade.symbol || "default";
    if (!openPositions[key]) openPositions[key] = [];
    if (trade.side !== "BUY" && trade.side !== "SELL") return;
    const oppositeIdx = openPositions[key].findIndex((pos) => pos.side !== trade.side);
    if (oppositeIdx >= 0) {
      const entry = openPositions[key].splice(oppositeIdx, 1)[0];
      const durationHours = (trade.timestamp - entry.time) / (1000 * 60 * 60);
      if (Number.isFinite(durationHours) && durationHours >= 0) {
        holdingTimes.push(durationHours);
      }
    } else {
      openPositions[key].push({ side: trade.side, time: trade.timestamp });
    }
  });
  if (holdingTimes.length === 0 && trades.length > 1) {
    const timestamps = trades
      .map((t) => t.timestamp)
      .filter((ts) => Number.isFinite(ts))
      .sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push((timestamps[i] - timestamps[i - 1]) / (1000 * 60 * 60));
    }
    const avgGapHours =
      gaps.length > 0 ? gaps.reduce((s, v) => s + v, 0) / gaps.length : NaN;
    if (Number.isFinite(avgGapHours) && avgGapHours >= 0) {
      holdingTimes.push(avgGapHours);
    }
  }
  const avgHoldingTimeHours =
    holdingTimes.length > 0
      ? holdingTimes.reduce((s, v) => s + v, 0) / holdingTimes.length
      : NaN;
  const avgHoldingTimeDays = Number.isFinite(avgHoldingTimeHours) ? avgHoldingTimeHours / 24 : NaN;
  const utilizationPct =
    Number.isFinite(avgTradeNotional) && initialBalance > 0
      ? avgTradeNotional / initialBalance
      : NaN;
  const turnoverFromNotional =
    Number.isFinite(dateRangeDays) && dateRangeDays > 0 && initialBalance > 0
      ? (totalTradeNotional / initialBalance) * (365.25 / dateRangeDays)
      : NaN;
  const turnoverFromHolding =
    Number.isFinite(avgHoldingTimeDays) &&
    avgHoldingTimeDays > 0 &&
    Number.isFinite(utilizationPct)
      ? utilizationPct * (365.25 / avgHoldingTimeDays)
      : NaN;
  const tradesPerYear =
    Number.isFinite(dateRangeDays) && dateRangeDays > 0
      ? totalTrades / (dateRangeDays / 365.25)
      : NaN;
  const TURNOVER_CAP_LOW_TRADES = 2;
  /** Primary turnover for cost/rebate/CAGR: institutional only (min(Buy,Sell)/AUM). No fallback; when unavailable, n/a. */
  const annualTurnover = (() => {
    if (!Number.isFinite(institutionalTurnover) || institutionalTurnover <= 0) return NaN;
    if (Number.isFinite(tradesPerYear) && tradesPerYear < 10) {
      return Math.min(institutionalTurnover, TURNOVER_CAP_LOW_TRADES);
    }
    return institutionalTurnover;
  })();

  /** Holding-period-based turnover (position velocity). Can overstate when positions overlap; shown for reference. */
  const holdingPeriodTurnover =
    Number.isFinite(turnoverFromHolding) && turnoverFromHolding > 0 ? turnoverFromHolding : undefined;

  /** Consistency check: institutional vs holding-period. If ratio outside [0.77, 1.3], holding-period likely overstates. */
  const turnoverFromTrades =
    Number.isFinite(tradesPerYear) &&
    Number.isFinite(utilizationPct) &&
    utilizationPct > 0
      ? tradesPerYear * utilizationPct
      : NaN;
  const turnoverConsistencyRatio =
    Number.isFinite(annualTurnover) &&
    Number.isFinite(turnoverFromTrades) &&
    turnoverFromTrades > 0
      ? annualTurnover / turnoverFromTrades
      : NaN;
  /** When position velocity (holding-period) is much higher than institutional turnover, overlapping positions likely. */
  const holdingToInstitutionalRatio =
    Number.isFinite(holdingPeriodTurnover) &&
    Number.isFinite(annualTurnover) &&
    annualTurnover > 0
      ? (holdingPeriodTurnover as number) / annualTurnover
      : NaN;
  const turnoverConsistencyWarning = (() => {
    if (
      Number.isFinite(holdingToInstitutionalRatio) &&
      holdingToInstitutionalRatio > 1.3
    ) {
      return `Position velocity (holding-period) (${Number(holdingPeriodTurnover).toFixed(1)}x) is ${holdingToInstitutionalRatio.toFixed(2)}x institutional turnover (${Number(annualTurnover).toFixed(1)}x). Overlapping positions likely; institutional turnover is used for cost and rebate.`;
    }
    if (
      Number.isFinite(turnoverConsistencyRatio) &&
      (turnoverConsistencyRatio > 1.3 || turnoverConsistencyRatio < 0.77)
    ) {
      return `Institutional turnover (${Number(annualTurnover).toFixed(1)}x) differs from trades×utilization (${Number(turnoverFromTrades).toFixed(1)}x); ratio ${turnoverConsistencyRatio.toFixed(2)}. Trade-count or side semantics may differ. Interpret with caution.`;
    }
    return undefined;
  })();
  const overlapFactorValue =
    Number.isFinite(holdingToInstitutionalRatio) && holdingToInstitutionalRatio >= 1
      ? holdingToInstitutionalRatio
      : turnoverConsistencyRatio;

  const isSlippageMissing =
    config.slippage === undefined || config.slippage === null;
  const isCommissionMissing =
    config.commission === undefined || config.commission === null;
  const rawCommission = normalizeRate(config.commission);
  const rawSlippage = normalizeRate(config.slippage);
  const commissionRate =
    Number.isFinite(rawCommission) ? rawCommission : DEFAULT_COMMISSION;
  const slippageRate =
    Number.isFinite(rawSlippage) ? rawSlippage : DEFAULT_SLIPPAGE;
  const executionIsEstimated = isSlippageMissing || isCommissionMissing;
  const totalCommissionCost = totalTradeNotional * commissionRate * 2;
  const totalSlippageCost = totalTradeNotional * slippageRate * 2;

  const totalNetProfit = trades.reduce((sum, t) => sum + t.pnl, 0);
  const avgNetProfitPerTrade = totalTrades > 0 ? totalNetProfit / totalTrades : NaN;
  const avgNetProfitPerTradeBps =
    Number.isFinite(avgNetProfitPerTrade) &&
    Number.isFinite(avgTradeNotional) &&
    avgTradeNotional > 0
      ? (avgNetProfitPerTrade / avgTradeNotional) * 10000
      : NaN;
  /** Robust Net Edge: average net profit per trade in bps excluding the single top (max pnl) trade. Used when DQG flags outlier so the gate does not show green on outlier-inflated average. */
  let robustNetEdgeBps: number | undefined;
  if (totalTrades >= 2 && Number.isFinite(avgTradeNotional) && avgTradeNotional > 0) {
    const sortedByPnl = [...trades].sort((a, b) => b.pnl - a.pnl);
    const topPnl = sortedByPnl[0]!.pnl;
    const restNetProfit = totalNetProfit - topPnl;
    const restCount = totalTrades - 1;
    const avgRest = restNetProfit / restCount;
    robustNetEdgeBps = (avgRest / avgTradeNotional) * 10000;
    if (!Number.isFinite(robustNetEdgeBps)) robustNetEdgeBps = undefined;
  }
  const breakevenAssessment = assessBreakevenFromTradeEdge(
    avgNetProfitPerTrade,
    avgTradeNotional,
    slippageRate,
    DEFAULT_SLIPPAGE_BPS,
  );
  const netEdgeBps = breakevenAssessment.netEdgeBps;

  const totalCost = totalCommissionCost + totalSlippageCost;
  const grossProfitPerTrade =
    Number.isFinite(avgNetProfitPerTrade) && totalTrades > 0
      ? avgNetProfitPerTrade + totalCost / totalTrades
      : NaN;
  const grossEdgeBps =
    Number.isFinite(grossProfitPerTrade) &&
    Number.isFinite(avgTradeNotional) &&
    avgTradeNotional > 0
      ? (grossProfitPerTrade / avgTradeNotional) * 10000
      : undefined;

  const closedTrades = trades.filter((t) => t.pnl !== 0);
  const grossPnL = closedTrades.map((trade) => {
    const notional = Math.abs(trade.price * trade.quantity);
    const commissionCost = notional * commissionRate;
    return trade.pnl + commissionCost;
  });
  const grossProfit = grossPnL.filter((pnl) => pnl > 0).reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(
    grossPnL.filter((pnl) => pnl < 0).reduce((s, p) => s + p, 0)
  );
  const profitFactorGross = grossLoss > 0 ? grossProfit / grossLoss : NaN;
  const profitFactorNet = backtestResult.results?.profitFactor ?? NaN;
  const grossEdgeNegative =
    Number.isFinite(profitFactorGross) && profitFactorGross < 1;

  const netCagrPctBacktest = Number.isFinite(
    backtestResult.results?.annualizedReturn ?? NaN
  )
    ? (backtestResult.results.annualizedReturn as number)
    : Number.isFinite(years) && years > 0
      ? (backtestResult.results?.totalReturn ?? 0) / years
      : NaN;
  const netCagrPctFromEdge =
    Number.isFinite(netEdgeBps) && Number.isFinite(annualTurnover)
      ? (netEdgeBps / 10000) * annualTurnover * 100
      : NaN;
  const netCagrPct = Number.isFinite(netCagrPctFromEdge)
    ? netCagrPctFromEdge
    : netCagrPctBacktest;
  const annualCostPct =
    Number.isFinite(years) && years > 0 && initialBalance > 0
      ? (totalCost / initialBalance / years) * 100
      : NaN;
  const grossCagrPct =
    Number.isFinite(netCagrPct) && Number.isFinite(annualCostPct)
      ? netCagrPct + annualCostPct
      : NaN;
  const costDrag = Number.isFinite(annualCostPct) ? -annualCostPct : NaN;
  const grossToNetDegradation =
    Number.isFinite(grossCagrPct) &&
    grossCagrPct !== 0 &&
    Number.isFinite(netCagrPct)
      ? ((netCagrPct - grossCagrPct) / Math.abs(grossCagrPct)) * 100
      : NaN;

  /** Cost/Edge: defined only when gross CAGR > 0. When gross is negative, ratio is not meaningful (costs vs negative edge). */
  const costEdgeRatioPct =
    Number.isFinite(annualCostPct) &&
    Number.isFinite(grossCagrPct) &&
    grossCagrPct > 0
      ? (Math.abs(annualCostPct) / grossCagrPct) * 100
      : NaN;

  const netEdgePositive = breakevenAssessment.netEdgePositive;
  const breakevenSlippageBps = breakevenAssessment.breakevenSlippageBps;
  const breakevenMargin = breakevenAssessment.breakevenMargin;
  const breakevenStatus = breakevenAssessment.breakevenStatus;
  const safetyMarginSlippage = breakevenAssessment.safetyMarginSlippage;
  const breakevenStatusFinal =
    breakevenStatus === "ROBUST" &&
    Number.isFinite(costEdgeRatioPct) &&
    costEdgeRatioPct > 100
      ? "FRAGILE"
      : breakevenStatus;
  const breakevenFailureMode = breakevenAssessment.breakevenFailureMode;

  const { advNotional, dailyVolatility } = estimateAdvAndVolatility(historicalData);
  const advFromApi =
    historicalData != null &&
    Number.isFinite(advNotional) &&
    advNotional > 0;
  const executionGrade = computeExecutionGrade(executionIsEstimated, advFromApi);
  const tradeReturnBps = closedTrades
    .map((trade) => {
      const notional = Math.abs(trade.price * trade.quantity);
      if (!Number.isFinite(notional) || notional <= 0) return NaN;
      return (trade.pnl / notional) * 10000;
    })
    .filter((v) => Number.isFinite(v)) as number[];
  const tradeReturnStd =
    tradeReturnBps.length > 1
      ? calculateStdDev(tradeReturnBps, calculateMean(tradeReturnBps)) / 10000
      : NaN;
  const tradesPerDay =
    Number.isFinite(dateRangeDays) && dateRangeDays > 0 ? trades.length / dateRangeDays : NaN;
  const dailyVolatilityResolved =
    Number.isFinite(dailyVolatility) && dailyVolatility > 0
      ? dailyVolatility
      : Number.isFinite(tradeReturnStd) && Number.isFinite(tradesPerDay)
        ? tradeReturnStd * Math.sqrt(tradesPerDay)
        : NaN;
  const advNotionalResolved =
    Number.isFinite(advNotional) && advNotional > 0
      ? advNotional
      : Number.isFinite(totalTradeNotional) &&
          Number.isFinite(dateRangeDays) &&
          dateRangeDays > 0
        ? totalTradeNotional / dateRangeDays
        : NaN;

  let avgParticipation = NaN;
  if (
    Number.isFinite(advNotionalResolved) &&
    advNotionalResolved > 0 &&
    trades.length > 0
  ) {
    let sumParticipation = 0;
    let count = 0;
    for (const trade of trades) {
      const notional = Math.abs(trade.price * trade.quantity);
      if (Number.isFinite(notional) && notional > 0) {
        sumParticipation += notional / advNotionalResolved;
        count += 1;
      }
    }
    avgParticipation = count > 0 ? sumParticipation / count : NaN;
  }

  const marketImpactOutOfRange =
    Number.isFinite(avgParticipation) && avgParticipation > TURNOVER_PARTICIPATION_GATE;

  const impactCoefficient = 0.4;
  const marketImpactCost =
    !marketImpactOutOfRange &&
    Number.isFinite(advNotionalResolved) &&
    advNotionalResolved > 0
      ? trades.reduce((sum, trade) => {
          const notional = Math.abs(trade.price * trade.quantity);
          if (!Number.isFinite(notional) || notional <= 0) return sum;
          const impactPct =
            impactCoefficient *
            (Number.isFinite(dailyVolatilityResolved) ? dailyVolatilityResolved : 0.3) *
            Math.sqrt(notional / advNotionalResolved);
          return sum + notional * impactPct;
        }, 0)
      : NaN;
  let marketImpactPct =
    Number.isFinite(marketImpactCost) &&
    Number.isFinite(years) &&
    years > 0 &&
    initialBalance > 0
      ? -(marketImpactCost / initialBalance / years) * 100
      : NaN;
  if (Number.isFinite(marketImpactPct) && Math.abs(marketImpactPct) > 100) {
    marketImpactPct = marketImpactPct > 0 ? 100 : -100;
  }
  const exchangeFeesPct =
    Number.isFinite(years) && years > 0 && initialBalance > 0
      ? -(totalCommissionCost / initialBalance / years) * 100
      : NaN;
  const slippagePct =
    Number.isFinite(years) && years > 0 && initialBalance > 0
      ? -(totalSlippageCost / initialBalance / years) * 100
      : NaN;
  let totalCostDragPct =
    Number.isFinite(exchangeFeesPct) ||
    Number.isFinite(slippagePct) ||
    Number.isFinite(marketImpactPct)
      ? (Number.isFinite(exchangeFeesPct) ? exchangeFeesPct : 0) +
        (Number.isFinite(slippagePct) ? slippagePct : 0) +
        (Number.isFinite(marketImpactPct) ? marketImpactPct : 0)
      : NaN;
  if (Number.isFinite(totalCostDragPct) && totalCostDragPct < -100) {
    totalCostDragPct = -100;
  }

  const capacityEstimator = (dropPct: number) => {
    if (
      !Number.isFinite(netCagrPct) ||
      !Number.isFinite(initialBalance) ||
      initialBalance <= 0
    )
      return NaN;
    if (netCagrPct <= 0 || !Number.isFinite(marketImpactPct)) return initialBalance;
    const baselineImpactAbs = Math.abs(marketImpactPct);
    const targetCagr = netCagrPct * (1 - dropPct);
    let aum = initialBalance;
    const maxAum = initialBalance * 20;
    while (aum <= maxAum) {
      const scale = Math.sqrt(aum / initialBalance);
      const impactAdj = baselineImpactAbs * scale;
      const netAdj = netCagrPct - (impactAdj - baselineImpactAbs);
      if (netAdj <= targetCagr) return aum;
      aum *= 1.1;
    }
    return NaN;
  };

  let alphaMinus10Aum = capacityEstimator(0.1);
  let alphaMinus25Aum = capacityEstimator(0.25);
  if (
    Number.isFinite(alphaMinus10Aum) &&
    Number.isFinite(alphaMinus25Aum) &&
    (alphaMinus25Aum as number) < (alphaMinus10Aum as number)
  ) {
    const swap = alphaMinus10Aum;
    alphaMinus10Aum = alphaMinus25Aum;
    alphaMinus25Aum = swap;
  }
  const alphaCollapseResult = (() => {
    if (!Number.isFinite(netCagrPct)) {
      return { value: initialBalance, note: "Alpha already collapsed at baseline (net CAGR unavailable)." as string | undefined };
    }
    if (netCagrPct <= 0) {
      return { value: initialBalance, note: "Alpha already collapsed at baseline (net CAGR ≤ 0)." as string | undefined };
    }
    if (!Number.isFinite(marketImpactPct)) {
      return { value: initialBalance, note: "Alpha collapse estimated at baseline (missing ADV/impact data)." as string | undefined };
    }
    const baselineImpactAbs = Math.abs(marketImpactPct);
    let aum = initialBalance;
    const maxAum = initialBalance * 50;
    while (aum <= maxAum) {
      const scale = Math.sqrt(aum / initialBalance);
      const impactAdj = baselineImpactAbs * scale;
      const netAdj = netCagrPct - (impactAdj - baselineImpactAbs);
      if (netAdj <= 0) return { value: aum, note: undefined };
      aum *= 1.1;
    }
    return { value: maxAum, note: "No collapse within modeled range; shown at upper bound." as string | undefined };
  })();
  let alphaCollapseAum = alphaCollapseResult.value;
  if (
    Number.isFinite(alphaCollapseAum) &&
    Number.isFinite(alphaMinus25Aum) &&
    (alphaCollapseAum as number) < (alphaMinus25Aum as number)
  ) {
    alphaCollapseAum = alphaMinus25Aum as number;
  }

  const advUtilization =
    Number.isFinite(advNotional) &&
    advNotional > 0 &&
    Number.isFinite(totalTradeNotional) &&
    Number.isFinite(dateRangeDays)
      ? {
          top5PairsPct: (totalTradeNotional / dateRangeDays / advNotional) * 100,
          portfolioWeightedPct: (totalTradeNotional / dateRangeDays / advNotional) * 100,
        }
      : undefined;

  const advUtilPct = advUtilization?.top5PairsPct ?? advUtilization?.portfolioWeightedPct ?? 0;
  const slippageSensitivity = computeSlippageSensitivityRows({
    initialBalance,
    slippagePct,
    netCagrPct,
    avgParticipation,
    advUtilPct,
  });

  const costAdaptability =
    grossEdgeNegative
      ? "FAIL"
      : Number.isFinite(costEdgeRatioPct)
        ? costEdgeRatioPct < 20
          ? "PASS"
          : costEdgeRatioPct < 40
            ? "WARNING"
            : "FAIL"
        : undefined;
  const capacityGovernance =
    Number.isFinite(alphaMinus10Aum) && alphaMinus10Aum < 100_000
      ? "SCALE-LIMITED"
      : Number.isFinite(alphaMinus25Aum) && alphaMinus25Aum > 1_000_000
        ? "PASS"
        : "WARNING";
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const orderTypeBias = (() => {
    if (Number.isFinite(avgHoldingTimeHours)) {
      if (avgHoldingTimeHours <= 1) return "Taker-dominant";
      if (avgHoldingTimeHours <= 6) return "Mixed";
      return "Limit-biased";
    }
    return "Mixed";
  })();

  const takerMakerRatio =
    orderTypeBias === "Taker-dominant"
      ? "80 / 20"
      : orderTypeBias === "Limit-biased"
        ? "40 / 60"
        : "60 / 40";

  const makerSharePct = (() => {
    const parts = takerMakerRatio.split("/").map((p) => Number(p.trim()));
    if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) return NaN;
    const total = parts[0] + parts[1];
    return total > 0 ? (parts[1] / total) * 100 : NaN;
  })();

  const rebateCaptureBps = Number.isFinite(makerSharePct) ? (makerSharePct / 100) * 0.8 : NaN;
  /** Rebate in % CAGR (decimal) for comparable units. Uses same turnover as block: holding-period (annualTurnover), not trades×utilization. */
  const rebateCaptureCagrPct =
    Number.isFinite(rebateCaptureBps) && Number.isFinite(annualTurnover) && annualTurnover > 0
      ? (rebateCaptureBps / 10000) * annualTurnover
      : undefined;

  const limitFillProbabilityPct = (() => {
    if (!Number.isFinite(dailyVolatilityResolved)) return NaN;
    const vol = Math.abs(dailyVolatilityResolved);
    const base = clamp(1 - vol / 0.1, 0, 1);
    const liquidityPenalty =
      Number.isFinite(advNotionalResolved) && advNotionalResolved < 5_000_000 ? 0.1 : 0;
    return Math.min(clamp(0.3 + base * 0.7 - liquidityPenalty, 0.1, 0.95) * 100, 100);
  })();

  const latencySensitivity = (() => {
    if (!Number.isFinite(avgHoldingTimeHours) || !Number.isFinite(dailyVolatilityResolved))
      return undefined;
    const vol = Math.abs(dailyVolatilityResolved);
    if (avgHoldingTimeHours <= 1 && vol > 0.06) return "High";
    if (avgHoldingTimeHours <= 4 || vol > 0.04) return "Medium";
    return "Low";
  })();

  const toxicFlowRisk = (() => {
    if (!Number.isFinite(dailyVolatilityResolved)) return undefined;
    const vol = Math.abs(dailyVolatilityResolved);
    if (orderTypeBias === "Taker-dominant" && vol > 0.06) return "High";
    if (orderTypeBias === "Taker-dominant" || vol > 0.04) return "Medium";
    return "Low";
  })();

  const adverseSelectionNote = (() => {
    if (!Number.isFinite(dailyVolatilityResolved))
      return "Volatility data unavailable; adverse selection risk not estimated.";
    if (toxicFlowRisk === "High") return "Adverse selection likely at high volatility.";
    if (toxicFlowRisk === "Medium") return "Moderate adverse selection risk in fast markets.";
    return "HFT adverse selection not detected.";
  })();

  const adverseSelectionCostBps = (() => {
    if (!toxicFlowRisk) return NaN;
    if (toxicFlowRisk === "High") return 8;
    if (toxicFlowRisk === "Medium") return 4;
    return 1;
  })();

  const opportunityCostBps =
    Number.isFinite(limitFillProbabilityPct) &&
    Number.isFinite(grossProfitPerTrade) &&
    Number.isFinite(avgTradeNotional) &&
    avgTradeNotional > 0
      ? (grossProfitPerTrade / avgTradeNotional) * 10000 * (1 - limitFillProbabilityPct / 100)
      : NaN;

  const executionRisk = (() => {
    if (toxicFlowRisk === "High" || latencySensitivity === "High") return "HIGH";
    if (toxicFlowRisk === "Medium" || latencySensitivity === "Medium") return "WARNING";
    if (toxicFlowRisk === "Low" && latencySensitivity === "Low") return "CONTROLLED";
    return undefined;
  })();

  /** Cost per trade in bps: derived from Cost Drag and same turnover as Rebate (institutional). costBpsPerTrade = annualCostPct * 100 / annualTurnover so Cost Drag %, Rebate CAGR, and Required Alpha use one base. */
  const costBpsPerTrade =
    Number.isFinite(annualCostPct) &&
    Number.isFinite(annualTurnover) &&
    annualTurnover > 0
      ? (Math.abs(annualCostPct) * 100) / annualTurnover
      : NaN;
  /** Gross edge per trade on same cost base (institutional): net + cost per trade. Used for Required Alpha formula and interpretive summary (per-trade vs period). */
  const grossPerTradeBpsInstitutional =
    Number.isFinite(avgNetProfitPerTradeBps) && Number.isFinite(costBpsPerTrade)
      ? avgNetProfitPerTradeBps + costBpsPerTrade
      : NaN;
  const requiredAlphaBoostBps = computeRequiredAlphaBoostBps({
    grossPerTradeBpsInstitutional,
    avgNetProfitPerTradeBps,
    costBpsPerTrade,
  });

  const interpretiveSummary = buildTurnoverInterpretiveSummary({
    netEdgeBps,
    grossEdgeNegative,
    grossPerTradeBpsInstitutional,
    avgNetProfitPerTradeBps,
  });

  const costDominance = buildTurnoverCostDominanceNote(
    exchangeFeesPct,
    slippagePct,
    marketImpactPct,
  );

  const zScore = computeTradeReturnZScore(tradeReturnBps);
  const tradeCount = tradeReturnBps.length;
  const confidenceLevel = classifyTurnoverConfidenceLevel(zScore, tradeCount, avgTradesPerMonth);
  const tradesPerMonthLabel = formatAvgTradesPerMonthLabel(avgTradesPerMonth);
  const confidenceNote = buildTurnoverConfidenceNote({
    avgTradesPerMonth,
    tradesPerMonthLabel,
    confidenceLevel,
    zScore,
  });
  const lowSignificanceCagrDisclaimer = turnoverLowSignificanceCagrDisclaimer(
    confidenceLevel,
    avgTradesPerMonth,
  );
  const deploymentClass = classifyTurnoverDeploymentClass({
    netEdgeBps,
    costAdaptability,
    zScore,
  });
  const winRateSensitivityPct = computeWinRateSensitivityPct(tradeReturnBps);

  const wfaPeriods = ((wfa?.periods ?? (wfa as { windows?: unknown[] })?.windows) ??
    []) as readonly WfaPeriodForHalfLife[];
  const alphaHalfLifeDays = computeAlphaHalfLifeDays({
    totalTrades,
    dateRangeDays,
    periods: wfaPeriods,
  });
  const alphaHalfLifeDisclaimer = turnoverAlphaHalfLifeDisclaimer(
    alphaHalfLifeDays,
    avgTradesPerMonth,
  );

  const primaryConstraint = classifyTurnoverPrimaryConstraint({
    grossEdgeNegative,
    netEdgeBps,
    costEdgeRatioPct,
    advPortfolioWeightedPct: advUtilization?.portfolioWeightedPct ?? 0,
    limitFillProbabilityPct,
  });

  const controlLeverEffectiveness = classifyControlLeverEffectiveness({
    grossEdgeNegative,
    costEdgeRatioPct,
  });

  const availableControlLevers = buildTurnoverAvailableControlLevers(controlLeverEffectiveness);

  const toDecimalPct = (v: number | undefined): number | undefined =>
    v != null && Number.isFinite(v) ? (v as number) / 100 : undefined;
  const limitFillDecimal = Number.isFinite(limitFillProbabilityPct)
    ? Math.min((limitFillProbabilityPct as number) / 100, 1)
    : undefined;

  const marketImpactCagrDecimal = Number.isFinite(marketImpactPct)
    ? Math.abs(marketImpactPct) / 100
    : 0;
  const marketImpactWarnings = computeMarketImpactWarnings(
    marketImpactCagrDecimal,
    Number.isFinite(advNotionalResolved) ? advNotionalResolved : 0,
  );

  return {
    baselineAum: initialBalance,
    avgTradesPerMonth,
    annualTurnover: Number.isFinite(annualTurnover) ? roundTo(annualTurnover, 1) : undefined,
    avgHoldingTimeHours,
    interpretiveSummary,
    deploymentClass,
    requiredAlphaBoostBps: Number.isFinite(requiredAlphaBoostBps)
      ? roundTo(requiredAlphaBoostBps, 2)
      : undefined,
    primaryConstraint,
    availableControlLevers,
    confidence: {
      zScore: Number.isFinite(zScore) ? roundTo(zScore, 2) : undefined,
      level: confidenceLevel,
      note: confidenceNote,
    },
    profitFactorGross,
    profitFactorNet,
    costEdgeRatioPct: toDecimalPct(costEdgeRatioPct),
    avgNetProfitPerTradeBps,
    robustNetEdgeBps:
      typeof robustNetEdgeBps === "number" && Number.isFinite(robustNetEdgeBps)
        ? roundTo(robustNetEdgeBps, 1)
        : undefined,
    breakevenSlippageBps:
      netEdgePositive && typeof breakevenSlippageBps === "number" && Number.isFinite(breakevenSlippageBps)
        ? breakevenSlippageBps
        : undefined,
    breakevenMargin: netEdgePositive ? breakevenMargin : undefined,
    breakevenStatus: netEdgePositive ? breakevenStatusFinal : undefined,
    breakevenFailureMode: netEdgePositive ? breakevenFailureMode : undefined,
    safetyMarginSlippage:
      netEdgePositive &&
      typeof safetyMarginSlippage === "number" &&
      Number.isFinite(safetyMarginSlippage)
        ? roundTo(safetyMarginSlippage, 1)
        : undefined,
    executionIsEstimated: executionIsEstimated || undefined,
    advSource: historicalData?.data?.length ? "api" : "estimated",
    grossEdgeBps:
      typeof grossEdgeBps === "number" && Number.isFinite(grossEdgeBps) ? roundTo(grossEdgeBps, 1) : undefined,
    grossEdgePerTradeBpsInstitutional: Number.isFinite(grossPerTradeBpsInstitutional)
      ? roundTo(grossPerTradeBpsInstitutional, 1)
      : undefined,
    opportunityCostBps: Number.isFinite(opportunityCostBps) ? roundTo(opportunityCostBps, 1) : undefined,
    adverseSelectionCostBps: Number.isFinite(adverseSelectionCostBps)
      ? roundTo(adverseSelectionCostBps, 1)
      : undefined,
    costDecomposition: {
      exchangeFeesPct: toDecimalPct(exchangeFeesPct),
      slippagePct: toDecimalPct(slippagePct),
      marketImpactPct: toDecimalPct(marketImpactPct),
      totalCostDragPct: toDecimalPct(totalCostDragPct),
      rebateCaptureBps: Number.isFinite(rebateCaptureBps) ? roundTo(rebateCaptureBps, 2) : undefined,
      rebateCaptureCagrPct:
        rebateCaptureCagrPct != null && Number.isFinite(rebateCaptureCagrPct)
          ? roundTo(rebateCaptureCagrPct, 4)
          : undefined,
      costDominance,
    },
    turnoverConsistencyWarning,
    turnoverFromTradesCrossCheck:
      Number.isFinite(turnoverFromTrades) ? roundTo(turnoverFromTrades, 1) : undefined,
    overlapFactor:
      Number.isFinite(overlapFactorValue) ? roundTo(overlapFactorValue, 2) : undefined,
    holdingPeriodTurnover:
      typeof holdingPeriodTurnover === "number" && Number.isFinite(holdingPeriodTurnover)
        ? roundTo(holdingPeriodTurnover, 1)
        : undefined,
    capacity: {
      alphaMinus10Aum,
      alphaMinus25Aum,
      alphaCollapseAum,
      alphaCollapseNote: alphaCollapseResult.note,
      aumExceedsAdvNote:
        Number.isFinite(advNotionalResolved) &&
        advNotionalResolved > 0 &&
        initialBalance > 0.5 * advNotionalResolved
          ? "At baseline AUM, daily volume may be insufficient; trading at this scale may be infeasible (you would be effectively your own counterparty)."
          : undefined,
    },
    sensitivityToAlphaDecay: {
      alphaHalfLifeDays: formatAlphaHalfLifeDaysForApi(totalTrades, alphaHalfLifeDays),
      winRateSensitivityPct: Number.isFinite(winRateSensitivityPct)
        ? roundTo(Math.min(winRateSensitivityPct / 100, 1), 2)
        : undefined,
      alphaHalfLifeDisclaimer,
    },
    utilizationPct:
      Number.isFinite(utilizationPct) ? roundTo(utilizationPct, 4) : undefined,
    advUtilization: advUtilization
      ? {
          top5PairsPct: toDecimalPct(advUtilization.top5PairsPct),
          portfolioWeightedPct: toDecimalPct(advUtilization.portfolioWeightedPct),
        }
      : undefined,
    marketImpactModel: {
      assumption: "Square-root law",
      liquidityRegime: (() => {
        if (!Number.isFinite(advNotionalResolved) || advNotionalResolved <= 0) return "Unknown";
        if (advNotionalResolved < 50_000) return "Micro / low liquidity";
        if (advNotionalResolved < 500_000) return "Low liquidity";
        return "Top 20% depth";
      })(),
    },
    slippageSensitivity: slippageSensitivity.map((row) => ({
      aum: row.aum,
      ...(row.slippageCagrPct != null && Number.isFinite(row.slippageCagrPct)
        ? { slippageCagrPct: row.slippageCagrPct / 100 }
        : {}),
      ...(row.netCagrPct != null && Number.isFinite(row.netCagrPct)
        ? { netCagrPct: row.netCagrPct / 100 }
        : {}),
      ...(row.status && { status: row.status }),
    })),
    executionHedging: {
      orderTypeBias,
      takerMakerRatio,
      limitFillProbabilityPct: limitFillDecimal !== undefined ? roundTo(limitFillDecimal, 2) : undefined,
      latencySensitivity,
      toxicFlowRisk,
      adverseSelectionNote,
    },
    status: {
      costAdaptability,
      capacityGovernance,
      executionRisk,
    },
    costDrag: toDecimalPct(costDrag),
    grossToNetDegradation: toDecimalPct(grossToNetDegradation),
    lowSignificanceCagrDisclaimer,
    interpretation: "",
    ...(marketImpactWarnings.length > 0 && { marketImpactWarnings }),
    ...(marketImpactOutOfRange && { marketImpactOutOfRange: true }),
    executionGrade,
  };
}
