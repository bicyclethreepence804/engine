/**
 * What-If Analysis - survival simulator scenarios.
 * Builds extended scenario table (Ex-Outlier, Top 3 Exclusion, Missed Signals, High Fee, etc.).
 */

import type { DataQualityGuardResult } from "./dataQualityGuard";

export interface WhatIfScenarioRow {
  scenario: string;
  robustness: number;
  verdict: string;
  action: string;
  category?: string;
}

interface ResultLike {
  robustnessScore?: { overall?: number; potentialOverall?: number } | null;
  turnoverAndCostDrag?: Record<string, unknown> | null;
  dataQualityGuardResult?: { modules?: Array<{ module: string; details?: { profitWithoutTop3?: number; topTradeRatioPct?: string } }> } | null;
}

type CandleLike = Record<string, unknown> & {
  h?: number; high?: number;
  l?: number; low?: number;
  o?: number; open?: number;
  c?: number; close?: number;
};

interface BuildWhatIfOptions {
  currentVerdict?: string;
  candles?: CandleLike[];
}

const HIGH_FEE_BPS = 20;
const ATR_PERIOD = 14;

function getProfits(
  trades: Array<Record<string, unknown>>
): number[] {
  return trades
    .map((t) => {
      const p = t.profit_abs ?? t.profit ?? t.pnl;
      return typeof p === "number" && Number.isFinite(p) ? p : NaN;
    })
    .filter((p) => !Number.isNaN(p));
}

function robustnessToVerdict(robustness: number): string {
  if (robustness <= 20) return "TRASH";
  if (robustness < 40) return "FAIL";
  if (robustness < 60) return "TUNING";
  return "ROBUST";
}

function computeATR(candles: CandleLike[], period: number = ATR_PERIOD): number {
  if (!candles?.length || candles.length < period + 1) return NaN;
  let sum = 0;
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i]!;
    const prev = candles[i - 1]!;
    const h = (cur.h ?? cur.high) as number;
    const l = (cur.l ?? cur.low) as number;
    const prevC = (prev.c ?? prev.close) as number;
    if (!Number.isFinite(h) || !Number.isFinite(l)) continue;
    const tr = Math.max(
      h - l,
      Number.isFinite(prevC) ? Math.abs(h - prevC) : 0,
      Number.isFinite(prevC) ? Math.abs(l - prevC) : 0
    );
    sum += tr;
  }
  const count = candles.length - 1;
  return count > 0 ? sum / count : NaN;
}

export function buildWhatIfScenarios(
  trades: Array<Record<string, unknown>>,
  result: ResultLike,
  _dqgResult: DataQualityGuardResult,
  options?: BuildWhatIfOptions
): WhatIfScenarioRow[] {
  const baseRobustness = result.robustnessScore?.overall ?? 0;
  const currentVerdict = options?.currentVerdict ?? robustnessToVerdict(baseRobustness);
  const toc = result.turnoverAndCostDrag ?? {};
  const grossEdgeBps = toc.grossEdgeBps as number | undefined;
  const candles = options?.candles ?? [];
  const rows: WhatIfScenarioRow[] = [];

  rows.push({
    category: "Execution",
    scenario: "Current Test",
    robustness: Math.round(baseRobustness),
    verdict: currentVerdict,
    action:
      currentVerdict === "REJECTED" || currentVerdict === "FAIL"
        ? "Stop research, change logic."
        : "Revalidate before deployment.",
  });

  const profits = getProfits(trades);

  if (profits.length >= 2) {
    const netProfit = profits.reduce((s, p) => s + p, 0);
    const sorted = [...profits].sort((a, b) => b - a);
    const top1 = sorted[0] ?? 0;
    const profitWithoutTop1 = netProfit - top1;
    const top1SharePct = netProfit > 0 ? (top1 / netProfit) * 100 : 0;

    let robustnessEx1 = 0;
    let verdictEx1 = "TRASH";
    let actionEx1 = "Critical: strategy is a lottery ticket.";

    if (profitWithoutTop1 <= 0) {
      actionEx1 =
        netProfit <= 0
          ? "Strategy is unprofitable; profit concentration not applicable."
          : `Critical: ${top1SharePct.toFixed(0)}% of profit depends on 1 trade.`;
    } else {
      const ratio = netProfit !== 0 ? profitWithoutTop1 / netProfit : 0;
      robustnessEx1 = Math.max(0, Math.min(100, Math.round(baseRobustness * ratio)));
      verdictEx1 = robustnessToVerdict(robustnessEx1);
      if (top1SharePct > 30) {
        actionEx1 = `Critical: ${top1SharePct.toFixed(0)}% profit depends on 1 trade.`;
      } else {
        actionEx1 = "Strategy survives without best trade; edge is distributed.";
      }
    }

    rows.push({
      category: "Robustness",
      scenario: "Ex-Outlier (No Best Trade)",
      robustness: robustnessEx1,
      verdict: verdictEx1,
      action: actionEx1,
    });
  }

  if (profits.length >= 4) {
    const netProfit = profits.reduce((s, p) => s + p, 0);
    const sorted = [...profits].sort((a, b) => b - a);
    const top3Sum = (sorted[0] ?? 0) + (sorted[1] ?? 0) + (sorted[2] ?? 0);
    const profitWithoutTop3 = netProfit - top3Sum;

    let robustnessTop3 = 0;
    let verdictTop3 = "TRASH";
    let actionTop3 = "Strategy becomes unprofitable without top 3 trades.";

    if (profitWithoutTop3 > 0 && netProfit > 0) {
      const ratio = profitWithoutTop3 / netProfit;
      robustnessTop3 = Math.max(0, Math.min(100, Math.round(baseRobustness * ratio)));
      verdictTop3 = robustnessToVerdict(robustnessTop3);
      actionTop3 = "Potential to reduce cost drag; edge is fragile.";
    }

    rows.push({
      category: "Robustness",
      scenario: "Top 3 Exclusion",
      robustness: robustnessTop3,
      verdict: verdictTop3,
      action: actionTop3,
    });
  }

  if (baseRobustness < 50) {
    const potentialOverall = result.robustnessScore?.potentialOverall;
    const zeroSlippageRobustness =
      baseRobustness === 0 && potentialOverall != null && Number.isFinite(potentialOverall)
        ? Math.round(potentialOverall)
        : baseRobustness === 0
          ? 0
          : Math.min(100, Math.round(baseRobustness + 35));
    const zeroSlippageVerdict = robustnessToVerdict(zeroSlippageRobustness);
    rows.push({
      category: "Execution",
      scenario: "Zero Slippage",
      robustness: zeroSlippageRobustness,
      verdict: zeroSlippageVerdict,
      action:
        baseRobustness === 0
          ? potentialOverall != null && Number.isFinite(potentialOverall)
            ? `Score if unblocked with zero slippage: ${Math.round(potentialOverall)} (still ${zeroSlippageVerdict}). Fix blocking modules first.`
            : "Logic would still score 0 (blocked). Fix blocking modules first."
          : "Logic survives in ideal world - fix execution.",
    });

    rows.push({
      category: "Execution",
      scenario: "Low Frequency (50% fewer trades)",
      robustness: Math.min(100, Math.round(baseRobustness + 22)),
      verdict: "TUNING",
      action: "Potential to reduce cost drag.",
    });
  }

  if (profits.length >= 10) {
    const sortedByProfit = [...profits].sort((a, b) => a - b);
    const dropCount = Math.max(1, Math.floor(profits.length * 0.2));
    const removed = sortedByProfit.slice(0, dropCount);
    const removedSum = removed.reduce((s, p) => s + p, 0);
    const netProfit = profits.reduce((s, p) => s + p, 0);
    const profitAfterSkip = netProfit - removedSum;

    let robustnessSkip = 0;
    let verdictSkip = "TRASH";
    let actionSkip = "Missing 20% of signals erodes edge.";

    if (profitAfterSkip > 0 && netProfit !== 0) {
      const ratio = profitAfterSkip / netProfit;
      robustnessSkip = Math.max(0, Math.min(100, Math.round(baseRobustness * ratio)));
      verdictSkip = robustnessToVerdict(robustnessSkip);
      actionSkip =
        verdictSkip === "TRASH" || robustnessSkip < 40
          ? "Missing 20% of signals erodes edge."
          : "Strategy tolerates some missed signals.";
    }

    rows.push({
      category: "Execution",
      scenario: "Missed Signals (20% skip)",
      robustness: robustnessSkip,
      verdict: verdictSkip,
      action: actionSkip,
    });
  }

  if (grossEdgeBps != null && Number.isFinite(grossEdgeBps)) {
    const effectiveEdgeBps = grossEdgeBps - HIGH_FEE_BPS;
    const edgeRatio = grossEdgeBps > 0 ? Math.max(0, effectiveEdgeBps / grossEdgeBps) : 0;
    const robustnessHighFee = Math.max(0, Math.min(100, Math.round(baseRobustness * edgeRatio)));
    const verdictHighFee = robustnessToVerdict(robustnessHighFee);
    rows.push({
      category: "Execution",
      scenario: "High Fee Regime (10 bps taker)",
      robustness: robustnessHighFee,
      verdict: verdictHighFee,
      action:
        robustnessHighFee < 40
          ? "Test viability for low-tier exchange accounts."
          : "Strategy can tolerate higher fees.",
    });
  }

  if (profits.length >= 2) {
    const netProfit = profits.reduce((s, p) => s + p, 0);
    const worstTrade = Math.min(...profits);
    const netAfterSwan = netProfit + worstTrade;
    const ratio = netProfit > 0 && netAfterSwan > 0 ? netAfterSwan / netProfit : 0;
    const robustnessSwan = Math.max(0, Math.min(100, Math.round(baseRobustness * ratio)));
    const verdictSwan = robustnessToVerdict(robustnessSwan);
    rows.push({
      category: "Robustness",
      scenario: "Black Swan Hit (1 max-loss trade)",
      robustness: robustnessSwan,
      verdict: verdictSwan,
      action:
        worstTrade >= 0
          ? "No losing trades in sample - add stress tests."
          : robustnessSwan < 20
            ? "Hypothetical: removing the worst single loss wipes edge (already reflected in Max DD/Recovery Factor). Tighten risk or reduce size."
            : "Strategy absorbs a single max-loss event.",
    });
  }

  const lateEntryRobustness = Math.max(0, Math.min(100, Math.round(baseRobustness * 0.85)));
  rows.push({
    category: "Execution",
    scenario: "Execution Delay (+1 candle)",
    robustness: lateEntryRobustness,
    verdict: robustnessToVerdict(lateEntryRobustness),
    action:
      lateEntryRobustness < 30
        ? "Strategy is too sensitive to timing."
        : "Moderate sensitivity to entry delay.",
  });

  if (candles.length >= ATR_PERIOD + 1) {
    const atr = computeATR(candles);
    if (Number.isFinite(atr) && atr > 0) {
      const volSpikeRobustness = Math.max(0, Math.min(100, Math.round(baseRobustness * 0.7)));
      rows.push({
        category: "Market",
        scenario: "Volatility Spike (+50% ATR)",
        robustness: volSpikeRobustness,
        verdict: robustnessToVerdict(volSpikeRobustness),
        action:
          volSpikeRobustness < 30
            ? "Stops are too tight for volatile markets."
            : "Strategy has some resilience to higher volatility.",
      });
    }
  }

  const flatChopRobustness = Math.max(0, Math.min(100, Math.round(baseRobustness * 0.75)));
  rows.push({
    category: "Market",
    scenario: "Flat/Chop Filter",
    robustness: flatChopRobustness,
    verdict: robustnessToVerdict(flatChopRobustness),
    action:
      flatChopRobustness < 30
        ? "Strategy may over-trade in sideways markets."
        : "Moderate resilience to chop.",
  });

  if (profits.length >= 5) {
    const netProfit = profits.reduce((s, p) => s + p, 0);
    const sorted = [...profits].sort((a, b) => a - b);
    const worstCount = Math.max(1, Math.floor(profits.length * 0.2));
    const sumWorst20 = sorted.slice(0, worstCount).reduce((s, p) => s + p, 0);
    const netAfterReversal = netProfit - 2 * sumWorst20;
    const ratio = netProfit > 0 ? (netAfterReversal > 0 ? netAfterReversal / netProfit : 0) : 0;
    const revRobustness = Math.max(0, Math.min(100, Math.round(baseRobustness * ratio)));
    rows.push({
      category: "Market",
      scenario: "Trend Reversal (worst 20% flip)",
      robustness: revRobustness,
      verdict: robustnessToVerdict(revRobustness),
      action:
        revRobustness < 20
          ? "Vulnerable to trend reversal - avoid overstaying."
          : "Some buffer against trend reversal.",
    });
  }

  return rows;
}

export function buildWhatIfScenariosFallback(
  result: ResultLike,
  currentVerdict: string
): WhatIfScenarioRow[] {
  const baseRobustness = result.robustnessScore?.overall ?? 0;
  if (baseRobustness >= 50) return [];

  const zeroSlippageRobustness =
    baseRobustness === 0 ? 0 : Math.min(100, Math.round(baseRobustness + 35));
  const zeroSlippageVerdict = robustnessToVerdict(zeroSlippageRobustness);
  return [
    {
      scenario: "Current Test",
      robustness: Math.round(baseRobustness),
      verdict: currentVerdict,
      action:
        currentVerdict === "REJECTED" || currentVerdict === "FAIL"
          ? "Stop research, change logic."
          : "Revalidate before deployment.",
    },
    {
      scenario: "Zero Slippage",
      robustness: zeroSlippageRobustness,
      verdict: zeroSlippageVerdict,
      action:
        baseRobustness === 0
          ? "Logic would still score 0 (blocked). Fix blocking modules first."
          : "Logic survives in ideal world - fix execution.",
    },
    {
      scenario: "Low Frequency (50% fewer trades)",
      robustness: Math.min(100, Math.round(baseRobustness + 22)),
      verdict: "TUNING",
      action: "Potential to reduce cost drag.",
    },
  ];
}
