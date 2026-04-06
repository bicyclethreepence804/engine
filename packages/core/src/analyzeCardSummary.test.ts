import { describe, expect, it } from "vitest";
import { computeAnalyzeCardSummary } from "./analyzeCardSummary";
import type { TestResultData } from "@kiploks/engine-contracts";

function baseData(): TestResultData {
  return {
    strategy: {
      name: "demo",
      symbol: "BTC/USDT",
      timeframe: "1h",
      exchange: "binance",
      testPeriodStart: "2024-01-01",
      testPeriodEnd: "2024-12-31",
    },
    walkForwardAnalysis: { wfe: 0.62 },
    turnoverAndCostDrag: { avgNetProfitPerTradeBps: 25, avgTradesPerMonth: 10 },
    benchmarkComparison: { alphaTStat: 2.1 },
    robustnessScore: { overall: 78 },
    verdictPayload: { verdict: "ROBUST" },
  } as unknown as TestResultData;
}

describe("computeAnalyzeCardSummary", () => {
  it("uses verdictPayload severity as primary verdict source", () => {
    const summary = computeAnalyzeCardSummary(baseData());
    expect(summary.verdict).toBe("ROBUST");
    expect(summary.pairTimeframe).toBe("BTC/USDT | 1h");
    expect(summary.exchange).toBe("binance");
  });

  it("falls back to FAIL on weak robustness/wfe/netEdge", () => {
    const data = baseData();
    (data as unknown as Record<string, unknown>).verdictPayload = undefined;
    (data as unknown as Record<string, unknown>).robustnessScore = { overall: 20 };
    (data as unknown as Record<string, unknown>).walkForwardAnalysis = { wfe: 0.2 };
    (data as unknown as Record<string, unknown>).turnoverAndCostDrag = {
      avgNetProfitPerTradeBps: -5,
      avgTradesPerMonth: 3,
    };

    const summary = computeAnalyzeCardSummary(data);
    expect(summary.verdict).toBe("FAIL");
    expect(summary.diagnosis).toContain("Critical issues");
  });
});
