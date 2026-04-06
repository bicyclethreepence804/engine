import { calculateCagr, roundTo } from "./financialMath";

export type ProcessedKline = { timestamp: number; close: number };

/** Geometric excess return (institutional): ((1+R_s)/(1+R_b)-1)*100. Inputs are CAGR in percent (e.g. 10 for 10%). */
export function geometricExcessReturnPct(strategyCagrPct: number, btcCagrPct: number): number {
  if (!Number.isFinite(strategyCagrPct) || !Number.isFinite(btcCagrPct)) return Number.NaN;
  const onePlusB = 1 + btcCagrPct / 100;
  if (onePlusB <= 0) return Number.NaN;
  return ((1 + strategyCagrPct / 100) / onePlusB - 1) * 100;
}

export function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

const SUPPORTED_BENCHMARK_INTERVALS_LOWER = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
] as const;

const BENCHMARK_INTERVAL_ALIASES: Record<string, string> = { "60m": "1h", "1mo": "1M" };

/**
 * Normalize Freqtrade / payload timeframe string to a key understood by `intervalMs` (e.g. 1h, 1m vs 1M).
 */
export function parseBenchmarkInterval(interval: string): string {
  const raw = (interval || "1h").trim();
  const s = raw.toLowerCase();
  if (raw === "1M" || raw === "1m") return raw;
  if (BENCHMARK_INTERVAL_ALIASES[s]) return BENCHMARK_INTERVAL_ALIASES[s];
  if (
    SUPPORTED_BENCHMARK_INTERVALS_LOWER.includes(
      s as (typeof SUPPORTED_BENCHMARK_INTERVALS_LOWER)[number],
    )
  ) {
    return s;
  }
  return "1h";
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function intervalMs(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60 * 1000,
    "3m": 3 * 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": HOUR_MS,
    "2h": 2 * HOUR_MS,
    "4h": 4 * HOUR_MS,
    "6h": 6 * HOUR_MS,
    "8h": 8 * HOUR_MS,
    "12h": 12 * HOUR_MS,
    "1d": DAY_MS,
    "3d": 3 * DAY_MS,
    "1w": 7 * DAY_MS,
    "1M": Math.round(30.44 * DAY_MS),
  };
  return map[interval] ?? HOUR_MS;
}

export function hasGapsInKlines(
  klines: ProcessedKline[],
  interval: string,
  startMs: number,
  endMs: number,
): boolean {
  if (klines.length < 2) return true;
  const step = intervalMs(interval);
  const first = klines[0].timestamp;
  const last = klines[klines.length - 1].timestamp;
  if (first > startMs + step || last < endMs - step) return true;
  for (let i = 0; i < klines.length - 1; i++) {
    const gap = klines[i + 1].timestamp - klines[i].timestamp;
    if (gap > step * 2) return true;
  }
  return false;
}

export function buildCandleGrid(startMs: number, endMs: number, interval: string): number[] {
  const step = intervalMs(interval);
  if (step <= 0 || endMs <= startMs) return [];
  const first = Math.floor(startMs / step) * step;
  const grid: number[] = [];
  for (let t = first; t <= endMs; t += step) {
    if (t >= startMs) grid.push(t);
  }
  return grid;
}

export function alignEquityToGrid(
  curve: Array<{ timestamp: number; balance: number }>,
  gridTimestamps: number[],
  initialBalance: number,
): Array<{ timestamp: number; balance: number }> {
  if (gridTimestamps.length === 0) return [];
  const out: Array<{ timestamp: number; balance: number }> = [];
  let idx = 0;
  for (const ts of gridTimestamps) {
    while (idx < curve.length && curve[idx].timestamp <= ts) idx++;
    const balance = idx > 0 ? curve[idx - 1].balance : initialBalance;
    out.push({ timestamp: ts, balance });
  }
  return out;
}

export function barReturnsFromAlignedEquity(
  aligned: Array<{ timestamp: number; balance: number }>,
): number[] {
  const returns: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const prev = aligned[i - 1].balance;
    const curr = aligned[i].balance;
    if (prev > 0 && Number.isFinite(curr)) {
      returns.push((curr - prev) / prev);
    } else {
      returns.push(0);
    }
  }
  return returns;
}

export function recoverBarAlignedReturns(
  curve: Array<{ timestamp: number; balance: number }>,
  startMs: number,
  endMs: number,
  interval: string,
  initialBalance: number,
): {
  timestamps: number[];
  equityAligned: Array<{ timestamp: number; balance: number }>;
  returns: number[];
} {
  const grid = buildCandleGrid(startMs, endMs, interval);
  const equityAligned = alignEquityToGrid(curve, grid, initialBalance);
  const returns = barReturnsFromAlignedEquity(equityAligned);
  return { timestamps: grid, equityAligned, returns };
}

export type EquityCurvePoint = { timestamp: number; balance: number };

/** Strategy balance and BTC close on each BTC candle timestamp (strategy forward-filled). */
export type StrategyBtcAlignedPoint = {
  timestamp: number;
  strategy: number;
  btc: number;
};

/**
 * Normalize client-provided klines to { timestamp, close }[].
 * Accepts Binance array [openTime, open, high, low, close, ...] or { timestamp, close } objects.
 */
export function normalizeKlines(rows: unknown[]): ProcessedKline[] {
  const out: ProcessedKline[] = [];
  for (const row of rows) {
    if (Array.isArray(row) && row.length >= 5) {
      const openTime = Number(row[0]);
      const close = Number(row[4]);
      if (Number.isFinite(openTime) && Number.isFinite(close))
        out.push({ timestamp: openTime, close });
    } else if (row && typeof row === "object" && !Array.isArray(row)) {
      const r = row as Record<string, unknown>;
      const ts = Number(r.timestamp ?? r.openTime ?? r.time);
      const close = Number(r.close ?? r.c);
      if (Number.isFinite(ts) && Number.isFinite(close)) out.push({ timestamp: ts, close });
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Align strategy equity to BTC timestamps: for each BTC point use latest strategy balance with strategy.timestamp <= btc.timestamp.
 */
export function alignStrategyEquityToBtcTimestamps(
  strategyCurve: EquityCurvePoint[],
  btcKlines: ProcessedKline[],
  initialBalance: number,
): StrategyBtcAlignedPoint[] {
  if (btcKlines.length === 0) return [];
  const aligned: StrategyBtcAlignedPoint[] = [];
  let strategyIdx = 0;
  for (const b of btcKlines) {
    while (
      strategyIdx < strategyCurve.length &&
      strategyCurve[strategyIdx].timestamp <= b.timestamp
    ) {
      strategyIdx++;
    }
    const balance =
      strategyIdx > 0 ? strategyCurve[strategyIdx - 1].balance : initialBalance;
    aligned.push({ timestamp: b.timestamp, strategy: balance, btc: b.close });
  }
  return aligned;
}

/**
 * Paired simple returns between consecutive aligned points. Skips a bar when prior strategy or BTC level is non-positive (same as production benchmark path).
 */
export function periodReturnsFromStrategyBtcAligned(
  aligned: StrategyBtcAlignedPoint[],
): { strategyReturns: number[]; btcReturns: number[] } {
  const strategyReturns: number[] = [];
  const btcReturns: number[] = [];
  for (let i = 1; i < aligned.length; i++) {
    const prevStrategy = aligned[i - 1].strategy;
    const prevBtc = aligned[i - 1].btc;
    if (prevStrategy <= 0 || prevBtc <= 0) continue;
    strategyReturns.push((aligned[i].strategy - prevStrategy) / prevStrategy);
    btcReturns.push((aligned[i].btc - prevBtc) / prevBtc);
  }
  return { strategyReturns, btcReturns };
}

export function meanOfNumbers(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / n;
}

/**
 * Mean period excess return vs benchmark (strategy minus BTC), same length as `periodReturnsFromStrategyBtcAligned` outputs.
 */
export function excessReturnsPerPeriod(
  strategyReturns: readonly number[],
  btcReturns: readonly number[],
): number[] {
  const n = Math.min(strategyReturns.length, btcReturns.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(strategyReturns[i] - (btcReturns[i] ?? 0));
  }
  return out;
}

/**
 * Max slippage (% per leg) before alpha goes to zero; undefined if inputs invalid or edge deficit (same as benchmark comparison path).
 */
export function benchmarkBreakEvenSlippagePctFromMeanExcess(
  meanExcessPerPeriod: number,
  commissionDecimal: number,
): number | undefined {
  if (!Number.isFinite(meanExcessPerPeriod) || !Number.isFinite(commissionDecimal)) return undefined;
  const breakEvenSlippageDecimal = (meanExcessPerPeriod - 2 * commissionDecimal) / 2;
  if (!Number.isFinite(breakEvenSlippageDecimal) || breakEvenSlippageDecimal <= 0) return undefined;
  return roundTo(breakEvenSlippageDecimal * 100, 4);
}

/**
 * Average profit per period after round-trip fees and slippage (bps). Can be negative.
 */
export function benchmarkNetEdgeBpsFromMeanExcess(
  meanExcessPerPeriod: number,
  commissionDecimal: number,
  slippageDecimal: number,
): number | undefined {
  if (
    !Number.isFinite(meanExcessPerPeriod) ||
    !Number.isFinite(commissionDecimal) ||
    !Number.isFinite(slippageDecimal)
  ) {
    return undefined;
  }
  const costPerPeriod = 2 * (commissionDecimal + slippageDecimal);
  const netEdgeDecimal = meanExcessPerPeriod - costPerPeriod;
  if (!Number.isFinite(netEdgeDecimal)) return undefined;
  return roundTo(netEdgeDecimal * 10000, 2);
}

/** Same strings as frontend buildBenchmarkInterpretation (benchmarkMetrics.ts). */
export function buildBenchmarkInterpretation(
  excessReturn: number,
  informationRatio: number,
  correlationToBTC: number | undefined,
): string[] {
  const interpretation: string[] = [];
  if (excessReturn > 0) {
    interpretation.push("Strategy generates positive alpha");
  } else {
    interpretation.push("Strategy underperforms BTC buy-and-hold");
  }
  if (informationRatio >= 0.5) {
    interpretation.push("Alpha quality is meaningful relative to tracking error");
  } else if (informationRatio > 0) {
    interpretation.push("Alpha quality is weak and may be unstable");
  } else {
    interpretation.push("Alpha quality is negative after adjusting for tracking error");
  }
  if (Number.isFinite(correlationToBTC)) {
    const c = correlationToBTC as number;
    if (c < 0.3) {
      interpretation.push("Provides diversification benefit");
    } else if (c < 0.7) {
      interpretation.push("Partially correlated to BTC");
    } else {
      interpretation.push("Highly correlated to BTC");
    }
  }
  return interpretation;
}

const BENCHMARK_KURTOSIS_DISPLAY_CAP = 20;

export function benchmarkSafeSkewnessForApi(s: number): number | undefined {
  return Number.isFinite(s) ? roundTo(s, 2) : undefined;
}

export function benchmarkSafeKurtosisForApi(k: number, cap = BENCHMARK_KURTOSIS_DISPLAY_CAP): number | undefined {
  return Number.isFinite(k) ? roundTo(Math.min(cap, k), 2) : undefined;
}

/** Strategy volatility and max drawdown both in percent (e.g. 4.2 and 25). */
export function benchmarkDataQualityWarningFromVolDrawdown(
  volPct: number,
  maxDrawdownPct: number,
): string | undefined {
  const ddPct = Math.abs(maxDrawdownPct);
  if (Number.isFinite(volPct) && Number.isFinite(ddPct) && volPct < 5 && ddPct > 20) {
    return "Data mismatch: strategy volatility and max drawdown are inconsistent. Possible column mix-up.";
  }
  return undefined;
}

/** volPct and trackingErrorPct are percent-scale (e.g. 0 and 3.2). */
export function benchmarkStrategyVolatilityZeroNote(
  volPct: number,
  trackingErrorPct: number,
): string | undefined {
  if (
    volPct === 0 &&
    Number.isFinite(trackingErrorPct) &&
    trackingErrorPct > 0
  ) {
    return "Strategy volatility 0% (flat or sparse curve). Tracking Error reflects benchmark volatility.";
  }
  return undefined;
}

export function benchmarkStrategyCagrFromTotalReturn(totalReturn: number, years: number): number {
  if (!Number.isFinite(years) || years <= 0) return Number.NaN;
  const strategyReturn = Number.isNaN(totalReturn) ? 0 : totalReturn;
  return ((1 + strategyReturn) ** (1 / years) - 1) * 100;
}

export interface BenchmarkComparisonFallbackCore {
  strategyCAGR: number;
  btcCAGR: number;
  excessReturn: number;
  informationRatio: number;
  correlationToBTC: number | null;
  interpretation: string[];
  feesPerTrade: number;
  feesPerTradeIsDefault?: boolean;
  slippagePerTrade: number;
  slippagePerTradeIsDefault?: boolean;
}

export function buildBenchmarkFallbackComparison(input: {
  totalReturn: number;
  btcKlines: ProcessedKline[];
  years: number;
  commissionDecimal: number;
  slippageDecimal: number;
  feesPerTradeIsDefault?: boolean;
  slippagePerTradeIsDefault?: boolean;
}): BenchmarkComparisonFallbackCore {
  const first = input.btcKlines[0];
  const last = input.btcKlines[input.btcKlines.length - 1];
  const btcCagr =
    calculateCagr(first.close, last.close, first.timestamp, last.timestamp) * 100;
  const strategyCAGR = benchmarkStrategyCagrFromTotalReturn(input.totalReturn, input.years);
  const excessReturn = geometricExcessReturnPct(
    roundTo(strategyCAGR, 2),
    roundTo(btcCagr, 2),
  );
  const informationRatio = excessReturn / 15;
  const correlationToBTC: number | null = null;
  const interpretation = buildBenchmarkInterpretation(
    excessReturn,
    informationRatio,
    correlationToBTC ?? undefined,
  );
  const feeResolved = Number.isFinite(input.commissionDecimal) ? input.commissionDecimal : 0.001;
  const feeIsDefault =
    input.feesPerTradeIsDefault ?? !Number.isFinite(input.commissionDecimal);
  const slipResolved = Number.isFinite(input.slippageDecimal) ? input.slippageDecimal : 0.0005;
  return {
    strategyCAGR: roundTo(strategyCAGR, 2),
    btcCAGR: roundTo(btcCagr, 2),
    excessReturn: roundTo(excessReturn, 2),
    informationRatio: roundTo(informationRatio, 2),
    correlationToBTC,
    interpretation,
    feesPerTrade: roundTo(feeResolved, 4),
    ...(feeIsDefault && { feesPerTradeIsDefault: true }),
    slippagePerTrade: roundTo(slipResolved, 4),
    ...(input.slippagePerTradeIsDefault && { slippagePerTradeIsDefault: true }),
  };
}
