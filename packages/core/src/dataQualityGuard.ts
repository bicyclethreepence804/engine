/**
 * Data Quality Guard (DQG) - per DATA_QUALITY_GUARD_ARCHITECTURE.md.
 * Multiplicative model: final score = product of module scores. REJECT if any module 0 or final < threshold.
 *
 * Computational complexity: all modules are O(n) or O(n log n) in input size (n = candles or trades).
 * Gap Density: O(n log n) sort + O(n). Price Integrity: O(n * 14) for ATR window. Others: O(trades) or O(1).
 * Even 100k candles is < 50ms; not heavy.
 */

export type DQGVerdict = "PASS" | "FAIL" | "REJECT" | "N/A";

export interface DQGModuleResult {
  module: string;
  /** null when verdict is N/A (insufficient raw data). */
  score: number | null;
  verdict: DQGVerdict;
  /** Set when verdict is N/A (docs/DQG_INSUFFICIENT_DATA_BEHAVIOR.md). */
  reason?: { code: string; message: string };
  details?: {
    description?: string;
    missingFields?: string[];
    [key: string]: unknown;
  };
}

/** Thresholds from architecture doc. */
const OUTLIER_RATIO_REJECT = 0.5; // Single trade > 50% profit -> REJECT (doc: 30%, we use 50% for consistency with spec text)
const OUTLIER_RATIO_FAIL = 0.3; // Doc: reject if one trade > 30%
const GAP_RATIO_REJECT = 0.01; // > 1% gaps
const MAX_CONSECUTIVE_GAP_BARS = 10;
const SAMPLING_MIN_DAYS = 90; // Doc: days < 90 or equivalent
const DQG_FINAL_REJECT_THRESHOLD = 0.5;

/** Trade-like for Outlier: profit + optional id/date for tooltip. */
type OutlierTradeLike = {
  profit_abs?: number;
  profit?: number;
  pnl?: number;
  trade_id?: string | number;
  close_date?: string;
  open_date?: string;
};

/**
 * Module 2 - Outlier Influence (DQ2). Single-trade profit share.
 * @param trades - Array of trades with profit (Freqtrade: profit_abs; or { profit: number }). Optional trade_id/close_date for tooltip.
 */
export function validateOutlierInfluence(
  trades: Array<OutlierTradeLike | Record<string, unknown>>
): DQGModuleResult {
  const withProfit = trades.map((t) => {
    const p = (t as OutlierTradeLike).profit_abs ?? (t as OutlierTradeLike).profit ?? (t as OutlierTradeLike).pnl;
    return { profit: typeof p === "number" && Number.isFinite(p) ? p : NaN, raw: t };
  });
  const valid = withProfit.filter((x) => !Number.isNaN(x.profit));
  const profits = valid.map((x) => x.profit);

  if (profits.length < 5) {
    return {
      module: "Outlier Influence",
      score: null,
      verdict: "N/A",
      reason: {
        code: "INSUFFICIENT_TRADES",
        message: "Insufficient trades for outlier check (min 5)",
      },
      details: {
        description: "Insufficient trades for outlier check (min 5)",
        tradeCount: profits.length,
      },
    };
  }

  const netProfit = profits.reduce((s, p) => s + p, 0);
  if (netProfit <= 0) {
    return {
      module: "Outlier Influence",
      score: null,
      verdict: "N/A",
      reason: {
        code: "NO_NET_PROFIT",
        message: "No net profit - outlier check N/A",
      },
      details: { description: "No net profit - outlier check N/A" },
    };
  }

  let maxIdx = 0;
  for (let i = 1; i < profits.length; i++) {
    if (profits[i]! > profits[maxIdx]!) maxIdx = i;
  }
  const topTradeProfit = profits[maxIdx] ?? 0;
  const outlierRatio = topTradeProfit / netProfit;
  const topTradeRaw = valid[maxIdx]?.raw as OutlierTradeLike | Record<string, unknown> | undefined;
  const topTradeId = topTradeRaw && typeof topTradeRaw === "object" && ("trade_id" in topTradeRaw)
    ? (topTradeRaw as OutlierTradeLike).trade_id
    : undefined;
  const topTradeDate = topTradeRaw && typeof topTradeRaw === "object"
    ? ((topTradeRaw as OutlierTradeLike).close_date ?? (topTradeRaw as OutlierTradeLike).open_date)
    : undefined;
  const topTradeLabel = topTradeId != null
    ? String(topTradeId)
    : typeof topTradeDate === "string" && topTradeDate
      ? topTradeDate.slice(0, 10)
      : undefined;

  const sorted = [...profits].sort((a, b) => b - a);
  const top3 = (sorted[0] ?? 0) + (sorted[1] ?? 0) + (sorted[2] ?? 0);
  const profitWithoutTop3 = netProfit - top3;

  let score = Math.max(0, 1 - outlierRatio);
  let verdict: DQGVerdict = "PASS";
  let description = "Profit is well distributed";

  if (outlierRatio > OUTLIER_RATIO_REJECT) {
    verdict = "REJECT";
    description = `Extreme Outlier: Single trade generates ${(outlierRatio * 100).toFixed(1)}% of profit`;
    score = 0;
  } else if (outlierRatio > OUTLIER_RATIO_FAIL) {
    verdict = "FAIL";
    description = `Single trade contributes ${(outlierRatio * 100).toFixed(1)}% of profit (threshold 30%)`;
    score *= 0.5;
  } else if (profitWithoutTop3 <= 0 && netProfit > 0) {
    verdict = "FAIL";
    description = "Fragile Edge: Strategy becomes unprofitable without top 3 trades";
    score *= 0.5;
  }

  const details: DQGModuleResult["details"] = {
    topTradeRatioPct: (outlierRatio * 100).toFixed(2),
    profitWithoutTop3,
    description,
  };
  if (topTradeLabel) details.topTradeLabel = topTradeLabel;

  return {
    module: "Outlier Influence",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details,
  };
}

/**
 * Module 1 - Gap Density (DQ1). Requires OHLCV candles with timestamp.
 */
export function validateGapDensity(
  candles: Array<{ t?: number; timestamp?: number; time?: number }>,
  timeframeMs: number
): DQGModuleResult {
  if (!candles?.length || candles.length < 2) {
    return {
      module: "Gap Density",
      score: 1,
      verdict: "PASS",
      details: { description: "Insufficient candle data for gap check" },
    };
  }

  const getTs = (c: (typeof candles)[0]) =>
    c.t ?? c.timestamp ?? c.time ?? NaN;
  const sorted = [...candles]
    .map((c) => getTs(c))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (sorted.length < 2) {
    return {
      module: "Gap Density",
      score: 1,
      verdict: "PASS",
      details: { description: "Insufficient timestamps" },
    };
  }

  const timeSpan = sorted[sorted.length - 1]! - sorted[0]!;
  const expectedBars = Math.floor(timeSpan / timeframeMs) + 1;
  // Intervals between candles (not bar count); gap ratio = gaps / intervals
  const totalIntervals = Math.max(1, expectedBars - 1);
  let totalGaps = 0;
  let maxConsecutiveGap = 0;

  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i]! - sorted[i - 1]!;
    if (diff > timeframeMs) {
      const missingBars = Math.floor(diff / timeframeMs) - 1;
      totalGaps += missingBars;
      if (missingBars > maxConsecutiveGap) maxConsecutiveGap = missingBars;
    }
  }

  const gapRatio = totalGaps / totalIntervals;
  let score = Math.max(0, 1 - gapRatio);
  if (maxConsecutiveGap > 0) {
    score *= Math.exp(-0.1 * maxConsecutiveGap);
  }
  let verdict: DQGVerdict = "PASS";
  let description = "Healthy";

  if (maxConsecutiveGap > MAX_CONSECUTIVE_GAP_BARS) {
    verdict = "REJECT";
    description = `Large data hole detected: ${maxConsecutiveGap} bars`;
    score = 0;
  } else if (gapRatio > GAP_RATIO_REJECT) {
    verdict = "FAIL";
    description = `Gap Density too high: ${(gapRatio * 100).toFixed(2)}%`;
  }

  return {
    module: "Gap Density",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details: {
      missingBars: totalGaps,
      maxGap: maxConsecutiveGap,
      expectedTotal: expectedBars,
      totalIntervals,
      gapRatioPct: (gapRatio * 100).toFixed(2),
      description,
    },
  };
}

/** Min trades per 1 parameter (DQ5 doc). */
const TRADES_PER_PARAM_MIN = 30;
/** FAIL when tradesPerParam below this (doc: high over-fitting risk). */
const TRADES_PER_PARAM_WARN = 10;

/**
 * Module 5 - Sampling Bias & Over-fitting Propensity (DQ5). Per doc: trades per parameter.
 * REJECT if tradeCount < 30; FAIL if tradesPerParam < 10.
 */
export function validateSampling(
  tradeCount: number,
  paramCount: number,
  periodDays: number
): DQGModuleResult {
  const params = paramCount || 1;
  const tradesPerParam = tradeCount / params;
  const tradeDensity =
    periodDays > 0 ? tradeCount / periodDays : 0;

  let score = Math.min(1, tradesPerParam / TRADES_PER_PARAM_MIN);
  let verdict: DQGVerdict = "PASS";
  let description = "Sample size is statistically significant";

  if (tradeCount < 30) {
    verdict = "REJECT";
    score = 0;
    description = `Critical Under-sampling: Only ${tradeCount} trades. Need at least 30.`;
  } else if (tradesPerParam < TRADES_PER_PARAM_WARN) {
    verdict = "FAIL";
    description = `High Over-fitting Risk: Too many parameters (${paramCount}) for few trades (${tradeCount}).`;
    score *= 0.5;
  }

  return {
    module: "Sampling & Over-fitting",
    score: Math.round(Math.max(0, score) * 10000) / 10000,
    verdict,
    details: {
      tradesPerParam: tradesPerParam.toFixed(1),
      tradeDensity: tradeDensity.toFixed(2) + " trades/day",
      tradeCount,
      paramCount,
      periodDays,
      description,
    },
  };
}

/**
 * Minimum test period in days when parameter count is unknown (sampling gate).
 */
export function validateSamplingBias(
  dataRangeDays: number | null | undefined,
  minDays: number = SAMPLING_MIN_DAYS
): DQGModuleResult {
  if (dataRangeDays == null || !Number.isFinite(dataRangeDays)) {
    return {
      module: "Sampling & Over-fitting",
      score: 0,
      verdict: "REJECT",
      details: { description: "Unknown test period length" },
    };
  }
  const ratio = Math.min(1, dataRangeDays / minDays);
  const verdict: DQGVerdict =
    dataRangeDays < minDays ? "REJECT" : ratio < 1 ? "FAIL" : "PASS";
  const score = verdict === "REJECT" ? 0 : ratio;
  const description =
    dataRangeDays < minDays
      ? `Sample too small: ${dataRangeDays} days (min ${minDays})`
      : ratio >= 1
        ? "Sufficient sample length"
        : `Below recommended length (${dataRangeDays} days)`;

  return {
    module: "Sampling & Over-fitting",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details: { dataRangeDays, minDays, description },
  };
}

/**
 * Module 3 - Look-Ahead Timestamp Offset. Requires trades with entryTime and signalTime.
 * When only open_date/close_date exist, we cannot validate (entry at close is after open); skip with PASS.
 */
export function validateLookAhead(
  trades: Array<{ entryTime?: number; signalTime?: number }>,
  _timeframeMs?: number
): DQGModuleResult {
  if (!trades?.length) {
    return {
      module: "Look-Ahead Bias",
      score: 1,
      verdict: "PASS",
      details: { description: "No trades to check" },
    };
  }

  const withBoth = trades.filter(
    (t) =>
      typeof t.entryTime === "number" &&
      Number.isFinite(t.entryTime) &&
      typeof t.signalTime === "number" &&
      Number.isFinite(t.signalTime)
  );

  if (withBoth.length === 0) {
    return {
      module: "Look-Ahead Bias",
      score: 1,
      verdict: "PASS",
      details: { description: "No signal/entry timestamps - check skipped" },
    };
  }

  let violations = 0;
  for (const t of withBoth) {
    if ((t.entryTime! - t.signalTime!) < 1) violations++;
  }

  const violationRate = violations / withBoth.length;
  const score = violationRate > 0 ? 0 : 1;
  const verdict: DQGVerdict = violationRate > 0 ? "REJECT" : "PASS";
  const description =
    violationRate > 0
      ? `Look-Ahead Bias: ${violations} trades executed before or exactly at signal time.`
      : "Time causality preserved";

  return {
    module: "Look-Ahead Bias",
    score,
    verdict,
    details: {
      violationRate: (violationRate * 100).toFixed(2) + "%",
      violations,
      total: withBoth.length,
      description,
    },
  };
}

/** Order size as fraction of bar volume above which liquidity is insufficient (doc: order size >> available volume). */
const LIQUIDITY_ORDER_VS_VOLUME_REJECT = 0.5;
const LIQUIDITY_ORDER_VS_VOLUME_WARN = 0.2;

/**
 * Module 4 - Spread/Liquidity Sufficiency (DQ4). Position size vs available volume per bar.
 * When data not provided: PASS (check skipped). When provided: score from volume/position ratio.
 */
export function validateSpreadLiquidity(
  positionSize?: number,
  volumePerBar?: number
): DQGModuleResult {
  if (
    positionSize == null ||
    volumePerBar == null ||
    !Number.isFinite(positionSize) ||
    !Number.isFinite(volumePerBar) ||
    volumePerBar <= 0
  ) {
    return {
      module: "Spread/Liquidity",
      score: 1,
      verdict: "PASS",
      details: { description: "Volume data not provided - check skipped" },
    };
  }

  const ratio = positionSize / volumePerBar;
  let score = Math.max(0, 1 - ratio);
  let verdict: DQGVerdict = "PASS";
  let description = "Liquidity sufficient for order size";

  if (ratio >= LIQUIDITY_ORDER_VS_VOLUME_REJECT) {
    verdict = "REJECT";
    score = 0;
    description = `Position size (${positionSize.toFixed(0)}) too large vs bar volume (${volumePerBar.toFixed(0)}). Illiquid conditions.`;
  } else if (ratio >= LIQUIDITY_ORDER_VS_VOLUME_WARN) {
    verdict = "FAIL";
    description = `Order size is ${(ratio * 100).toFixed(0)}% of bar volume - slippage risk.`;
    score *= 0.7;
  }

  return {
    module: "Spread/Liquidity",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details: {
      positionSize,
      volumePerBar,
      ratioPct: (ratio * 100).toFixed(1),
      description,
    },
  };
}

/**
 * Module 6 - Price Integrity & Flash Crash Filter (DQ6). Bad ticks and data freezes.
 * Flash Spike: z-score (range - avgRange) / stdRange > 5 with volume; Flatline: h===l && o===c && v===0.
 * REJECT if errorRate > 0.005 (0.5%).
 */
export function validatePriceIntegrity(
  candles: Array<{
    h?: number;
    l?: number;
    o?: number;
    c?: number;
    v?: number;
    high?: number;
    low?: number;
    open?: number;
    close?: number;
    volume?: number;
  }>
): DQGModuleResult {
  if (!candles?.length || candles.length < 100) {
    return {
      module: "Price Integrity",
      score: 1,
      verdict: "PASS",
      details: {
        description:
          candles?.length != null && candles.length > 0
            ? "Insufficient bars for integrity check (min 100)"
            : "No candle data for price integrity check",
      },
    };
  }

  const ATR_PERIOD = 14;
  const FLASH_SPIKE_Z = 5; // z-score threshold (standard deviations)
  const ERROR_RATE_REJECT = 0.005;

  let badBars = 0;

  for (let i = ATR_PERIOD; i < candles.length; i++) {
    const bar = candles[i]!;
    const h = bar.h ?? bar.high ?? NaN;
    const l = bar.l ?? bar.low ?? NaN;
    const o = bar.o ?? bar.open ?? NaN;
    const c = bar.c ?? bar.close ?? NaN;
    const v = bar.v ?? bar.volume ?? 0;
    const range = Number.isFinite(h) && Number.isFinite(l) ? h - l : 0;

    const prevBars = candles.slice(i - ATR_PERIOD, i);
    const rangesPrev = prevBars.map((b) => {
      const bh = b.h ?? b.high ?? 0;
      const bl = b.l ?? b.low ?? 0;
      return Number.isFinite(bh) && Number.isFinite(bl) ? bh - bl : 0;
    });
    const avgRange = rangesPrev.reduce((s, r) => s + r, 0) / ATR_PERIOD;
    const variance =
      rangesPrev.reduce((s, r) => s + (r - avgRange) ** 2, 0) / ATR_PERIOD;
    const stdRange = variance > 0 ? Math.sqrt(variance) : 0;

    // Flash spike: z-score > 5 (not fixed multiplier, so daily trends are not filtered)
    if (stdRange > 0 && (range - avgRange) / stdRange > FLASH_SPIKE_Z && v > 0) {
      badBars++;
    }
    if (h === l && o === c && v === 0) {
      badBars++;
    }
  }

  const errorRate = badBars / candles.length;
  let score = Math.max(0, 1 - errorRate * 50);
  let verdict: DQGVerdict = "PASS";
  let description = "Price data is clean and consistent";

  if (errorRate > ERROR_RATE_REJECT) {
    verdict = "REJECT";
    score = 0;
    description = `Data Integrity Failure: Detected ${badBars} anomalous bars (Spikes or Gaps).`;
  } else if (badBars > 0) {
    description = `${badBars} anomalous bars detected (${(errorRate * 100).toFixed(3)}%).`;
  }

  return {
    module: "Price Integrity",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details: {
      anomalyCount: badBars,
      errorRate: (errorRate * 100).toFixed(3) + "%",
      total: candles.length,
      description,
    },
  };
}

/** Required raw fields for dqgA (Gap Density) per docs/DQG_RAW_PAYLOAD_SCHEMA.md. */
const DQG_A_REQUIRED = ["totalIntervals", "missingBars"] as const;
/** Required raw fields for dqgB (Price Integrity): flatBars + candlesLoaded from meta. */
const FLAT_BARS_REJECT = 0.005; // same as ERROR_RATE_REJECT

/**
 * Compute Gap Density (DQ1) module from raw terminal payload. When required fields are null/absent, return verdict N/A (docs/DQG_INSUFFICIENT_DATA_BEHAVIOR.md).
 */
export function computeGapDensityFromRaw(
  rawA: Record<string, unknown> | null | undefined
): DQGModuleResult {
  if (!rawA || typeof rawA !== "object") {
    return {
      module: "Gap Density",
      score: null,
      verdict: "N/A",
      reason: {
        code: "MODULE_NOT_PROVIDED",
        message: "dqgA raw payload not provided by terminal",
      },
    };
  }
  const totalIntervals = rawA.totalIntervals;
  const missingBars = rawA.missingBars;
  const missing: string[] = [];
  if (totalIntervals == null || typeof totalIntervals !== "number" || !Number.isFinite(totalIntervals))
    missing.push("totalIntervals");
  if (missingBars == null || typeof missingBars !== "number" || !Number.isFinite(missingBars))
    missing.push("missingBars");
  if (missing.length > 0) {
    return {
      module: "Gap Density",
      score: null,
      verdict: "N/A",
      reason: {
        code: "INSUFFICIENT_RAW_DATA",
        message: "Missing required fields for Gap Density analysis",
      },
      details: { missingFields: missing },
    };
  }
  const gapRatio =
    (totalIntervals as number) > 0
      ? (missingBars as number) / (totalIntervals as number)
      : 0;
  const maxGapSize = typeof rawA.maxGapSize === "number" && Number.isFinite(rawA.maxGapSize)
    ? rawA.maxGapSize
    : 0;
  let score = Math.max(0, 1 - gapRatio);
  if (maxGapSize > 0) {
    score *= Math.exp(-0.1 * maxGapSize);
  }
  let verdict: DQGVerdict = "PASS";
  let description = "Healthy";
  if (maxGapSize > MAX_CONSECUTIVE_GAP_BARS) {
    verdict = "REJECT";
    description = `Large data hole detected: ${maxGapSize} bars`;
    score = 0;
  } else if (gapRatio > GAP_RATIO_REJECT) {
    verdict = "FAIL";
    description = `Gap Density too high: ${(gapRatio * 100).toFixed(2)}%`;
  }
  return {
    module: "Gap Density",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details: {
      missingBars: rawA.missingBars,
      maxGap: maxGapSize,
      totalIntervals: rawA.totalIntervals,
      gapRatio,
      description,
    },
  };
}

/**
 * Compute Price Integrity (DQ6) module from raw terminal payload. When flatBars/flatBarsRatio missing, return verdict N/A.
 */
export function computePriceIntegrityFromRaw(
  rawB: Record<string, unknown> | null | undefined,
  candlesLoaded?: number | null
): DQGModuleResult {
  if (!rawB || typeof rawB !== "object") {
    return {
      module: "Price Integrity",
      score: null,
      verdict: "N/A",
      reason: {
        code: "MODULE_NOT_PROVIDED",
        message: "dqgB raw payload not provided by terminal",
      },
    };
  }
  const flatBars = rawB.flatBars;
  const flatBarsRatioVal = rawB.flatBarsRatio;
  const missing: string[] = [];
  if (flatBars == null || typeof flatBars !== "number" || !Number.isFinite(flatBars))
    missing.push("flatBars");
  if (
    flatBarsRatioVal == null ||
    typeof flatBarsRatioVal !== "number" ||
    !Number.isFinite(flatBarsRatioVal)
  )
    missing.push("flatBarsRatio");
  if (missing.length > 0) {
    return {
      module: "Price Integrity",
      score: null,
      verdict: "N/A",
      reason: {
        code: "INSUFFICIENT_RAW_DATA",
        message: "Missing required fields for Price Integrity analysis",
      },
      details: { missingFields: missing },
    };
  }
  const flatBarsRatio = flatBarsRatioVal as number;
  let score = Math.max(0, 1 - flatBarsRatio * 50);
  let verdict: DQGVerdict = "PASS";
  let description = "Price data is clean and consistent";
  if (flatBarsRatio > FLAT_BARS_REJECT) {
    verdict = "REJECT";
    score = 0;
    description = `Data Integrity Failure: Flat bars ratio ${(flatBarsRatio * 100).toFixed(3)}% exceeds threshold.`;
  } else if ((flatBars as number) > 0) {
    description = `${flatBars} flat bars detected (${(flatBarsRatio * 100).toFixed(3)}%).`;
  }
  return {
    module: "Price Integrity",
    score: Math.round(score * 10000) / 10000,
    verdict,
    details: {
      flatBars: rawB.flatBars,
      flatBarsRatio,
      total: candlesLoaded ?? undefined,
      description,
    },
  };
}

export interface DataQualityGuardInput {
  /** Trades for Outlier Influence (and Look-Ahead if entryTime/signalTime present). */
  trades?: Array<Record<string, unknown>>;
  /** Candles for Gap Density (DQ1) and Price Integrity (DQ6). Omitted when integration sends precomputed. */
  candles?: Array<Record<string, unknown>>;
  /** Timeframe in ms (e.g. 60000 for 1m). */
  timeframeMs?: number;
  /** Test period length in days (for DQ5 Sampling). */
  dataRangeDays?: number | null;
  /** Number of optimized parameters (for DQ5 trades-per-param). */
  paramCount?: number;
  /** Avg or max position/order size for DQ4 Liquidity (optional). */
  positionSize?: number;
  /** Avg or typical volume per bar for DQ4 Liquidity (optional). */
  volumePerBar?: number;
  /** Precomputed DQ1 from integration (Freqtrade) when candles not sent. */
  precomputedGapDensity?: DQGModuleResult;
  /** Precomputed DQ6 from integration when candles not sent. */
  precomputedPriceIntegrity?: DQGModuleResult;
}

const DQG_WEIGHT_PERCENT = 40;

/** Shown when Sampling is REJECT due to low trade count (roadmap to unlock DQG). */
export interface RoadmapToPass {
  currentTrades: number;
  requiredTrades: number;
}

export interface DataQualityGuardResult {
  modules: DQGModuleResult[];
  finalScore: number;
  verdict: DQGVerdict;
  /** True when DQG should block (REJECT) - overall robustness must be 0. */
  blocked: boolean;
  diagnosis?: string;
  /** DQG trust factor (0-1) used in the overall formula. Equals finalScore. */
  factor: number;
  /** Points contributed to Investability Grade (factor * DQG weight). */
  contribution: number;
  /** True when any module is REJECT (contribution is 0). */
  isCriticalFailure: boolean;
  /** When Sampling REJECT due to trade count: how many more trades to collect. */
  roadmapToPass?: RoadmapToPass;
}

/**
 * Run all six DQG modules per doc: DQ1 Gaps, DQ2 Outliers, DQ3 Look-Ahead, DQ4 Liquidity, DQ5 Sampling, DQ6 Price Integrity.
 * Final score = product of module scores. REJECT if any module 0 or final < threshold.
 */
export function runDataQualityGuard(input: DataQualityGuardInput): DataQualityGuardResult {
  const {
    trades = [],
    candles = [],
    timeframeMs = 60000 * 60,
    dataRangeDays,
    paramCount = 0,
    positionSize,
    volumePerBar,
  } = input;

  const results: DQGModuleResult[] = [];

  const gapDensity =
    input.precomputedGapDensity?.module === "Gap Density" &&
    (input.precomputedGapDensity.verdict === "PASS" ||
      input.precomputedGapDensity.verdict === "FAIL" ||
      input.precomputedGapDensity.verdict === "REJECT" ||
      input.precomputedGapDensity.verdict === "N/A")
      ? input.precomputedGapDensity
      : validateGapDensity(candles, timeframeMs);
  results.push(gapDensity);

  results.push(validateOutlierInfluence(trades));

  const tradeTimestamps = trades as Array<{ entryTime?: number; signalTime?: number }>;
  results.push(validateLookAhead(tradeTimestamps, timeframeMs));

  results.push(validateSpreadLiquidity(positionSize, volumePerBar));

  // Prefer trade-count-based Sampling (min 30 trades) whenever we have trades; otherwise fall back to period-length only.
  const periodDays = dataRangeDays ?? 0;
  if (trades.length > 0) {
    const daysForSampling = periodDays > 0 ? periodDays : 365;
    results.push(validateSampling(trades.length, paramCount, daysForSampling));
  } else {
    results.push(validateSamplingBias(dataRangeDays ?? null, 90));
  }

  const priceIntegrity =
    input.precomputedPriceIntegrity?.module === "Price Integrity" &&
    (input.precomputedPriceIntegrity.verdict === "PASS" ||
      input.precomputedPriceIntegrity.verdict === "FAIL" ||
      input.precomputedPriceIntegrity.verdict === "REJECT" ||
      input.precomputedPriceIntegrity.verdict === "N/A")
      ? input.precomputedPriceIntegrity
      : validatePriceIntegrity(candles);
  results.push(priceIntegrity);

  // N/A modules contribute 1 (neutral) so they do not worsen final score (docs/DQG_INSUFFICIENT_DATA_BEHAVIOR.md).
  const finalScore = results.reduce((p, r) => p * (r.score ?? 1), 1);
  const anyReject = results.some((r) => r.verdict === "REJECT");
  const blocked = anyReject || finalScore < DQG_FINAL_REJECT_THRESHOLD;

  const verdict: DQGVerdict =
    anyReject ? "REJECT" : finalScore < DQG_FINAL_REJECT_THRESHOLD ? "FAIL" : "PASS";

  let diagnosis: string | undefined;
  const lookAheadModule = results.find((r) => r.module === "Look-Ahead Bias");
  const samplingModule = results.find((r) => r.module === "Sampling & Over-fitting");

  if (anyReject) {
    const failed = results.filter((r) => r.verdict === "REJECT");
    diagnosis = `Data Quality Failure. ${failed.map((r) => r.details?.description ?? r.module).join(". ")} Robustness metrics may be invalidated.`;
    if (lookAheadModule?.verdict === "REJECT") {
      diagnosis += " Action: Enforce a delay (Next Bar Execution). EntryPrice = MarketData[CurrentBar + 1].Open.";
    }
    if (samplingModule?.verdict === "REJECT" || samplingModule?.verdict === "FAIL") {
      diagnosis += " Statistical Mirage: Test results have no predictive power. Effective degrees of freedom < parameter complexity. The strategy memorized history but did not understand the market.";
    }
  } else if (finalScore < 1) {
    const low = results.filter(
      (r) => typeof r.score === "number" && r.score < 1 && r.score > 0
    );
    if (low.length) {
      diagnosis = `Data Quality: ${low.map((r) => `${r.module} ${((r.score as number) * 100).toFixed(0)}%`).join(", ")}.`;
    }
    if (samplingModule?.verdict === "FAIL") {
      diagnosis = (diagnosis ?? "") + " Statistical Mirage: High over-fitting risk; sample size insufficient for parameters.";
    }
  }

  const factor = Math.round(finalScore * 10000) / 10000;
  const contribution = Math.round(factor * DQG_WEIGHT_PERCENT * 100) / 100;

  let roadmapToPass: RoadmapToPass | undefined;
  if (
    samplingModule?.verdict === "REJECT" &&
    typeof (samplingModule.details as { tradeCount?: number } | undefined)?.tradeCount === "number"
  ) {
    const current = (samplingModule.details as { tradeCount: number }).tradeCount;
    roadmapToPass = { currentTrades: current, requiredTrades: 30 };
  }

  return {
    modules: results,
    finalScore: factor,
    verdict,
    blocked,
    diagnosis,
    factor,
    contribution,
    isCriticalFailure: anyReject,
    roadmapToPass,
  };
}

/** Investability Grade (IG) per doc: DQGxweight + WFEx30 + Edgex20 + Stabilityx10. */
export type InvestabilityGradeLetter = "AAA" | "A-" | "A" | "BBB" | "C" | "D" | "F";

export interface InvestabilityGradeResult {
  score: number;
  grade: InvestabilityGradeLetter;
  isDeployable: boolean;
  /** For UI styling. */
  status: "Top-Tier" | "Investable" | "Monitor" | "Unsafe" | "TRASH";
  /** Set when execution costs were estimated (default slippage/fees). Grade is capped at A-. */
  executionWarning?: string;
}

const EDGE_BPS_FOR_FULL = 20;
const PENALTY_FACTOR_ESTIMATED = 0.95;
const IG_CAP_WHEN_ESTIMATED = 80;

/**
 * Compute Investability Grade from DQG, WFE, Net Edge and WFA pass rate.
 * IG = (DQGxweight) + (WFEx30) + (EdgeScorex20) + (Stabilityx10).
 * When executionIsEstimated: apply 0.95 penalty and cap score at 80 (max grade A-).
 */
export function getInvestabilityGrade(
  dqgScore: number,
  wfe: number,
  netEdgeBps: number,
  wfaPassRate: number,
  executionIsEstimated?: boolean
): InvestabilityGradeResult {
  const edgeScore = Math.min(1, Math.max(0, netEdgeBps / EDGE_BPS_FOR_FULL));
  const stability = Math.min(1, Math.max(0, wfaPassRate));

  let finalScore =
    dqgScore * 40 + wfe * 30 + edgeScore * 20 + stability * 10;

  if (executionIsEstimated) {
    finalScore *= PENALTY_FACTOR_ESTIMATED;
    if (finalScore > IG_CAP_WHEN_ESTIMATED) {
      finalScore = IG_CAP_WHEN_ESTIMATED;
    }
  }

  let grade: InvestabilityGradeLetter;
  let status: InvestabilityGradeResult["status"];

  if (finalScore >= 90) {
    grade = "AAA";
    status = "Top-Tier";
  } else if (finalScore >= 75) {
    grade = finalScore >= 80 ? "A" : "A-";
    status = "Investable";
  } else if (finalScore >= 60) {
    grade = "BBB";
    status = "Monitor";
  } else if (finalScore >= 30) {
    grade = finalScore >= 40 ? "C" : "D";
    status = "Unsafe";
  } else {
    grade = "F";
    status = "TRASH";
  }

  const isDeployable = grade === "AAA" || grade === "A" || grade === "A-";

  return {
    score: Math.round(finalScore * 10) / 10,
    grade,
    isDeployable,
    status,
    ...(executionIsEstimated && {
      executionWarning: "Results based on estimated costs. Slippage (5 bps) and fees (10 bps) were auto-applied. Grade capped at A-.",
    }),
  };
}
