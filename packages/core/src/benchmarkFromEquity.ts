/**
 * Benchmark comparison: pure path from normalized equity curve + BTC klines (no exchange I/O).
 * The hosting layer resolves dates, fetches klines, normalizes equity, then calls tryBuildBenchmarkComparisonFromEquityPath.
 */

import type { ProcessedKline } from "./benchmarkCore";
import {
  alignStrategyEquityToBtcTimestamps,
  benchmarkBreakEvenSlippagePctFromMeanExcess,
  benchmarkDataQualityWarningFromVolDrawdown,
  benchmarkNetEdgeBpsFromMeanExcess,
  benchmarkSafeKurtosisForApi,
  benchmarkSafeSkewnessForApi,
  benchmarkStrategyVolatilityZeroNote,
  buildBenchmarkFallbackComparison,
  buildBenchmarkInterpretation,
  excessReturnsPerPeriod,
  geometricExcessReturnPct,
  intervalMs,
  meanOfNumbers,
  parseBenchmarkInterval,
  periodReturnsFromStrategyBtcAligned,
  toNumber,
  type EquityCurvePoint,
} from "./benchmarkCore";
import {
  buildEquityCurveFromReturns,
  calculateAnnualizedVolatility,
  calculateBeta,
  calculateCagr,
  calculateCalmarRatio,
  calculateCorrelation,
  calculateInformationRatio,
  calculateKurtosis,
  calculateKurtosisWinsorized,
  calculateMaxDrawdown,
  calculateNeweyWestTStat,
  calculateRollingCorrelationPeak,
  calculateSkewness,
  roundTo,
  timeframeToMs,
} from "./financialMath";

const ROLLING_CORRELATION_WINDOW_DAYS = 30;

/** Years between ISO date strings YYYY-MM-DD (inclusive span). */
export function yearsBetweenIsoDates(startStr: string, endStr: string): number | null {
  if (!startStr || !endStr) return null;
  const start = new Date(startStr.slice(0, 10)).getTime();
  const end = new Date(endStr.slice(0, 10)).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return (end - start) / (365.25 * 24 * 60 * 60 * 1000);
}

function toTimestampMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const t = new Date(v.trim()).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Normalize equity curve from payload: [{ timestamp, equity }] or balance/value -> { timestamp: ms, balance }[].
 */
export function normalizeEquityCurveFromPayload(
  raw: unknown[] | undefined,
): EquityCurvePoint[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: EquityCurvePoint[] = [];
  for (const point of raw) {
    if (!point || typeof point !== "object") continue;
    const obj = point as Record<string, unknown>;
    const ts = toTimestampMs(obj.timestamp ?? obj.t ?? obj.date);
    const balance = toNumber(obj.equity ?? obj.balance ?? obj.value);
    if (ts != null && Number.isFinite(balance)) {
      out.push({ timestamp: ts, balance });
    }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

/**
 * Build equity curve from Freqtrade-style trades when equityCurve is missing.
 */
export function buildEquityCurveFromTradesForBenchmark(
  trades: unknown[],
  initialBalance: number,
): EquityCurvePoint[] {
  if (!Array.isArray(trades) || trades.length === 0 || initialBalance <= 0) return [];
  const sorted = [...trades].sort((a, b) => {
    const ta =
      (a as Record<string, unknown>)?.close_date ??
      (a as Record<string, unknown>)?.open_date ??
      "";
    const tb =
      (b as Record<string, unknown>)?.close_date ??
      (b as Record<string, unknown>)?.open_date ??
      "";
    return String(ta).localeCompare(String(tb));
  });
  const out: EquityCurvePoint[] = [];
  let balance = initialBalance;
  for (const t of sorted) {
    const obj = t as Record<string, unknown>;
    const ts = toTimestampMs(obj.close_date ?? obj.open_date);
    if (ts == null) continue;
    const profitAbs = toNumber(obj.profit_abs ?? obj.profit ?? 0);
    if (Number.isFinite(profitAbs)) balance += profitAbs;
    out.push({ timestamp: ts, balance });
  }
  return out;
}

export type TryBuildBenchmarkComparisonInput = {
  equityCurve: EquityCurvePoint[];
  btcKlines: ProcessedKline[];
  initialBalance: number;
  timeframeStr: string;
  totalReturn: number;
  commissionDecimal: number;
  slippageDecimal: number;
  feesPerTradeIsDefault: boolean;
  slippagePerTradeIsDefault: boolean;
  totalTrades: number;
};

/**
 * Full benchmark metrics when equity aligns to BTC. Returns null when alignment or returns are insufficient (caller uses fallback).
 */
export function tryBuildBenchmarkComparisonFromEquityPath(
  input: TryBuildBenchmarkComparisonInput,
): Record<string, unknown> | null {
  const {
    equityCurve,
    btcKlines,
    initialBalance,
    timeframeStr,
    totalReturn,
    commissionDecimal,
    slippageDecimal,
    feesPerTradeIsDefault,
    slippagePerTradeIsDefault,
    totalTrades,
  } = input;

  if (equityCurve.length < 2) return null;

  const aligned = alignStrategyEquityToBtcTimestamps(
    equityCurve,
    btcKlines,
    initialBalance,
  );
  if (aligned.length < 2) return null;

  const timestamps = aligned.map((p) => p.timestamp);
  const { strategyReturns, btcReturns } = periodReturnsFromStrategyBtcAligned(aligned);

  if (strategyReturns.length < 2 || btcReturns.length < 2) return null;

  const timeframe = parseBenchmarkInterval(timeframeStr);
  const timeframeMs = timeframeToMs(timeframeStr) ?? intervalMs(timeframe);
  const periodsPerYear =
    timeframeMs > 0 ? (365.25 * 24 * 60 * 60 * 1000) / timeframeMs : 0;

  const startTime = aligned[0].timestamp;
  const endTime = aligned[aligned.length - 1].timestamp;

  const strategyCagr =
    calculateCagr(
      aligned[0].strategy,
      aligned[aligned.length - 1].strategy,
      startTime,
      endTime,
    ) * 100;
  const btcCagr =
    calculateCagr(
      aligned[0].btc,
      aligned[aligned.length - 1].btc,
      startTime,
      endTime,
    ) * 100;

  const excessReturn = geometricExcessReturnPct(
    roundTo(strategyCagr, 2),
    roundTo(btcCagr, 2),
  );
  const excessReturns = excessReturnsPerPeriod(strategyReturns, btcReturns);
  const informationRatio = calculateInformationRatio(excessReturns);
  const correlationToBTC = calculateCorrelation(strategyReturns, btcReturns);

  const strategyVolatility = calculateAnnualizedVolatility(strategyReturns, periodsPerYear);
  const btcVolatility = calculateAnnualizedVolatility(btcReturns, periodsPerYear);
  const betaToBTC = calculateBeta(strategyReturns, btcReturns);
  const trackingError = calculateAnnualizedVolatility(excessReturns, periodsPerYear);
  const rollingCorrelationPeak = calculateRollingCorrelationPeak(
    strategyReturns,
    btcReturns,
    timeframeMs,
    ROLLING_CORRELATION_WINDOW_DAYS,
  );
  const strategyEquityCurve = buildEquityCurveFromReturns(
    strategyReturns,
    aligned[0].strategy,
    timestamps.slice(1),
  );
  const strategyMaxDrawdown = calculateMaxDrawdown(strategyEquityCurve);
  const strategyCalmarRatio = calculateCalmarRatio(strategyCagr, strategyMaxDrawdown);
  const btcEquityCurve = buildEquityCurveFromReturns(
    btcReturns,
    aligned[0].btc,
    timestamps.slice(1),
  );
  const btcMaxDrawdown = calculateMaxDrawdown(btcEquityCurve);
  const btcCalmarRatio = calculateCalmarRatio(btcCagr, btcMaxDrawdown);

  const minNForMoments = 30;
  const btcSkewness =
    btcReturns.length > minNForMoments ? calculateSkewness(btcReturns) : Number.NaN;
  const btcKurtosis =
    btcReturns.length > minNForMoments ? calculateKurtosis(btcReturns) : Number.NaN;
  const strategySkewness =
    strategyReturns.length > minNForMoments
      ? calculateSkewness(strategyReturns)
      : Number.NaN;
  const strategyKurtosis =
    strategyReturns.length > minNForMoments
      ? calculateKurtosis(strategyReturns)
      : Number.NaN;
  const strategyKurtosisWinsorized =
    Number.isFinite(strategyKurtosis) &&
    strategyKurtosis > 50 &&
    strategyReturns.length >= 4
      ? calculateKurtosisWinsorized(strategyReturns, 0.01)
      : undefined;
  const btcKurtosisWinsorized =
    Number.isFinite(btcKurtosis) && btcKurtosis > 50 && btcReturns.length >= 4
      ? calculateKurtosisWinsorized(btcReturns, 0.01)
      : undefined;

  const nwResult = calculateNeweyWestTStat(excessReturns, undefined, {
    maxZ: 10,
  });
  const alphaTStatRaw = nwResult.tStat;
  const allowTStat =
    Number.isFinite(alphaTStatRaw) &&
    strategyVolatility > 0 &&
    (Number.isNaN(totalTrades) || totalTrades >= 30);
  const alphaTStat = allowTStat ? alphaTStatRaw : Number.NaN;

  const nPeriods = excessReturns.length;
  const meanExcessPerPeriod = meanOfNumbers(excessReturns);
  const breakEvenSlippagePct = benchmarkBreakEvenSlippagePctFromMeanExcess(
    meanExcessPerPeriod,
    commissionDecimal,
  );
  const netEdgeBps = benchmarkNetEdgeBpsFromMeanExcess(
    meanExcessPerPeriod,
    commissionDecimal,
    slippageDecimal,
  );

  const interpretation = buildBenchmarkInterpretation(
    excessReturn,
    informationRatio,
    correlationToBTC,
  );

  const volPct = strategyVolatility * 100;
  const dataQualityWarning = benchmarkDataQualityWarningFromVolDrawdown(
    volPct,
    strategyMaxDrawdown,
  );
  const strategyVolatilityZeroNote = benchmarkStrategyVolatilityZeroNote(
    volPct,
    trackingError * 100,
  );

  return {
    strategyCAGR: roundTo(strategyCagr, 2),
    btcCAGR: roundTo(btcCagr, 2),
    excessReturn: roundTo(excessReturn, 2),
    informationRatio: roundTo(informationRatio, 2),
    correlationToBTC: roundTo(correlationToBTC, 2),
    interpretation,
    strategyVolatility: roundTo(strategyVolatility * 100, 2),
    btcVolatility: roundTo(btcVolatility * 100, 2),
    betaToBTC: roundTo(betaToBTC, 2),
    trackingError: roundTo(trackingError * 100, 2),
    rollingCorrelationPeak: roundTo(rollingCorrelationPeak, 2),
    ...(Number.isFinite(alphaTStat) && { alphaTStat: roundTo(alphaTStat, 2) }),
    ...(nPeriods > 0 && { nObservationsTStat: nPeriods }),
    ...(Number.isFinite(nwResult.stdError) && {
      alphaTStatStdError: roundTo(nwResult.stdError, 6),
    }),
    ...(typeof nwResult.lags === "number" &&
      nwResult.lags >= 0 && { alphaTStatLags: nwResult.lags }),
    ...(strategyMaxDrawdown === 0 && strategyCagr > 0 && { zeroDrawdownWarning: true }),
    ...(strategyVolatilityZeroNote && { strategyVolatilityZeroNote }),
    strategyMaxDrawdown: roundTo(strategyMaxDrawdown, 2),
    ...(Number.isFinite(strategyCalmarRatio) && {
      strategyCalmarRatio: roundTo(strategyCalmarRatio, 2),
    }),
    btcMaxDrawdown: roundTo(btcMaxDrawdown, 2),
    ...(Number.isFinite(btcCalmarRatio) && {
      btcCalmarRatio: roundTo(btcCalmarRatio, 2),
    }),
    ...(benchmarkSafeSkewnessForApi(btcSkewness) !== undefined && {
      btcSkewness: benchmarkSafeSkewnessForApi(btcSkewness)!,
    }),
    ...(benchmarkSafeKurtosisForApi(btcKurtosis) !== undefined && {
      btcKurtosis: benchmarkSafeKurtosisForApi(btcKurtosis)!,
    }),
    ...(typeof btcKurtosisWinsorized === "number" && Number.isFinite(btcKurtosisWinsorized)
      ? { btcKurtosisWinsorized: roundTo(btcKurtosisWinsorized, 2) }
      : {}),
    ...(benchmarkSafeSkewnessForApi(strategySkewness) !== undefined && {
      strategySkewness: benchmarkSafeSkewnessForApi(strategySkewness)!,
    }),
    ...(benchmarkSafeKurtosisForApi(strategyKurtosis) !== undefined && {
      strategyKurtosis: benchmarkSafeKurtosisForApi(strategyKurtosis)!,
    }),
    ...(typeof strategyKurtosisWinsorized === "number" &&
    Number.isFinite(strategyKurtosisWinsorized)
      ? { strategyKurtosisWinsorized: roundTo(strategyKurtosisWinsorized, 2) }
      : {}),
    dataQualityWarning,
    feesPerTrade: roundTo(commissionDecimal, 4),
    ...(feesPerTradeIsDefault && { feesPerTradeIsDefault: true }),
    slippagePerTrade: roundTo(slippageDecimal, 4),
    ...(slippagePerTradeIsDefault && { slippagePerTradeIsDefault: true }),
    ...(breakEvenSlippagePct !== undefined && {
      breakEvenSlippagePct,
    }),
    ...(netEdgeBps !== undefined && {
      netEdgeBps,
      ...(breakEvenSlippagePct === undefined &&
        Number.isFinite(netEdgeBps) &&
        netEdgeBps < 0 && {
          breakEvenSlippageNote: "N/A (edge deficit)",
        }),
    }),
  };
}
