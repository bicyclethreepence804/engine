import { describe, expect, it } from "vitest";
import {
  assessBreakevenFromTradeEdge,
  buildTurnoverAvailableControlLevers,
  buildTurnoverConfidenceNote,
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
  formatAvgTradesPerMonthLabel,
  normalizeRate,
  turnoverAlphaHalfLifeDisclaimer,
  turnoverLowSignificanceCagrDisclaimer,
  TURNOVER_Z_SCORE_PRODUCTION_READY,
} from "./turnoverCore";

describe("normalizeRate and estimateAdvAndVolatility", () => {
  it("normalizes rate via decimal helper", () => {
    expect(typeof normalizeRate(0.1)).toBe("number");
  });

  it("returns NaNs when historical data is missing or empty", () => {
    expect(Number.isNaN(estimateAdvAndVolatility(null).advNotional)).toBe(true);
    expect(Number.isNaN(estimateAdvAndVolatility({ data: [] }).dailyVolatility)).toBe(true);
  });

  it("computes ADV and daily vol from OHLCV rows", () => {
    const day = 86_400_000;
    const { advNotional, dailyVolatility } = estimateAdvAndVolatility({
      data: [
        { close: 100, volume: 1_000_000, timestamp: 0 },
        { close: 101, volume: 1_100_000, timestamp: day },
        { close: 99, volume: 900_000, timestamp: 2 * day },
      ],
    });
    expect(advNotional).toBeGreaterThan(0);
    expect(dailyVolatility).toBeGreaterThan(0);
  });

  it("skips bars when prior close is non-positive", () => {
    const day = 86_400_000;
    const { dailyVolatility } = estimateAdvAndVolatility({
      data: [
        { close: 0, volume: 1, timestamp: 0 },
        { close: 100, volume: 1, timestamp: day },
        { close: 101, volume: 1, timestamp: 2 * day },
      ],
    });
    expect(Number.isFinite(dailyVolatility)).toBe(true);
  });
});

describe("assessBreakevenFromTradeEdge", () => {
  it("maps breakeven margin, status, and failure mode", () => {
    const robust = assessBreakevenFromTradeEdge(400, 10_000, 0.0002, 5);
    expect(robust.netEdgePositive).toBe(true);
    expect(robust.breakevenMargin).toBe("High");
    expect(robust.breakevenStatus).toBe("ROBUST");
    expect(String(robust.breakevenFailureMode)).toContain("Adverse");

    const critical = assessBreakevenFromTradeEdge(8, 10_000, 0.0002, 5);
    expect(critical.breakevenStatus).toBe("CRITICAL");
    expect(critical.breakevenMargin).toBe("Low");
    expect(String(critical.breakevenFailureMode)).toContain("Spread");

    const fragile = assessBreakevenFromTradeEdge(25, 10_000, 0.0002, 5);
    expect(fragile.breakevenStatus).toBe("FRAGILE");
    expect(fragile.breakevenMargin).toBe("Medium");
  });

  it("returns NaN edge when inputs are invalid", () => {
    const out = assessBreakevenFromTradeEdge(Number.NaN, 10_000, 0.0001);
    expect(Number.isNaN(out.netEdgeBps)).toBe(true);
  });
});

describe("turnoverCore confidence / deployment", () => {
  it("computeTradeReturnZScore matches t-statistic on sample", () => {
    const bps = [10, 12, 11, 13, 10];
    const z = computeTradeReturnZScore(bps);
    expect(z).toBeGreaterThan(0);
    expect(Number.isFinite(z)).toBe(true);
  });

  it("returns NaN for fewer than 2 trades", () => {
    expect(Number.isNaN(computeTradeReturnZScore([5]))).toBe(true);
    expect(Number.isNaN(computeTradeReturnZScore([]))).toBe(true);
  });

  it("classifyTurnoverConfidenceLevel respects trade count and z", () => {
    expect(classifyTurnoverConfidenceLevel(3, 5, 10)).toBe("Low");
    expect(classifyTurnoverConfidenceLevel(2, 40, 10)).toBe("Medium");
    expect(classifyTurnoverConfidenceLevel(3, 40, 10)).toBe("High");
    expect(classifyTurnoverConfidenceLevel(-2, 40, 10)).toBe("Low");
  });

  it("buildTurnoverConfidenceNote appends negative-Z guidance", () => {
    const note = buildTurnoverConfidenceNote({
      avgTradesPerMonth: 12,
      tradesPerMonthLabel: "12",
      confidenceLevel: "Low",
      zScore: -1,
    });
    expect(note).toContain("Negative Z");
  });

  it("formatAvgTradesPerMonthLabel", () => {
    expect(formatAvgTradesPerMonthLabel(0.5)).toBe("< 1");
    expect(formatAvgTradesPerMonthLabel(4)).toBe("4");
    expect(formatAvgTradesPerMonthLabel(undefined)).toBe("");
  });

  it("classifyTurnoverDeploymentClass", () => {
    expect(
      classifyTurnoverDeploymentClass({
        netEdgeBps: 1,
        costAdaptability: "PASS",
        zScore: TURNOVER_Z_SCORE_PRODUCTION_READY,
      }),
    ).toBe("Production-ready");
    expect(
      classifyTurnoverDeploymentClass({
        netEdgeBps: 1,
        costAdaptability: "PASS",
        zScore: 1,
      }),
    ).toBe("Incubator");
    expect(
      classifyTurnoverDeploymentClass({
        netEdgeBps: -1,
        costAdaptability: "PASS",
        zScore: 5,
      }),
    ).toBe("Micro-cap / Research-only");
    expect(
      classifyTurnoverDeploymentClass({
        netEdgeBps: 10,
        costAdaptability: "WARNING",
        zScore: 5,
      }),
    ).toBe("Micro-cap / Research-only");
  });
});

describe("turnover primary / slippage / alpha half-life", () => {
  it("classifyTurnoverPrimaryConstraint", () => {
    expect(
      classifyTurnoverPrimaryConstraint({
        grossEdgeNegative: true,
        netEdgeBps: 1,
        costEdgeRatioPct: 10,
        advPortfolioWeightedPct: 0,
        limitFillProbabilityPct: 80,
      }),
    ).toBe("Gross edge negative (alpha-deficit)");
    expect(
      classifyTurnoverPrimaryConstraint({
        grossEdgeNegative: false,
        netEdgeBps: -1,
        costEdgeRatioPct: 10,
        advPortfolioWeightedPct: 0,
        limitFillProbabilityPct: 80,
      }),
    ).toBe("Net edge < execution costs");
    expect(
      classifyTurnoverPrimaryConstraint({
        grossEdgeNegative: false,
        netEdgeBps: 5,
        costEdgeRatioPct: 45,
        advPortfolioWeightedPct: 0,
        limitFillProbabilityPct: 80,
      }),
    ).toBe("High fee/edge ratio");
    expect(
      classifyTurnoverPrimaryConstraint({
        grossEdgeNegative: false,
        netEdgeBps: 5,
        costEdgeRatioPct: 10,
        advPortfolioWeightedPct: 0.6,
        limitFillProbabilityPct: 80,
      }),
    ).toBe("Liquidity/ADV constraint");
    expect(
      classifyTurnoverPrimaryConstraint({
        grossEdgeNegative: false,
        netEdgeBps: 5,
        costEdgeRatioPct: 10,
        advPortfolioWeightedPct: 0,
        limitFillProbabilityPct: 40,
      }),
    ).toBe("Low fill probability");
    expect(
      classifyTurnoverPrimaryConstraint({
        grossEdgeNegative: false,
        netEdgeBps: 5,
        costEdgeRatioPct: 10,
        advPortfolioWeightedPct: 0,
        limitFillProbabilityPct: 80,
      }),
    ).toBe("Execution friction");
  });

  it("computeSlippageSensitivityRows returns ladder", () => {
    const rows = computeSlippageSensitivityRows({
      initialBalance: 100_000,
      slippagePct: -2,
      netCagrPct: 10,
      avgParticipation: 0.01,
      advUtilPct: 5,
    });
    expect(rows.length).toBe(4);
    expect(rows[0].aum).toBe(100_000);
  });

  it("marks rows OutOfRange when participation exceeds gate", () => {
    const rows = computeSlippageSensitivityRows({
      initialBalance: 50_000,
      slippagePct: -1,
      netCagrPct: 5,
      avgParticipation: 0.2,
      advUtilPct: 0,
      aumLadder: [50_000, 500_000],
      participationGate: 0.15,
    });
    expect(rows.some((r) => r.status === "OutOfRange")).toBe(true);
  });

  it("uses dampening when adv util is low and omits net CAGR when not finite", () => {
    const rows = computeSlippageSensitivityRows({
      initialBalance: 100_000,
      slippagePct: -1.5,
      netCagrPct: Number.NaN,
      avgParticipation: 0.01,
      advUtilPct: 2,
      aumLadder: [100_000],
      zombieAumThreshold: 500_000_000,
    });
    expect(rows[0]).toBeDefined();
    expect(Number.isNaN(rows[0]!.netCagrPct as number)).toBe(true);
  });

  it("returns empty slippage rows for invalid balance", () => {
    expect(
      computeSlippageSensitivityRows({
        initialBalance: 0,
        slippagePct: 1,
        netCagrPct: 1,
        avgParticipation: 0.01,
        advUtilPct: 1,
      }),
    ).toEqual([]);
  });

  it("treats non-finite avg participation as zero at row AUM", () => {
    const rows = computeSlippageSensitivityRows({
      initialBalance: 100_000,
      slippagePct: -1,
      netCagrPct: 5,
      avgParticipation: Number.NaN,
      advUtilPct: Number.NaN,
      aumLadder: [100_000],
    });
    expect(rows[0]?.aum).toBe(100_000);
    expect(rows[0]?.status).not.toBe("OutOfRange");
  });

  it("computeAlphaHalfLifeDays NaN without enough trades", () => {
    expect(
      Number.isNaN(
        computeAlphaHalfLifeDays({
          totalTrades: 5,
          dateRangeDays: 365,
          periods: [{ validationReturn: 0.1 }],
        }),
      ),
    ).toBe(true);
  });

  it("computeAlphaHalfLifeDays uses snake_case fields and date range fallback", () => {
    const days = computeAlphaHalfLifeDays({
      totalTrades: 35,
      dateRangeDays: 400,
      periods: [
        {
          validation_return: 0.05,
          validation_start_date: "2024-01-01",
          validation_end_date: "2024-02-01",
        },
        {
          validation_return: 0.02,
          startDate: "2024-02-02",
          endDate: "2024-02-02",
        },
      ],
    });
    expect(Number.isFinite(days)).toBe(true);
  });

  it("computeAlphaHalfLifeDays falls back when validation returns are missing", () => {
    const days = computeAlphaHalfLifeDays({
      totalTrades: 32,
      dateRangeDays: 200,
      periods: [{ validationStartDate: "2024-01-01", validationEndDate: "2024-06-01" }],
    });
    expect(Number.isFinite(days)).toBe(true);
  });

  it("computeAlphaHalfLifeDays uses dateRangeDays when parsed OOS span is zero", () => {
    const days = computeAlphaHalfLifeDays({
      totalTrades: 35,
      dateRangeDays: 180,
      periods: [
        { validationReturn: 0.05, validationStartDate: "2024-01-01", validationEndDate: "2024-01-01" },
        { validationReturn: 0.02, validationStartDate: "not-a-date", validationEndDate: "also-bad" },
      ],
    });
    expect(days).toBeCloseTo(90, 5);
  });

  it("computeAlphaHalfLifeDays scales full series when no return falls below half of base", () => {
    const days = computeAlphaHalfLifeDays({
      totalTrades: 35,
      dateRangeDays: 99,
      periods: [
        { validationReturn: 0.1 },
        { validationReturn: 0.1 },
        { validationReturn: 0.1 },
      ],
    });
    expect(days).toBeCloseTo(99, 5);
  });

  it("turnoverAlphaHalfLifeDisclaimer and turnoverLowSignificanceCagrDisclaimer", () => {
    expect(turnoverAlphaHalfLifeDisclaimer(400, 8)).toContain("Long half-life");
    expect(turnoverAlphaHalfLifeDisclaimer(100, 8)).toBeUndefined();
    expect(turnoverLowSignificanceCagrDisclaimer("Low", 1)).toContain("Low statistical significance");
    expect(turnoverLowSignificanceCagrDisclaimer("High", 1)).toBeUndefined();
  });
});

describe("buildTurnoverInterpretiveSummary", () => {
  it("covers net edge and gross-edge branches", () => {
    expect(buildTurnoverInterpretiveSummary({ netEdgeBps: Number.NaN, grossEdgeNegative: false, grossPerTradeBpsInstitutional: 1, avgNetProfitPerTradeBps: 1 })).toContain(
      "not measurable",
    );
    expect(
      buildTurnoverInterpretiveSummary({
        netEdgeBps: -5,
        grossEdgeNegative: true,
        grossPerTradeBpsInstitutional: 2,
        avgNetProfitPerTradeBps: -1,
      }),
    ).toContain("Period gross is negative");
    expect(
      buildTurnoverInterpretiveSummary({
        netEdgeBps: -5,
        grossEdgeNegative: true,
        grossPerTradeBpsInstitutional: -1,
        avgNetProfitPerTradeBps: -2,
      }),
    ).toContain("alpha-deficit");
    expect(
      buildTurnoverInterpretiveSummary({
        netEdgeBps: 0,
        grossEdgeNegative: false,
        grossPerTradeBpsInstitutional: 1,
        avgNetProfitPerTradeBps: 1,
      }),
    ).toContain("fully consumed");
    expect(
      buildTurnoverInterpretiveSummary({
        netEdgeBps: 5,
        grossEdgeNegative: false,
        grossPerTradeBpsInstitutional: 1,
        avgNetProfitPerTradeBps: 1,
      }),
    ).toContain("positive at baseline");
  });
});

describe("computeRequiredAlphaBoostBps", () => {
  it("uses gross-negative and net-negative branches", () => {
    expect(computeRequiredAlphaBoostBps({ grossPerTradeBpsInstitutional: -10, avgNetProfitPerTradeBps: 0, costBpsPerTrade: 4 })).toBe(14);
    expect(computeRequiredAlphaBoostBps({ grossPerTradeBpsInstitutional: 1, avgNetProfitPerTradeBps: -8, costBpsPerTrade: 0 })).toBe(8);
    expect(computeRequiredAlphaBoostBps({ grossPerTradeBpsInstitutional: 1, avgNetProfitPerTradeBps: 2, costBpsPerTrade: 1 })).toBe(0);
  });
});

describe("classifyControlLeverEffectiveness and buildTurnoverAvailableControlLevers", () => {
  it("maps cost ratio to effectiveness and builds three levers", () => {
    expect(classifyControlLeverEffectiveness({ grossEdgeNegative: true, costEdgeRatioPct: 10 })).toBe("Low");
    expect(classifyControlLeverEffectiveness({ grossEdgeNegative: false, costEdgeRatioPct: 50 })).toBe("Low");
    expect(classifyControlLeverEffectiveness({ grossEdgeNegative: false, costEdgeRatioPct: 25 })).toBe("Medium");
    expect(classifyControlLeverEffectiveness({ grossEdgeNegative: false, costEdgeRatioPct: 5 })).toBe("High");
    expect(buildTurnoverAvailableControlLevers("High")).toHaveLength(3);
  });
});

describe("computeWinRateSensitivityPct", () => {
  it("returns finite value for mixed wins and losses", () => {
    const pct = computeWinRateSensitivityPct([100, -40, 100, -40, 100]);
    expect(Number.isFinite(pct)).toBe(true);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it("returns NaN when no positive trades", () => {
    expect(Number.isNaN(computeWinRateSensitivityPct([-10, -20]))).toBe(true);
  });

  it("returns NaN when base profit is not positive", () => {
    expect(Number.isNaN(computeWinRateSensitivityPct([2, -50, 3, -50]))).toBe(true);
  });
});
