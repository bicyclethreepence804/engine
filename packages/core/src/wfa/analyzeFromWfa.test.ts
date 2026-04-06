import { describe, expect, it } from "vitest";
import { KiploksValidationError } from "@kiploks/engine-contracts";
import { analyzeFromTrades, analyzeFromWindows } from "./analyzeFromWfa";

const DAY = 24 * 60 * 60 * 1000;

describe("analyzeFromWindows", () => {
  it("throws when fewer than 2 windows", () => {
    expect(() =>
      analyzeFromWindows({
        wfaInputMode: "precomputed",
        windows: [
          {
            period: { start: "2020-01-01T00:00:00.000Z", end: "2020-07-01T00:00:00.000Z" },
            inSample: { return: 0.1 },
            outOfSample: { return: 0.05 },
          },
        ],
      }),
    ).toThrow(KiploksValidationError);
  });

  it("returns WFAAnalysisOutput with blocks and disabled product-only sections", () => {
    const out = analyzeFromWindows({
      wfaInputMode: "precomputed",
      windows: [
        {
          period: { start: "2020-01-01T00:00:00.000Z", end: "2020-07-01T00:00:00.000Z" },
          inSample: { return: 0.12 },
          outOfSample: { return: 0.08 },
        },
        {
          period: { start: "2020-07-01T00:00:00.000Z", end: "2021-01-01T00:00:00.000Z" },
          inSample: { return: 0.1 },
          outOfSample: { return: 0.06 },
        },
      ],
    });
    expect(out.metadata.wfaSchemaVersion).toBeDefined();
    expect(out.metadata.wfaInputMode).toBe("precomputed");
    expect(out.metadata.robustnessScoreImputed).toBe(true);
    expect(out.wfe).toBeDefined();
    expect(out.consistency).toBeDefined();
    expect(out.parameterStability.available).toBe(false);
    expect(out.parameterStability).toMatchObject({ reason: "parameters_not_provided" });
    expect(out.benchmark.available).toBe(false);
    expect(out.robustnessNarrative.available).toBe(false);
    expect(out.dqg.available).toBe(false);
    expect(out.killSwitch.available).toBe(false);
    expect(Array.isArray(out.warnings)).toBe(true);
    expect(out.warnings.some((w) => w.code === "LOW_WINDOW_COUNT")).toBe(true);
    expect(out.warnings.some((w) => w.code === "ROBUSTNESS_SCORE_USES_IMPUTED_DATA")).toBe(true);
    expect(typeof out.robustnessScore).toBe("number");
  });
});

describe("analyzeFromTrades", () => {
  it("throws INSUFFICIENT_TRADES", () => {
    const base = Date.UTC(2022, 0, 1);
    expect(() =>
      analyzeFromTrades({
        wfaInputMode: "tradeSlicedPseudoWfa",
        trades: [
          { profit: 0.01, openTime: base, closeTime: base + DAY },
          { profit: 0.02, openTime: base + 2 * DAY, closeTime: base + 3 * DAY },
        ],
        windowConfig: { inSampleMonths: 1, outOfSampleMonths: 1, stepMode: "rolling" },
      }),
    ).toThrowError(/at least 3 trades/);
  });

  it("runs end-to-end on long synthetic series", () => {
    const base = Date.UTC(2019, 0, 1);
    const trades = [];
    for (let i = 0; i < 80; i++) {
      const d = i * 5;
      trades.push({
        profit: (i % 7 === 0 ? -0.01 : 0.008) as number,
        openTime: base + d * DAY,
        closeTime: base + (d + 1) * DAY,
      });
    }
    const out = analyzeFromTrades({
      wfaInputMode: "tradeSlicedPseudoWfa",
      trades,
      windowConfig: { inSampleMonths: 3, outOfSampleMonths: 2, stepMode: "rolling" },
    });
    expect(out.metadata.wfaInputMode).toBe("tradeSlicedPseudoWfa");
    expect(out.metadata.robustnessScoreImputed).toBe(true);
    expect(out.summary.totalTrades).toBe(80);
    expect(out.wfe).toBeDefined();
    expect(out.warnings.some((w) => w.code === "PSEUDO_WFA_INTERPRETATION")).toBe(true);
  });
});
