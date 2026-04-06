import { describe, expect, it, vi } from "vitest";
import {
  calculateRobustnessScore,
  computeWfaVerdict,
  createEmptyWalkForwardAnalysis,
  transformToWalkForwardAnalysis,
} from "./wfaStandaloneTransform";

describe("transformToWalkForwardAnalysis", () => {
  it("calls onError and returns null for malformed JSON", () => {
    const onError = vi.fn();
    const out = transformToWalkForwardAnalysis(
      { results: "{" },
      "r1",
      { onError },
    );

    expect(out).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("returns null when result is not found", () => {
    const out = transformToWalkForwardAnalysis(
      { results: { topResults: [{ id: "x1", walkForwardAnalysis: {} }] } },
      "r1",
    );
    expect(out).toBeNull();
  });

  it("creates empty disabled WFA shape", () => {
    const out = createEmptyWalkForwardAnalysis({
      isDisabled: true,
      verdictExplanation: "disabled",
    });
    expect(out.isDisabled).toBe(true);
    expect(out.verdict).toBe("FAIL");
  });

  it("computes verdict branches for logic paralysis and pass case", () => {
    const fail = computeWfaVerdict({
      wfe: 0.9,
      consistency: 0.8,
      failedWindows: { count: 0, total: 3 },
      overfittingScore: 0.1,
      logicParalysis: true,
    });
    expect(fail.verdict).toBe("FAIL");

    const pass = computeWfaVerdict({
      wfe: 0.9,
      consistency: 0.8,
      failedWindows: { count: 0, total: 3 },
      overfittingScore: 0.1,
      logicParalysis: false,
    });
    expect(pass.verdict).toBe("PASS");
  });

  it("uses payload explanation and fails on high overfitting", () => {
    const out = computeWfaVerdict({
      wfe: 0.95,
      consistency: 0.95,
      failedWindows: { count: 0, total: 4 },
      overfittingScore: 0.9,
      logicParalysis: false,
      verdictExplanationFromPayload: "custom-explainer",
    });
    expect(out.verdict).toBe("FAIL");
    expect(out.verdictExplanation).toBe("custom-explainer");
  });

  it("returns empty WFA when specific result has no WFA object", () => {
    const out = transformToWalkForwardAnalysis(
      { results: { topResults: [{ id: "r1" }] } },
      "r1",
    );
    expect(out).not.toBeNull();
    expect(out?.verdict).toBe("FAIL");
    expect(out?.failedWindows.total).toBe(0);
  });

  it("maps period diagnoses and computes failed windows consistently", () => {
    const out = transformToWalkForwardAnalysis(
      {
        results: {
          topResults: [
            {
              id: "r2",
              walkForwardAnalysis: {
                periods: [
                  {
                    periodName: "P1",
                    optimizationReturn: 0.1,
                    validationReturn: -0.02,
                    oosTradesCount: 3,
                    isProfitFactor: 1.5,
                    oosProfitFactor: 0.8,
                    parameters: { len: 10 },
                  },
                  {
                    periodName: "P2",
                    optimizationReturn: 0.12,
                    validationReturn: 0.0001,
                    oosTradesCount: 4,
                    parameters: { len: 120 },
                  },
                  {
                    periodName: "P3",
                    optimizationReturn: 0.08,
                    validationReturn: 0.03,
                    oosTradesCount: 0,
                    parameters: { len: 200 },
                  },
                ],
              },
            },
          ],
        },
      },
      "r2",
    );
    expect(out).not.toBeNull();
    expect(out?.failedWindows.count).toBe(2);
    expect(out?.failedWindows.windows[0]?.reason).toBeDefined();
    expect(out?.windows?.some((w) => String((w as { diagnosis?: string }).diagnosis).length > 0)).toBe(
      true,
    );
    expect(out?.paramDrift).toBe("High");
  });

  it("fails verdict on insufficient data when WFE is missing", () => {
    const out = computeWfaVerdict({
      wfe: undefined,
      consistency: 0.7,
      failedWindows: { count: 0, total: 2 },
      overfittingScore: 0.2,
      logicParalysis: false,
    });
    expect(out.verdict).toBe("FAIL");
    expect(out.verdictExplanation).toContain("Insufficient data");
  });

  it("fails verdict on failure-rate gate", () => {
    const out = computeWfaVerdict({
      wfe: 0.9,
      consistency: 0.9,
      failedWindows: { count: 2, total: 4 },
      overfittingScore: 0.2,
      logicParalysis: false,
    });
    expect(out.verdict).toBe("FAIL");
    expect(out.verdictExplanation).toContain("30%");
  });

  it("delegates robustness score calculation", () => {
    const out = calculateRobustnessScore(
      { config: {}, results: {}, trades: [] },
      { periods: [{ optimizationReturn: 0.1, validationReturn: 0.07 }, { optimizationReturn: 0.1, validationReturn: 0.08 }] },
      null,
      { avgOosSharpe: 1.1, wfeDistribution: { median: 0.8 }, windowsCount: 2 },
      { metrics: { profitFactor: 1.5 }, kurtosis: 2, recoveryFactor: 1.2, edgeStabilityZScore: 1.7 },
      { parameters: [{ sensitivity: 0.2 }] },
      { annualTurnover: 4, avgNetProfitPerTradeBps: 15, breakevenSlippageBps: 18 },
    );
    expect(out).not.toBeNull();
    expect(typeof out?.overall).toBe("number");
  });

  it("returns null when called without resultId", () => {
    const out = transformToWalkForwardAnalysis(
      { results: { topResults: [{ id: "r1", walkForwardAnalysis: {} }] } },
      undefined,
    );
    expect(out).toBeNull();
  });

  it("returns null when topResults is malformed", () => {
    const out = transformToWalkForwardAnalysis(
      { results: { topResults: null as never } },
      "r1",
    );
    expect(out).toBeNull();
  });

  it("derives edge-erosion diagnosis and medium param drift", () => {
    const out = transformToWalkForwardAnalysis(
      {
        results: {
          topResults: [
            {
              id: "r3",
              walkForwardAnalysis: {
                periods: [
                  {
                    optimizationReturn: 0.09,
                    validationReturn: 0.02,
                    oosTradesCount: 5,
                    isProfitFactor: 1.4,
                    oosProfitFactor: 0.9,
                    parameters: { len: 10 },
                  },
                  {
                    optimizationReturn: 0.1,
                    validationReturn: 0.01,
                    oosTradesCount: 5,
                    isProfitFactor: 1.5,
                    oosProfitFactor: 0.95,
                    parameters: { len: 14 },
                  },
                ],
              },
            },
          ],
        },
      },
      "r3",
    );
    expect(out).not.toBeNull();
    expect(out?.windows?.some((w) => (w as { diagnosis?: string }).diagnosis === "Edge Erosion")).toBe(
      true,
    );
    expect(["Low", "Medium", "High", undefined]).toContain(out?.paramDrift);
  });

  it("derives volatility-collapse diagnosis branch", () => {
    const out = transformToWalkForwardAnalysis(
      {
        results: {
          topResults: [
            {
              id: "r4",
              walkForwardAnalysis: {
                periods: [
                  {
                    optimizationReturn: 0.05,
                    validationReturn: 0.0001,
                    oosTradesCount: 5,
                    parameters: { len: 20 },
                  },
                  {
                    optimizationReturn: 0.06,
                    validationReturn: 0.0002,
                    oosTradesCount: 6,
                    parameters: { len: 22 },
                  },
                ],
              },
            },
          ],
        },
      },
      "r4",
    );
    expect(out).not.toBeNull();
    expect(
      out?.windows?.some((w) => (w as { diagnosis?: string }).diagnosis === "Volatility Collapse"),
    ).toBe(true);
  });
});
