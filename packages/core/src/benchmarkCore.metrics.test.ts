import { describe, expect, it } from "vitest";
import {
  alignStrategyEquityToBtcTimestamps,
  barReturnsFromAlignedEquity,
  benchmarkBreakEvenSlippagePctFromMeanExcess,
  benchmarkDataQualityWarningFromVolDrawdown,
  benchmarkNetEdgeBpsFromMeanExcess,
  benchmarkSafeKurtosisForApi,
  benchmarkSafeSkewnessForApi,
  benchmarkStrategyCagrFromTotalReturn,
  benchmarkStrategyVolatilityZeroNote,
  buildBenchmarkFallbackComparison,
  buildBenchmarkInterpretation,
  buildCandleGrid,
  excessReturnsPerPeriod,
  geometricExcessReturnPct,
  hasGapsInKlines,
  intervalMs,
  meanOfNumbers,
  normalizeKlines,
  parseBenchmarkInterval,
  periodReturnsFromStrategyBtcAligned,
  recoverBarAlignedReturns,
  toNumber,
} from "./benchmarkCore";

describe("benchmarkCore metrics helpers", () => {
  it("geometricExcessReturnPct", () => {
    expect(geometricExcessReturnPct(20, 10)).toBeCloseTo(
      (1.2 / 1.1 - 1) * 100,
      5,
    );
    expect(Number.isNaN(geometricExcessReturnPct(Number.NaN, 1))).toBe(true);
    expect(Number.isNaN(geometricExcessReturnPct(10, -150))).toBe(true);
  });

  it("toNumber", () => {
    expect(toNumber(42)).toBe(42);
    expect(toNumber("3.5")).toBe(3.5);
    expect(Number.isNaN(toNumber("x"))).toBe(true);
    expect(Number.isNaN(toNumber(undefined))).toBe(true);
  });

  it("parseBenchmarkInterval", () => {
    expect(parseBenchmarkInterval("1H")).toBe("1h");
    expect(parseBenchmarkInterval("1m")).toBe("1m");
    expect(parseBenchmarkInterval("1M")).toBe("1M");
    expect(parseBenchmarkInterval("60m")).toBe("1h");
    expect(parseBenchmarkInterval("1mo")).toBe("1M");
    expect(parseBenchmarkInterval("unknown")).toBe("1h");
    expect(parseBenchmarkInterval("15m")).toBe("15m");
    expect(parseBenchmarkInterval("3d")).toBe("3d");
    expect(parseBenchmarkInterval("1w")).toBe("1w");
  });
});

describe("normalizeKlines", () => {
  it("parses Binance array rows", () => {
    const rows = [[1000, 1, 2, 3, 99, 0]];
    expect(normalizeKlines(rows)).toEqual([{ timestamp: 1000, close: 99 }]);
  });

  it("parses object rows and sorts by timestamp", () => {
    const rows = [
      { timestamp: 2000, close: 2 },
      { openTime: 1000, c: 1 },
    ];
    expect(normalizeKlines(rows as unknown[])).toEqual([
      { timestamp: 1000, close: 1 },
      { timestamp: 2000, close: 2 },
    ]);
  });
});

describe("alignStrategyEquityToBtcTimestamps", () => {
  it("forward-fills strategy on BTC grid", () => {
    const curve = [
      { timestamp: 1000, balance: 100 },
      { timestamp: 2500, balance: 110 },
    ];
    const btc = [
      { timestamp: 1000, close: 50_000 },
      { timestamp: 2000, close: 51_000 },
      { timestamp: 3000, close: 52_000 },
    ];
    const aligned = alignStrategyEquityToBtcTimestamps(curve, btc, 1000);
    expect(aligned).toEqual([
      { timestamp: 1000, strategy: 100, btc: 50_000 },
      { timestamp: 2000, strategy: 100, btc: 51_000 },
      { timestamp: 3000, strategy: 110, btc: 52_000 },
    ]);
  });

  it("advances through multiple strategy points before the first BTC bar", () => {
    const curve = [
      { timestamp: 100, balance: 100 },
      { timestamp: 200, balance: 105 },
      { timestamp: 300, balance: 108 },
    ];
    const btc = [{ timestamp: 400, close: 1 }];
    const aligned = alignStrategyEquityToBtcTimestamps(curve, btc, 50);
    expect(aligned).toEqual([{ timestamp: 400, strategy: 108, btc: 1 }]);
  });

  it("returns empty when no BTC klines", () => {
    expect(alignStrategyEquityToBtcTimestamps([], [], 100)).toEqual([]);
  });
});

describe("periodReturnsFromStrategyBtcAligned", () => {
  it("computes paired simple returns", () => {
    const aligned = [
      { timestamp: 0, strategy: 100, btc: 1 },
      { timestamp: 1, strategy: 110, btc: 1.1 },
    ];
    const { strategyReturns, btcReturns } = periodReturnsFromStrategyBtcAligned(aligned);
    expect(strategyReturns).toHaveLength(1);
    expect(btcReturns).toHaveLength(1);
    expect(strategyReturns[0]).toBeCloseTo(0.1, 10);
    expect(btcReturns[0]).toBeCloseTo(0.1, 10);
  });

  it("skips bar when prior strategy or btc is non-positive", () => {
    const aligned = [
      { timestamp: 0, strategy: 0, btc: 1 },
      { timestamp: 1, strategy: 100, btc: 1.05 },
    ];
    expect(periodReturnsFromStrategyBtcAligned(aligned)).toEqual({
      strategyReturns: [],
      btcReturns: [],
    });
  });
});

describe("benchmark excess / edge helpers", () => {
  it("meanOfNumbers and excessReturnsPerPeriod", () => {
    expect(Number.isNaN(meanOfNumbers([]))).toBe(true);
    expect(meanOfNumbers([0.1, 0.2])).toBeCloseTo(0.15, 10);
    const xs = excessReturnsPerPeriod([0.2, 0.1], [0.05, 0.15]);
    expect(xs[0]).toBeCloseTo(0.15, 10);
    expect(xs[1]).toBeCloseTo(-0.05, 10);
  });

  it("benchmarkBreakEvenSlippagePctFromMeanExcess", () => {
    const commission = 0.001;
    expect(benchmarkBreakEvenSlippagePctFromMeanExcess(0.01, commission)).toBeCloseTo(0.4, 5);
    expect(benchmarkBreakEvenSlippagePctFromMeanExcess(0.001, commission)).toBeUndefined();
  });

  it("benchmarkNetEdgeBpsFromMeanExcess", () => {
    const commission = 0.001;
    const slip = 0.0005;
    expect(benchmarkNetEdgeBpsFromMeanExcess(0.01, commission, slip)).toBe(70);
    expect(benchmarkNetEdgeBpsFromMeanExcess(0, commission, slip)).toBe(-30);
    expect(benchmarkNetEdgeBpsFromMeanExcess(0.01, commission, Number.NaN)).toBeUndefined();
  });

  it("benchmarkBreakEvenSlippagePctFromMeanExcess returns undefined on non-finite edge", () => {
    expect(benchmarkBreakEvenSlippagePctFromMeanExcess(Number.NaN, 0.001)).toBeUndefined();
  });
});

describe("benchmarkCore grid and gap helpers", () => {
  it("intervalMs covers common keys", () => {
    expect(intervalMs("3m")).toBe(3 * 60 * 1000);
    expect(intervalMs("1M")).toBeGreaterThan(20 * 24 * 60 * 60 * 1000);
    expect(intervalMs("unknown")).toBe(60 * 60 * 1000);
  });

  it("hasGapsInKlines detects sparse series", () => {
    const dense = [
      { timestamp: 0, close: 1 },
      { timestamp: 60_000, close: 2 },
    ];
    expect(hasGapsInKlines(dense, "1m", 0, 60_000)).toBe(false);
    expect(hasGapsInKlines([dense[0]!], "1m", 0, 60_000)).toBe(true);
    const gappy = [
      { timestamp: 0, close: 1 },
      { timestamp: 10 * 60_000, close: 2 },
    ];
    expect(hasGapsInKlines(gappy, "1m", 0, 10 * 60_000)).toBe(true);
  });

  it("buildCandleGrid and recoverBarAlignedReturns", () => {
    expect(buildCandleGrid(1000, 500, "1h")).toEqual([]);
    const grid = buildCandleGrid(0, 2 * 60_000, "1m");
    expect(grid.length).toBeGreaterThan(0);
    const recovered = recoverBarAlignedReturns(
      [
        { timestamp: 0, balance: 100 },
        { timestamp: 60_000, balance: 110 },
      ],
      0,
      120_000,
      "1m",
      100,
    );
    expect(recovered.returns.length).toBeGreaterThan(0);
  });

  it("barReturnsFromAlignedEquity pushes zero when prior balance is non-positive", () => {
    const aligned = [
      { timestamp: 0, balance: 0 },
      { timestamp: 1, balance: 100 },
    ];
    expect(barReturnsFromAlignedEquity(aligned)).toEqual([0]);
  });
});

describe("excessReturnsPerPeriod", () => {
  it("uses zero when btc return slot is missing", () => {
    const strat = [0.1, 0.05];
    const btc = [0.02];
    const xs = excessReturnsPerPeriod(strat, btc);
    expect(xs).toHaveLength(1);
    expect(xs[0]).toBeCloseTo(0.08, 10);
  });

  it("treats sparse btc array slots as zero", () => {
    const strat = [0.1, 0.2];
    const btc: number[] = [];
    btc[0] = 0.05;
    btc[2] = 0.03;
    const xs = excessReturnsPerPeriod(strat, btc);
    expect(xs[0]).toBeCloseTo(0.05, 10);
    expect(xs[1]).toBeCloseTo(0.2, 10);
  });
});

describe("buildBenchmarkFallbackComparison", () => {
  it("produces interpretation and null correlation", () => {
    const klines = [
      { timestamp: 0, close: 100 },
      { timestamp: 86_400_000, close: 110 },
    ];
    const r = buildBenchmarkFallbackComparison({
      totalReturn: 0.05,
      btcKlines: klines,
      years: 1,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
    });
    expect(r.correlationToBTC).toBeNull();
    expect(r.interpretation.length).toBeGreaterThan(0);
  });

  it("uses default fee/slip when inputs are non-finite and applies optional default flags", () => {
    const klines = [
      { timestamp: 0, close: 100 },
      { timestamp: 86_400_000, close: 110 },
    ];
    const r = buildBenchmarkFallbackComparison({
      totalReturn: 0.02,
      btcKlines: klines,
      years: 1,
      commissionDecimal: Number.NaN,
      slippageDecimal: Number.NaN,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
    });
    expect(r.feesPerTradeIsDefault).toBe(true);
    expect(r.slippagePerTradeIsDefault).toBe(true);
    expect(Number.isFinite(r.feesPerTrade)).toBe(true);
  });
});

describe("benchmarkStrategyCagrFromTotalReturn", () => {
  it("returns NaN for invalid years and treats NaN total return as zero growth", () => {
    expect(Number.isNaN(benchmarkStrategyCagrFromTotalReturn(0.1, 0))).toBe(true);
    expect(Number.isNaN(benchmarkStrategyCagrFromTotalReturn(0.1, Number.NaN))).toBe(true);
    expect(benchmarkStrategyCagrFromTotalReturn(Number.NaN, 2)).toBeCloseTo(0, 5);
  });
});

describe("benchmarkDataQualityWarningFromVolDrawdown", () => {
  it("warns on low vol and high drawdown", () => {
    expect(benchmarkDataQualityWarningFromVolDrawdown(3, 25)).toContain("Data mismatch");
    expect(benchmarkDataQualityWarningFromVolDrawdown(10, 25)).toBeUndefined();
  });
});

describe("buildBenchmarkInterpretation", () => {
  it("covers alpha, IR, and correlation branches", () => {
    expect(buildBenchmarkInterpretation(1, 0.6, 0.1)).toEqual([
      "Strategy generates positive alpha",
      "Alpha quality is meaningful relative to tracking error",
      "Provides diversification benefit",
    ]);
    expect(buildBenchmarkInterpretation(-1, 0.1, 0.5)).toEqual([
      "Strategy underperforms BTC buy-and-hold",
      "Alpha quality is weak and may be unstable",
      "Partially correlated to BTC",
    ]);
    expect(buildBenchmarkInterpretation(0, -0.1, undefined)).toEqual([
      "Strategy underperforms BTC buy-and-hold",
      "Alpha quality is negative after adjusting for tracking error",
    ]);
    expect(buildBenchmarkInterpretation(1, 0.6, 0.85)).toContain("Highly correlated to BTC");
  });
});

describe("benchmarkSafeSkewnessForApi and benchmarkSafeKurtosisForApi", () => {
  it("rounds finite values and drops non-finite", () => {
    expect(benchmarkSafeSkewnessForApi(1.234)).toBe(1.23);
    expect(benchmarkSafeSkewnessForApi(Number.NaN)).toBeUndefined();
    expect(benchmarkSafeKurtosisForApi(3.3)).toBe(3.3);
    expect(benchmarkSafeKurtosisForApi(50, 20)).toBe(20);
    expect(benchmarkSafeKurtosisForApi(Number.NaN)).toBeUndefined();
  });
});

describe("benchmarkStrategyVolatilityZeroNote", () => {
  it("returns note when vol is zero but tracking error is positive", () => {
    expect(String(benchmarkStrategyVolatilityZeroNote(0, 2.5))).toContain("Strategy volatility 0%");
    expect(benchmarkStrategyVolatilityZeroNote(1, 2.5)).toBeUndefined();
    expect(benchmarkStrategyVolatilityZeroNote(0, 0)).toBeUndefined();
  });
});
