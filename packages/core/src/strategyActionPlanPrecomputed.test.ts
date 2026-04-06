import { describe, expect, it } from "vitest";
import { buildStrategyActionPlanPrecomputed } from "./strategyActionPlanPrecomputed";

describe("buildStrategyActionPlanPrecomputed", () => {
  it("returns null when no finite sharpe source exists", () => {
    const out = buildStrategyActionPlanPrecomputed({
      proBenchmarkMetrics: {},
      riskAnalysis: {},
    });
    expect(out).toBeNull();
  });

  it("returns NOT_VIABLE block when base sharpe is negative", () => {
    const out = buildStrategyActionPlanPrecomputed({
      proBenchmarkMetrics: { avgOosSharpe: -0.2 },
      riskAnalysis: { maxDrawdown: -0.1 },
      turnoverAndCostDrag: { annualTurnover: 5, avgNetProfitPerTradeBps: -3 },
      walkForwardAnalysis: { windows: [] },
    });
    expect(out).not.toBeNull();
    expect(out?.slippageBlockVerdict).toBe("NOT_VIABLE");
    expect(out?.slippageImpactRows).toHaveLength(0);
    expect(out?.phase).toBe("REJECT");
    expect(out?.phase1Label).toBe("NOT VIABLE");
  });

  it("builds slippage rows for positive sharpe", () => {
    const out = buildStrategyActionPlanPrecomputed({
      proBenchmarkMetrics: {
        avgOosSharpe: 1.1,
        wfeDistribution: { median: 0.8 },
        oosRetention: 0.85,
        killSwitchMaxOosDrawdownWindows: 1,
      },
      riskAnalysis: { maxDrawdown: -0.15, edgeStabilityZScore: 2 },
      turnoverAndCostDrag: {
        annualTurnover: 4,
        avgNetProfitPerTradeBps: 20,
        breakevenSlippageBps: 12,
      },
      parameterSensitivity: {
        parameters: [{ name: "alpha", sensitivity: 0.7 }],
      },
      walkForwardAnalysis: {
        windows: [
          { optimizationReturn: 0.1, validationReturn: 0.05, oosTradesCount: 3 },
          { optimizationReturn: 0.08, validationReturn: 0.02, oosTradesCount: 3 },
        ],
        failedWindows: { count: 0, total: 2 },
      },
      strategy: { symbol: "BTC/USDT", timeframe: "1h" },
    });
    expect(out).not.toBeNull();
    expect((out?.slippageImpactRows.length ?? 0) > 0).toBe(true);
    expect(out?.sharpeSource).toBe("wfa_avg_oos_sharpe");
  });

  it("sets re-research phase for weak execution and fragile params", () => {
    const out = buildStrategyActionPlanPrecomputed({
      proBenchmarkMetrics: {
        avgOosSharpe: 0.6,
        wfeDistribution: { median: 0.3 },
        parameterStabilityIndex: 0.6,
        oosRetention: 0.9,
      },
      riskAnalysis: { maxDrawdown: -0.2, edgeStabilityZScore: 1.0, kurtosis: 6 },
      turnoverAndCostDrag: {
        annualTurnover: 20,
        avgNetProfitPerTradeBps: 2,
        breakevenSlippageBps: 8,
        avgTradesPerMonth: 40,
      },
      parameterSensitivity: {
        parameters: [{ name: "fastLen", sensitivity: 0.8 }],
      },
      walkForwardAnalysis: {
        windows: [
          { optimizationReturn: 0.1, validationReturn: -0.01, oosTradesCount: 0, diagnosis: "Dead Zone (Inactivity)" },
          { optimizationReturn: 0.1, validationReturn: -0.02, oosTradesCount: 1 },
        ],
        failedWindows: { count: 2, total: 2 },
      },
      strategy: { symbol: "ALT/USDT", timeframe: "5m", strategyType: "scalping" },
    });
    expect(out).not.toBeNull();
    expect(out?.phase).toBe("RE_RESEARCH");
    expect((out?.reResearchReasons?.length ?? 0) > 0).toBe(true);
    expect(out?.showLatencySensitivity).toBe(true);
  });

  it("sets ready phase and keeps incubation label for strong setup", () => {
    const out = buildStrategyActionPlanPrecomputed({
      proBenchmarkMetrics: {
        avgOosSharpe: 1.3,
        wfeDistribution: { median: 0.7 },
        oosRetention: 0.8,
        regimeSurvivalMatrix: {
          Trend: { pass: true },
          Range: { pass: true },
          HighVol: { pass: false },
        },
        edgeHalfLife: { days: 120 },
      },
      riskAnalysis: { maxDrawdown: -0.12, edgeStabilityZScore: 2.3, kurtosis: 2.5 },
      turnoverAndCostDrag: {
        annualTurnover: 6,
        avgNetProfitPerTradeBps: 30,
        breakevenSlippageBps: 20,
        avgTradesPerMonth: 8,
        confidence: { zScore: 2.2 },
      },
      parameterSensitivity: { parameters: [{ name: "len", sensitivity: 0.2 }] },
      walkForwardAnalysis: {
        windows: [
          { optimizationReturn: 0.1, validationReturn: 0.07, oosTradesCount: 5 },
          { optimizationReturn: 0.11, validationReturn: 0.06, oosTradesCount: 6 },
        ],
        failedWindows: { count: 0, total: 2 },
      },
      strategy: { symbol: "BTC/USDT", timeframe: "1h" },
    });
    expect(out).not.toBeNull();
    expect(out?.phase).toBe("READY");
    expect(out?.phase1Label).toBe("Incubation (Current)");
    expect(out?.allocationText).toBeDefined();
  });

  it("emits critical system conflict on high retention with high fail ratio", () => {
    const out = buildStrategyActionPlanPrecomputed({
      proBenchmarkMetrics: {
        avgOosSharpe: 0.9,
        wfeDistribution: { median: 0.55 },
        oosRetention: 0.9,
      },
      riskAnalysis: { maxDrawdown: -0.2, edgeStabilityZScore: 1.2 },
      turnoverAndCostDrag: {
        annualTurnover: 5,
        avgNetProfitPerTradeBps: 12,
        breakevenSlippageBps: 9,
        avgTradesPerMonth: 12,
      },
      parameterSensitivity: { parameters: [{ name: "alpha", sensitivity: 0.3 }] },
      walkForwardAnalysis: {
        windows: [
          { optimizationReturn: 0.1, validationReturn: -0.01, oosTradesCount: 1 },
          { optimizationReturn: 0.1, validationReturn: -0.02, oosTradesCount: 1 },
          { optimizationReturn: 0.1, validationReturn: 0.03, oosTradesCount: 3 },
        ],
        failedWindows: { count: 2, total: 3 },
      },
      strategy: { symbol: "ETH/USDT", timeframe: "15m", strategyType: "scalping" },
    });
    expect(out).not.toBeNull();
    expect(out?.systemConflictDetected).toBe(true);
    expect(out?.systemConflictCritical).toBe(true);
    expect(String(out?.systemConflictMessage)).toContain("Conflict A");
  });
});
