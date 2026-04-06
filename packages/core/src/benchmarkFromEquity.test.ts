import { afterEach, describe, expect, it, vi } from "vitest";
import * as benchmarkCore from "./benchmarkCore";
import {
  buildEquityCurveFromTradesForBenchmark,
  normalizeEquityCurveFromPayload,
  tryBuildBenchmarkComparisonFromEquityPath,
  yearsBetweenIsoDates,
} from "./benchmarkFromEquity";
import * as financialMath from "./financialMath";

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const origAnnualizedVol = financialMath.calculateAnnualizedVolatility.bind(financialMath);
const origMaxDrawdown = financialMath.calculateMaxDrawdown.bind(financialMath);
const origKurtosisWinsorized = financialMath.calculateKurtosisWinsorized.bind(financialMath);

describe("benchmarkFromEquity", () => {
  it("computes years between valid ISO dates", () => {
    const years = yearsBetweenIsoDates("2024-01-01", "2025-01-01");
    expect(years).not.toBeNull();
    expect((years ?? 0) > 0.9).toBe(true);
  });

  it("returns null from yearsBetweenIsoDates for invalid or non-increasing spans", () => {
    expect(yearsBetweenIsoDates("", "2025-01-01")).toBeNull();
    expect(yearsBetweenIsoDates("2024-01-01", "2024-01-01")).toBeNull();
    expect(yearsBetweenIsoDates("2025-01-01", "2024-01-01")).toBeNull();
    expect(yearsBetweenIsoDates("not-a-date", "2025-01-01")).toBeNull();
    expect(yearsBetweenIsoDates("2024-01-01", "not-a-date-end")).toBeNull();
  });

  it("normalizes equity points and sorts by timestamp", () => {
    const out = normalizeEquityCurveFromPayload([
      { timestamp: "2024-01-02T00:00:00Z", equity: 1100 },
      { timestamp: "2024-01-01T00:00:00Z", equity: 1000 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.balance).toBe(1000);
  });

  it("normalizes timestamps in seconds and in milliseconds", () => {
    const sec = 1_704_067_200;
    const ms = sec * 1000 + 456;
    const out = normalizeEquityCurveFromPayload([
      { timestamp: sec, equity: 1000 },
      { timestamp: ms, equity: 1001 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.timestamp).toBe(sec * 1000);
    expect(out[1]!.timestamp).toBe(ms);
  });

  it("skips points with invalid or non-parseable timestamps", () => {
    const out = normalizeEquityCurveFromPayload([
      { timestamp: "not-a-real-date", equity: 1000 },
      { timestamp: null, equity: 1000 },
      { timestamp: "   ", equity: 1000 },
      { date: "2024-06-01T00:00:00Z", equity: 500 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.balance).toBe(500);
  });

  it("returns empty array for undefined input and accepts t alias for timestamp", () => {
    expect(normalizeEquityCurveFromPayload(undefined)).toEqual([]);
    const out = normalizeEquityCurveFromPayload([
      { t: 1_704_067_200_000, balance: 900 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.timestamp).toBe(1_704_067_200_000);
  });

  it("ignores non-object entries and rows with non-finite balance", () => {
    const out = normalizeEquityCurveFromPayload([
      null,
      42,
      { timestamp: "2024-01-01T00:00:00Z", equity: Number.NaN },
      { timestamp: "2024-01-02T00:00:00Z", equity: 100 },
    ] as unknown as unknown[]);
    expect(out).toHaveLength(1);
    expect(out[0]!.balance).toBe(100);
  });

  it("reads balance from value when equity and balance are absent", () => {
    const out = normalizeEquityCurveFromPayload([
      { timestamp: "2024-03-01T00:00:00Z", value: 777 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.balance).toBe(777);
  });

  it("builds equity from freqtrade-like trades", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [
        { close_date: "2024-01-01T00:00:00Z", profit_abs: 10 },
        { close_date: "2024-01-02T00:00:00Z", profit_abs: -5 },
      ],
      1000,
    );
    expect(out).toHaveLength(2);
    expect(out[1]!.balance).toBe(1005);
  });

  it("sorts trades by open_date when close_date is missing", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [
        { open_date: "2024-01-02T00:00:00Z", profit_abs: 1 },
        { open_date: "2024-01-01T00:00:00Z", profit_abs: 2 },
      ],
      1000,
    );
    expect(out[0]!.balance).toBe(1002);
    expect(out[1]!.balance).toBe(1003);
  });

  it("sorts mixed trades that use close_date on one row and open_date on another", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [
        { close_date: "2024-01-03T00:00:00Z", profit_abs: 3 },
        { open_date: "2024-01-01T00:00:00Z", profit_abs: 10 },
        { close_date: "2024-01-02T00:00:00Z", profit_abs: 5 },
      ],
      1000,
    );
    expect(out).toHaveLength(3);
    expect(out[0]!.balance).toBe(1010);
    expect(out[1]!.balance).toBe(1015);
    expect(out[2]!.balance).toBe(1018);
  });

  it("sorts trades with empty date keys using string fallback", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [
        { profit_abs: 1 },
        { profit_abs: 2 },
        { close_date: "2024-01-01T00:00:00Z", profit_abs: 100 },
      ],
      1000,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.balance).toBe(1100);
  });

  it("returns empty curve for invalid trades input or non-positive initial balance", () => {
    expect(buildEquityCurveFromTradesForBenchmark([] as unknown[], 1000)).toEqual([]);
    expect(buildEquityCurveFromTradesForBenchmark({} as unknown as unknown[], 1000)).toEqual([]);
    expect(
      buildEquityCurveFromTradesForBenchmark(
        [{ close_date: "2024-01-01T00:00:00Z", profit_abs: 1 }],
        0,
      ),
    ).toEqual([]);
  });

  it("accepts profit field when profit_abs is absent", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [{ close_date: "2024-01-01T00:00:00Z", profit: 7 }],
      1000,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.balance).toBe(1007);
  });

  it("skips updating balance when profit is not finite but still emits the bar", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [
        { close_date: "2024-01-01T00:00:00Z", profit_abs: Number.NaN },
        { close_date: "2024-01-02T00:00:00Z", profit_abs: 5 },
      ],
      1000,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.balance).toBe(1000);
    expect(out[1]!.balance).toBe(1005);
  });

  it("uses zero profit when neither profit_abs nor profit is set", () => {
    const out = buildEquityCurveFromTradesForBenchmark(
      [{ close_date: "2024-01-01T00:00:00Z" }],
      1000,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.balance).toBe(1000);
  });

  it("returns null when aligned data is insufficient", () => {
    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve: [{ timestamp: 1, balance: 1000 }],
      btcKlines: [],
      initialBalance: 1000,
      timeframeStr: "1h",
      totalReturn: 0.2,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 10,
    });
    expect(out).toBeNull();
  });

  it("returns null when only one aligned BTC bar exists", () => {
    const t0 = T0;
    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve: [
        { timestamp: t0, balance: 1000 },
        { timestamp: t0 + DAY_MS, balance: 1010 },
      ],
      btcKlines: [{ timestamp: t0, close: 50_000 }],
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.01,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 10,
    });
    expect(out).toBeNull();
  });

  it("returns null when paired returns drop below two after non-positive BTC levels", () => {
    const t0 = T0;
    const t1 = T0 + DAY_MS;
    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve: [
        { timestamp: t0, balance: 1000 },
        { timestamp: t1, balance: 1010 },
      ],
      btcKlines: [
        { timestamp: t0, close: 0 },
        { timestamp: t1, close: 50_000 },
      ],
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.01,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 10,
    });
    expect(out).toBeNull();
  });

  it("returns full benchmark object with alphaTStat when trades and history are sufficient", () => {
    const n = 40;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      const stratDaily = 0.002 + (i % 5) * 0.0004;
      const btcDaily = 0.0008 + (i % 7) * 0.00015;
      s *= 1 + stratDaily;
      b *= 1 + btcDaily;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.5,
      commissionDecimal: 0.0001,
      slippageDecimal: 0.00005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 40,
    });

    expect(out).not.toBeNull();
    expect(out!.alphaTStat).toBeDefined();
    expect(out!.nObservationsTStat).toBe(n - 1);
    if (out!.alphaTStatStdError != null) {
      expect(Number.isFinite(out!.alphaTStatStdError as number)).toBe(true);
    }
    if (out!.alphaTStatLags != null) {
      expect((out!.alphaTStatLags as number) >= 0).toBe(true);
    }
    expect(out!.breakEvenSlippagePct).toBeDefined();
    expect(out!.netEdgeBps).toBeDefined();
  });

  it("sets zeroDrawdownWarning when strategy curve is strictly increasing", () => {
    const n = 25;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1.002;
      b *= 1.001;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.4,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.zeroDrawdownWarning).toBe(true);
    expect(out!.strategyMaxDrawdown).toBe(0);
  });

  it("sets breakEvenSlippageNote when net edge is negative and break-even slippage is undefined", () => {
    const n = 30;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 0.998;
      b *= 1.002;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: -0.2,
      commissionDecimal: 0.01,
      slippageDecimal: 0.001,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.netEdgeBps).toBeDefined();
    expect((out!.netEdgeBps as number) < 0).toBe(true);
    expect(out!.breakEvenSlippagePct).toBeUndefined();
    expect(out!.breakEvenSlippageNote).toBe("N/A (edge deficit)");
  });

  it("exposes skew and kurtosis fields when enough periods are present", () => {
    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      const growth = 0.002 + (i % 11) * 0.0001 - (i % 13) * 0.00008;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1 + growth;
      b *= 1.001 + (i % 5) * 0.00005;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.3,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.strategySkewness).toBeDefined();
    expect(out!.strategyKurtosis).toBeDefined();
    expect(out!.btcSkewness).toBeDefined();
    expect(out!.btcKurtosis).toBeDefined();
  });

  it("includes winsorized kurtosis for strategy and BTC when sample kurtosis is extreme", () => {
    vi.spyOn(financialMath, "calculateKurtosis").mockReturnValue(55);

    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      const growth = 0.002 + (i % 11) * 0.0001 - (i % 13) * 0.00008;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1 + growth;
      b *= 1.001 + (i % 5) * 0.00005;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.3,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.strategyKurtosisWinsorized).toBeDefined();
    expect(out!.btcKurtosisWinsorized).toBeDefined();
  });

  it("includes btcCalmarRatio when BTC curve has a drawdown", () => {
    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1.002;
      const btcMult = i === 15 ? 0.92 : i === 16 ? 1.08 : 1.001;
      b *= btcMult;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.4,
      commissionDecimal: 0.0001,
      slippageDecimal: 0.00005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.btcCalmarRatio).toBeDefined();
    expect(Number.isFinite(out!.btcCalmarRatio as number)).toBe(true);
  });

  it("sets strategyVolatilityZeroNote when strategy is flat but BTC moves", () => {
    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: 1000 });
      btcKlines.push({ timestamp: ts, close: b });
      b *= 1.008;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0,
      commissionDecimal: 0.0001,
      slippageDecimal: 0.00005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.strategyVolatilityZeroNote).toBe(
      "Strategy volatility 0% (flat or sparse curve). Tracking Error reflects benchmark volatility.",
    );
  });

  it("omits alphaTStat when totalTrades is finite and below 30", () => {
    const n = 40;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      const stratDaily = 0.002 + (i % 5) * 0.0004;
      const btcDaily = 0.0008 + (i % 7) * 0.00015;
      s *= 1 + stratDaily;
      b *= 1 + btcDaily;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.5,
      commissionDecimal: 0.0001,
      slippageDecimal: 0.00005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 12,
    });

    expect(out).not.toBeNull();
    expect(out!.alphaTStat).toBeUndefined();
  });

  it("keeps alphaTStat when totalTrades is NaN (treated as unconstrained)", () => {
    const n = 40;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      const stratDaily = 0.002 + (i % 5) * 0.0004;
      const btcDaily = 0.0008 + (i % 7) * 0.00015;
      s *= 1 + stratDaily;
      b *= 1 + btcDaily;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.5,
      commissionDecimal: 0.0001,
      slippageDecimal: 0.00005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: Number.NaN,
    });

    expect(out).not.toBeNull();
    expect(out!.alphaTStat).toBeDefined();
  });

  it("omits default fee and slippage flags when set to false", () => {
    const n = 32;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1.002;
      b *= 1.001;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.2,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: false,
      slippagePerTradeIsDefault: false,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.feesPerTradeIsDefault).toBeUndefined();
    expect(out!.slippagePerTradeIsDefault).toBeUndefined();
  });

  it("sets dataQualityWarning when vol is low but max drawdown is extreme", () => {
    let volCalls = 0;
    let mddCalls = 0;
    vi.spyOn(financialMath, "calculateAnnualizedVolatility").mockImplementation((r, p) => {
      volCalls++;
      if (volCalls === 1) return 0.04;
      return origAnnualizedVol(r, p);
    });
    vi.spyOn(financialMath, "calculateMaxDrawdown").mockImplementation((curve) => {
      mddCalls++;
      if (mddCalls === 1) return 28;
      return origMaxDrawdown(curve);
    });

    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1.002;
      b *= 1.001;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.3,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.dataQualityWarning).toBe(
      "Data mismatch: strategy volatility and max drawdown are inconsistent. Possible column mix-up.",
    );
  });

  it("omits strategyKurtosisWinsorized when winsorized value is not finite (strategy computed first)", () => {
    vi.spyOn(financialMath, "calculateKurtosis").mockReturnValue(55);
    let winsorCalls = 0;
    vi.spyOn(financialMath, "calculateKurtosisWinsorized").mockImplementation((values, tail) => {
      winsorCalls++;
      if (winsorCalls === 1) return Number.NaN;
      return origKurtosisWinsorized(values, tail ?? 0.01);
    });

    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      const growth = 0.002 + (i % 11) * 0.0001 - (i % 13) * 0.00008;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1 + growth;
      b *= 1.001 + (i % 5) * 0.00005;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.3,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.strategyKurtosisWinsorized).toBeUndefined();
    expect(out!.btcKurtosisWinsorized).toBeDefined();
  });

  it("uses periodsPerYear zero branch when interval resolves to zero ms", () => {
    vi.spyOn(financialMath, "timeframeToMs").mockReturnValue(null);
    vi.spyOn(benchmarkCore, "intervalMs").mockReturnValue(0);

    const n = 32;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1.002;
      b *= 1.001;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.2,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
  });

  it("omits btcKurtosisWinsorized when second winsorized result is not finite", () => {
    vi.spyOn(financialMath, "calculateKurtosis").mockReturnValue(55);
    let winsorCalls = 0;
    vi.spyOn(financialMath, "calculateKurtosisWinsorized").mockImplementation((values, tail) => {
      winsorCalls++;
      if (winsorCalls === 2) return Number.NaN;
      return origKurtosisWinsorized(values, tail ?? 0.01);
    });

    const n = 35;
    const equityCurve: { timestamp: number; balance: number }[] = [];
    const btcKlines: { timestamp: number; close: number }[] = [];
    let s = 1000;
    let b = 50_000;
    for (let i = 0; i < n; i++) {
      const ts = T0 + i * DAY_MS;
      const growth = 0.002 + (i % 11) * 0.0001 - (i % 13) * 0.00008;
      equityCurve.push({ timestamp: ts, balance: s });
      btcKlines.push({ timestamp: ts, close: b });
      s *= 1 + growth;
      b *= 1.001 + (i % 5) * 0.00005;
    }

    const out = tryBuildBenchmarkComparisonFromEquityPath({
      equityCurve,
      btcKlines,
      initialBalance: 1000,
      timeframeStr: "1d",
      totalReturn: 0.3,
      commissionDecimal: 0.001,
      slippageDecimal: 0.0005,
      feesPerTradeIsDefault: true,
      slippagePerTradeIsDefault: true,
      totalTrades: 35,
    });

    expect(out).not.toBeNull();
    expect(out!.strategyKurtosisWinsorized).toBeDefined();
    expect(out!.btcKurtosisWinsorized).toBeUndefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
