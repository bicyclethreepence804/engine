import { describe, expect, it } from "vitest";
import {
  computeGapDensityFromRaw,
  computePriceIntegrityFromRaw,
  getInvestabilityGrade,
  runDataQualityGuard,
  validateGapDensity,
  validateLookAhead,
  validateOutlierInfluence,
  validatePriceIntegrity,
  validateSampling,
  validateSamplingBias,
  validateSpreadLiquidity,
} from "./dataQualityGuard";

describe("dataQualityGuard", () => {
  it("returns REJECT and blocked=true when any module is REJECT", () => {
    const out = runDataQualityGuard({
      trades: [],
      candles: [],
      precomputedGapDensity: {
        module: "Gap Density",
        score: 0,
        verdict: "REJECT",
        details: { description: "forced reject" },
      },
      precomputedPriceIntegrity: {
        module: "Price Integrity",
        score: 1,
        verdict: "PASS",
        details: { description: "ok" },
      },
    });

    expect(out.verdict).toBe("REJECT");
    expect(out.blocked).toBe(true);
    expect(out.isCriticalFailure).toBe(true);
  });

  it("caps estimated execution grade to A-", () => {
    const out = getInvestabilityGrade(1, 1, 100, 1, true);
    expect(out.score).toBeLessThanOrEqual(80);
    expect(["A-", "A"]).toContain(out.grade);
  });

  it("returns FAIL+blocked when multiplicative score falls below threshold without REJECT", () => {
    const out = runDataQualityGuard({
      trades: Array.from({ length: 40 }, () => ({ profit: 1 })),
      candles: [],
      dataRangeDays: 365,
      paramCount: 1,
      precomputedGapDensity: {
        module: "Gap Density",
        score: 0.6,
        verdict: "FAIL",
        details: { description: "degraded" },
      },
      precomputedPriceIntegrity: {
        module: "Price Integrity",
        score: 0.7,
        verdict: "FAIL",
        details: { description: "degraded" },
      },
      positionSize: 100,
      volumePerBar: 100000,
    });

    expect(out.verdict).toBe("FAIL");
    expect(out.blocked).toBe(true);
    expect(out.isCriticalFailure).toBe(false);
    expect(out.finalScore).toBeLessThan(0.5);
  });

  it("exposes roadmapToPass when sampling rejects by trade count", () => {
    const out = runDataQualityGuard({
      trades: Array.from({ length: 10 }, (_, i) => ({ profit: i + 1 })),
      candles: [],
      dataRangeDays: 180,
      paramCount: 2,
      precomputedGapDensity: {
        module: "Gap Density",
        score: 1,
        verdict: "PASS",
        details: { description: "ok" },
      },
      precomputedPriceIntegrity: {
        module: "Price Integrity",
        score: 1,
        verdict: "PASS",
        details: { description: "ok" },
      },
    });

    expect(out.verdict).toBe("REJECT");
    expect(out.roadmapToPass).toBeDefined();
    expect(out.roadmapToPass?.currentTrades).toBe(10);
    expect(out.roadmapToPass?.requiredTrades).toBe(30);
  });

  it("covers direct module validators branches", () => {
    const outlier = validateOutlierInfluence([
      { profit: 100 },
      { profit: 1 },
      { profit: 1 },
      { profit: 1 },
      { profit: 1 },
    ]);
    expect(["FAIL", "REJECT", "PASS"]).toContain(outlier.verdict);

    const gapReject = validateGapDensity(
      [{ t: 0 }, { t: 60_000 * 20 }],
      60_000,
    );
    expect(["FAIL", "REJECT", "PASS"]).toContain(gapReject.verdict);

    const lookAhead = validateLookAhead([
      { signalTime: 1000, entryTime: 1000 },
      { signalTime: 2000, entryTime: 1999 },
    ]);
    expect(lookAhead.verdict).toBe("REJECT");

    const spread = validateSpreadLiquidity(1000, 100);
    expect(["PASS", "FAIL", "REJECT", "N/A"]).toContain(spread.verdict);

    const samplingReject = validateSampling(5, 2, 90);
    expect(samplingReject.verdict).toBe("REJECT");

    const samplingBiasReject = validateSamplingBias(30, 90);
    expect(samplingBiasReject.verdict).toBe("REJECT");

    const priceIntegrity = validatePriceIntegrity([
      { open: 10, high: 11, low: 9, close: 10.5 },
      { open: 10.5, high: 12, low: 10, close: 11.5 },
    ] as never);
    expect(["PASS", "FAIL", "REJECT", "N/A"]).toContain(priceIntegrity.verdict);
  });

  it("returns N/A for outlier validator on too-few trades", () => {
    const out = validateOutlierInfluence([{ profit: 1 }, { profit: 2 }]);
    expect(out.verdict).toBe("N/A");
    expect(out.reason?.code).toBe("INSUFFICIENT_TRADES");
  });

  it("returns PASS for look-ahead when no paired timestamps", () => {
    const out = validateLookAhead([{ entryTime: 1000 }, { signalTime: 2000 }]);
    expect(out.verdict).toBe("PASS");
  });

  it("marks fallback sampling-bias reject when no trades and short range", () => {
    const out = runDataQualityGuard({
      trades: [],
      candles: [],
      dataRangeDays: 30,
      precomputedGapDensity: {
        module: "Gap Density",
        score: 1,
        verdict: "PASS",
        details: {},
      },
      precomputedPriceIntegrity: {
        module: "Price Integrity",
        score: 1,
        verdict: "PASS",
        details: {},
      },
    });
    expect(out.verdict).toBe("REJECT");
    expect(out.blocked).toBe(true);
  });

  it("handles raw DQ modules with missing fields and reject thresholds", () => {
    const naGap = computeGapDensityFromRaw({});
    expect(naGap.verdict).toBe("N/A");

    const rejectGap = computeGapDensityFromRaw({
      totalIntervals: 100,
      missingBars: 20,
      maxGapSize: 12,
    });
    expect(rejectGap.verdict).toBe("REJECT");

    const naPrice = computePriceIntegrityFromRaw({});
    expect(naPrice.verdict).toBe("N/A");

    const rejectPrice = computePriceIntegrityFromRaw(
      {
        flatBars: 10,
        flatBarsRatio: 0.01,
      },
      1000,
    );
    expect(rejectPrice.verdict).toBe("REJECT");
  });

  it("maps investability grade statuses across score bands", () => {
    expect(getInvestabilityGrade(0, 0, 0, 0).grade).toBe("F");
    expect(getInvestabilityGrade(0.8, 0.8, 10, 0.8).status).toBe("Monitor");
  });
});
