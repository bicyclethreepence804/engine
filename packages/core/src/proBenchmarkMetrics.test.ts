import { afterEach, describe, expect, it, vi } from "vitest";
import * as financialMath from "./financialMath";
import * as wfeFormulas from "./wfeFormulas";
import {
  computeProBenchmarkFromBacktest,
  fillProMetricsFromWfaPeriods,
  psiDetailsCalculator,
} from "./proBenchmarkMetrics";

describe("proBenchmarkMetrics", () => {
  it("sets windowsCount and insufficientWindowsWarning for single window", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.2 },
      [{ balance: 1000 }, { balance: 1100 }],
      [],
      { periods: [{ optimizationReturn: 0.1, validationReturn: 0.05 }] },
      {},
    );

    expect(out.windowsCount).toBe(1);
    expect(out.insufficientWindowsWarning).toBe(true);
  });

  it("uses existing windowsCount when WFA lists are absent", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.1 },
      [],
      [],
      null,
      { windowsCount: 12 } as Record<string, unknown>,
    );
    expect(out.windowsCount).toBe(12);
  });

  it("treats null existingMetrics like an empty object for the spread", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.07 },
      [{ balance: 100 }, { balance: 105 }],
      [],
      null,
      null,
    );
    expect(out.optimizationGain).toBe(0.07);
  });

  it("parses string parameter values for PSI windows", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { len: "10", step: "0.5" } },
        { optimizationReturn: 0.1, validationReturn: 0.04, parameters: { len: "20", step: "1" } },
      ],
    });
    expect(merged.parameterStabilityIndex).toBeDefined();
  });

  it("ignores non-object parameters when building PSI windows", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: 1 as unknown as Record<string, unknown>,
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.04,
          parameters: 2 as unknown as Record<string, unknown>,
        },
      ],
    });
    expect(merged.parameterStabilityIndex).toBeUndefined();
  });

  it("respects skipMetricDefinitionFields in WFA fill", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(
      merged,
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.05 },
          { optimizationReturn: 0.08, validationReturn: 0.03 },
          { optimizationReturn: 0.09, validationReturn: 0.04 },
        ],
      },
      { skipMetricDefinitionFields: true },
    );

    expect(merged.sumIs).toBeUndefined();
    expect(merged.sumOos).toBeUndefined();
    expect(merged.wfeDistribution).toBeUndefined();
  });

  it("caps WFE ratio at winsorize threshold and computes distribution", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.8 }, // 8 -> cap to 3
        { optimizationReturn: 0.1, validationReturn: 0.2 }, // 2
        { optimizationReturn: 0.1, validationReturn: 0.1 }, // 1
      ],
    });

    const dist = merged.wfeDistribution as
      | { min?: number; median?: number; max?: number }
      | undefined;
    expect(dist).toBeDefined();
    expect(dist?.max).toBe(3);
    expect(dist?.median).toBe(2);
    expect(dist?.min).toBe(1);
  });

  it("drops retention and WFE distribution when sumIs is near zero", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 1e-12, validationReturn: 0.1 },
        { optimizationReturn: -1e-12, validationReturn: 0.05 },
        { optimizationReturn: 0, validationReturn: -0.02 },
      ],
    });

    expect(merged.sumIs).toBeDefined();
    expect(merged.oosRetention).toBeUndefined();
    expect(merged.wfeDistribution).toBeUndefined();
    expect(typeof merged.optimizationGain).toBe("number");
  });

  it("fills regime matrix, market bias, streak and edge half-life branches", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.12, validationReturn: 0.06, regime: "bull", startDate: "2024-01-01", endDate: "2024-01-31" },
        { optimizationReturn: 0.1, validationReturn: -0.01, regime: "bear", startDate: "2024-02-01", endDate: "2024-02-29" },
        { optimizationReturn: 0.09, validationReturn: 0.01, regime: "high_vol", startDate: "2024-03-01", endDate: "2024-03-31" },
        { optimizationReturn: 0.08, validationReturn: -0.03, regime: "range", startDate: "2024-04-01", endDate: "2024-04-30" },
      ],
    });

    expect(merged.regimeSurvivalMatrix).toBeDefined();
    expect(typeof merged.marketBias).toBe("string");
    expect(typeof merged.killSwitchMaxOosDrawdownWindows).toBe("number");
    expect(typeof merged.profitableWindowsRatio).toBe("number");
  });

  it("sets small-N flags for negative OOS CVaR branch", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.03 },
        { optimizationReturn: 0.11, validationReturn: -0.02 },
        { optimizationReturn: 0.12, validationReturn: 0.01 },
        { optimizationReturn: 0.1, validationReturn: -0.015 },
      ],
    });

    if (typeof merged.oosCvar95 === "number") {
      expect(merged.oosCvar95).toBeLessThan(0);
      expect(merged.oosCvar95SmallN).toBe(true);
      expect(typeof merged.oosCvar95TailSize).toBe("number");
    }
  });

  it("builds fingerprint variants by retention thresholds", () => {
    const low: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(low, {
      periods: [
        { optimizationReturn: 0.2, validationReturn: 0.05 },
        { optimizationReturn: 0.2, validationReturn: 0.04 },
        { optimizationReturn: 0.2, validationReturn: 0.03 },
      ],
    });
    expect(low.strategyFingerprint).toBe("Regime-dependent");

    const high: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(high, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.11 },
        { optimizationReturn: 0.09, validationReturn: 0.1 },
        { optimizationReturn: 0.08, validationReturn: 0.09 },
      ],
    });
    expect(high.strategyFingerprint).toBe("Momentum-like");
  });

  it("keeps existing fingerprint and killSwitch streak when already provided", () => {
    const merged: Record<string, unknown> = {
      strategyFingerprint: "Preset",
      killSwitchMaxOosDrawdownWindows: 9,
    };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.01 },
        { optimizationReturn: 0.1, validationReturn: -0.02 },
      ],
    });
    expect(merged.strategyFingerprint).toBe("Preset");
    expect(merged.killSwitchMaxOosDrawdownWindows).toBe(9);
  });

  it("sets insufficient windows warning branch when periods < 2", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [{ optimizationReturn: 0.1, validationReturn: 0.04 }],
    });
    expect(merged.insufficientWindowsWarning).toBe(true);
  });

  it("classifies Hybrid fingerprint when retention is between 0.6 and 0.9", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.07 },
        { optimizationReturn: 0.1, validationReturn: 0.07 },
        { optimizationReturn: 0.1, validationReturn: 0.07 },
      ],
    });
    expect(merged.strategyFingerprint).toBe("Hybrid");
  });

  it("uses windows array length when periods is missing", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.15 },
      [{ balance: 100 }, { balance: 101 }, { balance: 103 }],
      [],
      { windows: [{}, {}] } as Record<string, unknown>,
      {},
    );
    expect(out.windowsCount).toBe(2);
    expect(out.avgOosSharpe).toBeDefined();
    expect(out.oosRetention).toBeDefined();
  });

  it("accepts plain numeric equity curve points", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.1 },
      [100, 101, 102, 103],
      [],
      { periods: [{}, {}] } as Record<string, unknown>,
      {},
    );
    expect(out.avgOosSharpe).toBeDefined();
  });

  it("reads curve level from value when balance is absent", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.1 },
      [{ value: 100 }, { value: 102 }, { value: 104 }],
      [],
      { periods: [{}, {}] } as Record<string, unknown>,
      {},
    );
    expect(out.avgOosSharpe).toBeDefined();
  });

  it("skips segments when extracted balance is not finite", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.1 },
      [{ balance: 100 }, { balance: Number.NaN }, { balance: 104 }],
      [],
      { periods: [{}, {}] } as Record<string, unknown>,
      {},
    );
    expect(out).toBeDefined();
  });

  it("skips equity segments when a curve point is nullish", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.1 },
      [100, null, 104] as unknown[],
      [],
      { periods: [{}, {}] } as Record<string, unknown>,
      {},
    );
    expect(out).toBeDefined();
  });

  it("reads equity curve balances from equity field and sets segment wfeDistribution", () => {
    const points: { equity: number }[] = [];
    let v = 100;
    for (let i = 0; i < 12; i++) {
      v *= i < 4 ? 1.02 : i < 8 ? 0.98 : 1.01;
      points.push({ equity: v });
    }
    const out = computeProBenchmarkFromBacktest({ totalReturn: 0.1 }, points, [], null, {});
    expect(out.wfeDistribution).toBeDefined();
    expect(out.wfeDistribution?.min).toBeDefined();
  });

  it("sets avgOosSharpe to 0 when equity returns have zero variance", () => {
    const out = computeProBenchmarkFromBacktest(
      { totalReturn: 0.05 },
      [{ balance: 1000 }, { balance: 1000 }, { balance: 1000 }],
      [],
      { periods: [{}, {}] } as Record<string, unknown>,
      {},
    );
    expect(out.avgOosSharpe).toBe(0);
  });

  it("clears preset edgeHalfLife when profitable windows ratio is below 0.5", () => {
    const merged: Record<string, unknown> = {
      edgeHalfLife: { windows: 2, days: 14 },
    };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.02 },
        { optimizationReturn: 0.1, validationReturn: -0.01 },
        { optimizationReturn: 0.1, validationReturn: -0.03 },
        { optimizationReturn: 0.1, validationReturn: 0.01 },
      ],
    });
    expect(merged.profitableWindowsRatio).toBeLessThan(0.5);
    expect(merged.edgeHalfLife).toBeUndefined();
  });

  it("sets avgOosCalmar and oosMaxDrawdownFromWfa from validation drawdown path", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.08, validationStartDate: "2024-01-01", validationEndDate: "2024-01-31" },
        { optimizationReturn: 0.1, validationReturn: -0.04, validationStartDate: "2024-02-01", validationEndDate: "2024-02-29" },
        { optimizationReturn: 0.1, validationReturn: -0.05, validationStartDate: "2024-03-01", validationEndDate: "2024-03-31" },
        { optimizationReturn: 0.1, validationReturn: 0.02, validationStartDate: "2024-04-01", validationEndDate: "2024-04-30" },
      ],
    });
    expect(typeof merged.avgOosCalmar).toBe("number");
    expect(merged.oosMaxDrawdownFromWfa).toBeDefined();
    expect(Number(merged.oosMaxDrawdownFromWfa)).toBeLessThan(0);
  });

  it("logs engineWarn when CVaR exceeds mean OOS under debug flag", () => {
    const prev = process.env.KIPLOKS_ENGINE_DEBUG;
    process.env.KIPLOKS_ENGINE_DEBUG = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cvarSpy = vi.spyOn(wfeFormulas, "calcWfeCvar95").mockReturnValue(0.05);

    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.02 },
        { optimizationReturn: 0.1, validationReturn: -0.02 },
        { optimizationReturn: 0.1, validationReturn: -0.02 },
      ],
    });

    expect(warnSpy).toHaveBeenCalled();
    const payload = warnSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && String(c[0]).includes("OOS CVaR 95%"),
    );
    expect(payload).toBeDefined();

    cvarSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.KIPLOKS_ENGINE_DEBUG = prev;
  });

  it("logs engineWarn on sumOos mismatch when skipMetricDefinitionFields keeps wrong sumOos", () => {
    const prev = process.env.KIPLOKS_ENGINE_DEBUG;
    process.env.KIPLOKS_ENGINE_DEBUG = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const merged: Record<string, unknown> = { sumOos: 9.99 };
    fillProMetricsFromWfaPeriods(
      merged,
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.01 },
          { optimizationReturn: 0.1, validationReturn: 0.02 },
        ],
      },
      { skipMetricDefinitionFields: true },
    );

    const mismatch = warnSpy.mock.calls.find(
      (c) => typeof c[0] === "string" && String(c[0]).includes("sumOos mismatch"),
    );
    expect(mismatch).toBeDefined();

    warnSpy.mockRestore();
    process.env.KIPLOKS_ENGINE_DEBUG = prev;
  });

  it("sets PSI to stable with psiNote when parameters are identical across windows", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { len: 14, rsi: 55 } },
        { optimizationReturn: 0.1, validationReturn: 0.04, parameters: { len: 14, rsi: 55 } },
        { optimizationReturn: 0.1, validationReturn: 0.06, params: { len: 14, rsi: 55 } },
      ],
    });
    expect(merged.parameterStabilityIndex).toBe(0);
    expect(merged.psiNote).toBe("stable");
  });

  it("sets finite parameterStabilityIndex when parameters drift across windows", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05, optimization_params: { width: 10 } },
        { optimizationReturn: 0.1, validationReturn: 0.04, optimized_params: { width: 20 } },
        { optimizationReturn: 0.1, validationReturn: 0.06, optimization_params: { width: 30 } },
      ],
    });
    expect(merged.parameterStabilityIndex).toBeDefined();
    expect(Number.isFinite(merged.parameterStabilityIndex as number)).toBe(true);
    expect((merged.parameterStabilityIndex as number) > 0).toBe(true);
    expect(merged.psiNote).toBeUndefined();
  });

  it("sets marketBias to Bearish when bear regimes outnumber bull and sideways", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bear" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bear_market" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bearish" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bull" },
      ],
    });
    expect(merged.marketBias).toBe("Bearish");
  });

  it("sets marketBias to Sideways when bull and bear do not dominate sideways count", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bull" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bear" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "range" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "chop" },
      ],
    });
    expect(merged.marketBias).toBe("Sideways");
  });

  it("reads periods from wfa.windows when periods array is absent", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      windows: [
        { optimizationReturn: 0.1, validationReturn: 0.05 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
      ],
    } as Record<string, unknown>);
    expect(merged.sumIs).toBeDefined();
    expect(merged.sumOos).toBeDefined();
  });

  it("uses even-length median for wfeDistribution when four IS-positive windows exist", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05 },
        { optimizationReturn: 0.1, validationReturn: 0.06 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
        { optimizationReturn: 0.1, validationReturn: 0.055 },
      ],
    });
    const dist = merged.wfeDistribution as { median?: number } | undefined;
    expect(dist).toBeDefined();
    expect(dist?.median).toBeCloseTo(0.525, 5);
  });

  it("sets marketBias to Bullish when bull regimes lead bear and sideways", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bull" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bull_run" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "bullish" },
        { optimizationReturn: 0.1, validationReturn: 0.02, regime: "range" },
      ],
    });
    expect(merged.marketBias).toBe("Bullish");
  });

  it("no-ops fillProMetricsFromWfaPeriods when wfa has no period or window arrays", () => {
    const merged: Record<string, unknown> = { sumOos: 1 };
    fillProMetricsFromWfaPeriods(merged, {});
    expect(Object.keys(merged)).toEqual(["sumOos"]);

    fillProMetricsFromWfaPeriods(merged, {
      periods: "not-an-array",
      windows: null,
    } as Record<string, unknown>);
    expect(merged.sumOos).toBe(1);
  });

  it("reads period returns from metrics and snake_case aliases", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimization_return: 0.1,
          validation_return: 0.04,
        },
        {
          metrics: {
            optimization: { totalReturn: 0.11 },
            validation: { total: 0.05 },
          },
        },
        {
          metrics: {
            optimization: { total: 0.09 },
            validation: { total_return: 0.03 },
          },
        },
      ],
    });
    expect(merged.sumIs).toBeCloseTo(0.3, 5);
    expect(merged.sumOos).toBeCloseTo(0.12, 5);
  });

  it("reads optimization return from metrics.optimization.total_return", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          metrics: {
            optimization: { total_return: 0.12 },
            validation: { totalReturn: 0.05 },
          },
        },
        {
          metrics: {
            optimization: { total_return: 0.1 },
            validation: { totalReturn: 0.04 },
          },
        },
      ],
    });
    expect(merged.sumIs).toBeCloseTo(0.22, 5);
    expect(merged.sumOos).toBeCloseTo(0.09, 5);
  });

  it("uses top three parameter keys by dispersion when more than three drift", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: { w: 10, x: 1, y: 1, z: 1, u: 0 },
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: { w: 30, x: 3, y: 2, z: 2, u: 0 },
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: { w: 50, x: 5, y: 4, z: 3, u: 0 },
        },
      ],
    });
    expect(merged.parameterStabilityIndex).toBeDefined();
    expect(Number.isFinite(merged.parameterStabilityIndex as number)).toBe(true);
  });

  it("skips PSI drift for a key when a window omits that parameter", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: { w: 10, x: 1, y: 1, z: 1 },
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: { x: 2, y: 2, z: 2 },
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          parameters: { w: 50, x: 5, y: 4, z: 3 },
        },
      ],
    });
    expect(merged.parameterStabilityIndex).toBeDefined();
  });

  it("sets avgOosSharpe to 0 when all validation returns are identical", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.04 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
      ],
    });
    expect(merged.avgOosSharpe).toBe(0);
    expect(merged.avgOosStdReturn).toBe(0);
  });

  it("uses half-life fallback when ACF does not yield finite periods", () => {
    vi.spyOn(financialMath, "calculateEdgeHalfLifeFromAcf").mockImplementation((returns) => {
      const rho = financialMath.calculateAutocorrelationLag1(returns);
      return { periods: Number.NaN, rho1: rho };
    });

    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimizationReturn: 0.1,
          validationReturn: 0.2,
          validationStartDate: "2024-01-01",
          validationEndDate: "2024-01-31",
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.08,
          validationStartDate: "2024-02-01",
          validationEndDate: "2024-02-29",
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          validationStartDate: "2024-03-01",
          validationEndDate: "2024-03-31",
        },
      ],
    });

    expect(merged.edgeHalfLife).toBeDefined();
    expect(Number.isFinite((merged.edgeHalfLife as { windows: number }).windows)).toBe(true);
  });

  it("skips rebuilding wfeDistribution when preset median is already finite", () => {
    const merged: Record<string, unknown> = {
      wfeDistribution: { min: 0.1, median: 0.55, max: 0.9, variance: 0.02 },
    };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
        { optimizationReturn: 0.1, validationReturn: 0.06 },
      ],
    });
    expect((merged.wfeDistribution as { median: number }).median).toBe(0.55);
  });

  it("does not set oosRetention from calcRetention when only one period exists", () => {
    const merged: Record<string, unknown> = { strategyFingerprint: "Custom" };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [{ optimizationReturn: 0.2, validationReturn: 0.06 }],
    });
    expect(merged.sumIs).toBe(0.2);
    expect(merged.oosRetention).toBeUndefined();
  });

  it("keeps preset oosDominanceRatio when already finite", () => {
    const merged: Record<string, unknown> = { oosDominanceRatio: 0.42 };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.11 },
        { optimizationReturn: 0.1, validationReturn: 0.11 },
      ],
    });
    expect(merged.oosDominanceRatio).toBe(0.42);
  });

  it("keeps preset wfaPassProbability when already finite", () => {
    const merged: Record<string, unknown> = { wfaPassProbability: 0.77 };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.02 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
      ],
    });
    expect(merged.wfaPassProbability).toBe(0.77);
  });

  it("sets oosIsTrendMatch using zero-mean sign buckets for IS and OOS", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.12, validationReturn: 0.02 },
        { optimizationReturn: -0.12, validationReturn: 0.03 },
      ],
    });
    expect(merged.oosIsTrendMatch).toBe(false);

    const bothZeroMean: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(bothZeroMean, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.04 },
        { optimizationReturn: -0.1, validationReturn: -0.04 },
      ],
    });
    expect(bothZeroMean.oosIsTrendMatch).toBe(true);

    const bothNeg: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(bothNeg, {
      periods: [
        { optimizationReturn: -0.1, validationReturn: -0.06 },
        { optimizationReturn: -0.08, validationReturn: -0.04 },
      ],
    });
    expect(bothNeg.oosIsTrendMatch).toBe(true);
  });

  it("skips regime matrix row when validation return is not finite", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: Number.NaN, regime: "bull" },
        { optimizationReturn: 0.1, validationReturn: 0.06, regime: "range" },
      ],
    });
    const matrix = merged.regimeSurvivalMatrix as Record<string, { pass: boolean }>;
    expect(matrix.Range.pass).toBe(true);
  });

  it("does not recompute edge half-life when preset has finite windows and ratio is healthy", () => {
    const merged: Record<string, unknown> = {
      edgeHalfLife: { windows: 4.2, days: 18 },
    };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05 },
        { optimizationReturn: 0.1, validationReturn: 0.04 },
        { optimizationReturn: 0.1, validationReturn: 0.06 },
      ],
    });
    expect(merged.profitableWindowsRatio).toBe(1);
    expect((merged.edgeHalfLife as { windows: number }).windows).toBe(4.2);
    expect((merged.edgeHalfLife as { days: number }).days).toBe(18);
  });

  it("uses finite ACF half-life periods when ACF returns a number", () => {
    vi.spyOn(financialMath, "calculateEdgeHalfLifeFromAcf").mockReturnValue({
      periods: 4.2,
      rho1: 0.55,
    });

    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          validationStartDate: "2024-01-01",
          validationEndDate: "2024-01-31",
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.04,
          validationStartDate: "2024-02-01",
          validationEndDate: "2024-02-29",
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.045,
          validationStartDate: "2024-03-01",
          validationEndDate: "2024-03-31",
        },
      ],
    });

    expect(merged.edgeHalfLife).toBeDefined();
    expect((merged.edgeHalfLife as { windows: number }).windows).toBe(4.2);
  });

  it("does not apply PSI fields when compute returns invalid result", () => {
    const spy = vi.spyOn(psiDetailsCalculator, "compute").mockReturnValue({ value: Number.NaN });
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { x: 1 } },
        { optimizationReturn: 0.1, validationReturn: 0.04, parameters: { x: 2 } },
      ],
    });
    expect(merged.parameterStabilityIndex).toBeUndefined();
    expect(merged.psiNote).toBeUndefined();
    spy.mockRestore();
  });

  it("skips WFA sum block when all optimization returns are non-finite", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: Number.NaN, validationReturn: 0.05 },
        { optimizationReturn: Number.NaN, validationReturn: 0.04 },
      ],
    });
    expect(merged.sumIs).toBeUndefined();
    expect(merged.sumOos).toBeUndefined();
  });

  it("skips WFA sum block when all validation returns are non-finite", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: Number.NaN },
        { optimizationReturn: 0.1, validationReturn: Number.NaN },
      ],
    });
    expect(merged.sumIs).toBeUndefined();
  });

  it("does not build wfeDistribution when fewer than three IS-positive windows qualify", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: -0.05, validationReturn: 0.04 },
        { optimizationReturn: 0.1, validationReturn: 0.05 },
        { optimizationReturn: 0.1, validationReturn: 0.06 },
      ],
    });
    expect(merged.wfeDistribution).toBeUndefined();
  });

  it("clears retention and WFE when sum of IS returns is near zero", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 5e-10, validationReturn: 0.04 },
        { optimizationReturn: -5e-10, validationReturn: 0.05 },
      ],
    });
    expect(merged.sumIs).toBe(0);
    expect(merged.oosRetention).toBeUndefined();
    expect(merged.wfeDistribution).toBeUndefined();
    expect(merged.optimizationGain).toBe(-0.09);
  });

  it("sets oosRetention to undefined when calcRetention is null despite two windows", () => {
    const merged: Record<string, unknown> = { strategyFingerprint: "Custom" };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 5e-10, validationReturn: 0.04 },
        { optimizationReturn: 5e-10, validationReturn: 0.05 },
      ],
    });
    expect(merged.sumIs).toBeCloseTo(1e-9, 20);
    expect(merged.oosRetention).toBeUndefined();
  });

  it("sets wfaPassProbability to zero when no window has positive validation return", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.01 },
        { optimizationReturn: 0.1, validationReturn: 0 },
        { optimizationReturn: 0.1, validationReturn: -0.02 },
      ],
    });
    expect(merged.wfaPassProbability).toBe(0);
  });

  it("skips OOS Calmar when validation equity has no drawdown", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.01 },
        { optimizationReturn: 0.1, validationReturn: 0.02 },
        { optimizationReturn: 0.1, validationReturn: 0.015 },
      ],
    });
    expect(merged.avgOosCalmar).toBeUndefined();
    expect((merged as Record<string, unknown>).oosMaxDrawdownFromWfa).toBeUndefined();
  });

  it("does not set oosCvar95 when CVaR tail mean is non-negative", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.08 },
        { optimizationReturn: 0.1, validationReturn: 0.09 },
        { optimizationReturn: 0.1, validationReturn: 0.07 },
      ],
    });
    expect(merged.oosCvar95).toBeUndefined();
  });

  it("omits small-N CVaR flags when window count is at least 30", () => {
    const periods = Array.from({ length: 30 }, (_, i) => ({
      optimizationReturn: 0.1,
      validationReturn: i % 3 === 0 ? -0.04 : 0.01,
    }));
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, { periods });
    expect(merged.oosCvar95).toBeDefined();
    expect((merged as Record<string, unknown>).oosCvar95SmallN).toBeUndefined();
  });

  it("does not override killSwitch streak when preset is finite", () => {
    const merged: Record<string, unknown> = { killSwitchMaxOosDrawdownWindows: 7 };
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: -0.02 },
        { optimizationReturn: 0.1, validationReturn: -0.03 },
      ],
    });
    expect(merged.killSwitchMaxOosDrawdownWindows).toBe(7);
  });

  it("skips fingerprint formula when calcRetention is null", () => {
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 5e-10, validationReturn: 0.04 },
        { optimizationReturn: 5e-10, validationReturn: 0.05 },
      ],
    });
    expect(merged.strategyFingerprint).toBe("Hybrid");
    expect(merged.oosRetention).toBeUndefined();
  });

  it("uses window count as days when average OOS window length is unknown", () => {
    vi.spyOn(financialMath, "calculateEdgeHalfLifeFromAcf").mockReturnValue({
      periods: Number.NaN,
      rho1: Number.NaN,
    });

    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.2 },
        { optimizationReturn: 0.1, validationReturn: 0.08 },
        { optimizationReturn: 0.1, validationReturn: 0.05 },
      ],
    });

    const eh = merged.edgeHalfLife as { windows: number; days: number };
    expect(eh).toBeDefined();
    expect(eh.windows).toBe(eh.days);
  });

  it("filters invalid or reversed validation dates when averaging OOS window length", () => {
    vi.spyOn(financialMath, "calculateEdgeHalfLifeFromAcf").mockReturnValue({
      periods: 2,
      rho1: 0.5,
    });
    const merged: Record<string, unknown> = {};
    fillProMetricsFromWfaPeriods(merged, {
      periods: [
        {
          optimizationReturn: 0.1,
          validationReturn: 0.06,
          validationStartDate: "not-a-date",
          validationEndDate: "2024-01-31",
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.05,
          validationStartDate: "2024-03-01",
          validationEndDate: "2024-01-01",
        },
        {
          optimizationReturn: 0.1,
          validationReturn: 0.04,
          validationStartDate: "2024-04-01",
          validationEndDate: "2024-04-30",
        },
      ],
    });
    expect(merged.edgeHalfLife).toBeDefined();
  });

  describe("psiDetailsCalculator.compute", () => {
    it("aggregates normalized step distances for drifting keys across windows", () => {
      const out = psiDetailsCalculator.compute([
        { parameters: { k: 0 } },
        { parameters: { k: 5 } },
        { parameters: { k: 10 } },
      ]);
      expect(out.note).toBeUndefined();
      expect(out.value).toBeGreaterThan(0);
    });

    it("uses top three keys by dispersion when more than three keys drift", () => {
      const out = psiDetailsCalculator.compute([
        { parameters: { a: 0, b: 0, c: 0, d: 0 } },
        { parameters: { a: 10, b: 1, c: 2, d: 3 } },
      ]);
      expect(Number.isFinite(out.value)).toBe(true);
    });

    it("skips non-finite parameter entries when building ranges", () => {
      const out = psiDetailsCalculator.compute([
        { parameters: { k: Number.NaN, a: 0 } },
        { parameters: { a: 10 } },
      ]);
      expect(Number.isFinite(out.value)).toBe(true);
    });

    it("skips a key on a step when the current window omits that key", () => {
      const out = psiDetailsCalculator.compute([
        { parameters: { a: 0, b: 0 } },
        { parameters: { a: 10, b: 10 } },
        { parameters: { a: 20 } },
      ]);
      expect(Number.isFinite(out.value)).toBe(true);
    });

    it("returns stable when drifting keys never align on adjacent windows", () => {
      const out = psiDetailsCalculator.compute([
        { parameters: { x: 0 } },
        { parameters: { y: 1 } },
        { parameters: { x: 10 } },
      ]);
      expect(out).toEqual({ value: 0, note: "stable" });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
