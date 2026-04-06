import { describe, expect, it } from "vitest";

import { analyzeFromTrades } from "@kiploks/engine-core";
import type { AnalyzeConfig, TradeBasedWFAInput } from "@kiploks/engine-contracts";

import {
  detectInputFormat,
  extractRawTrades,
  type AnalyzeTradesCliArgs,
} from "./analyze-trades";

const ANALYZE_CONFIG: AnalyzeConfig = { seed: 42, decimals: 8 };

function baseCliArgs(overrides?: Partial<AnalyzeTradesCliArgs>): AnalyzeTradesCliArgs {
  return {
    inputPath: "dummy.json",
    json: true,
    inSampleMonths: 2,
    outOfSampleMonths: 1,
    stepMode: "anchored",
    format: "auto",
    showDetectedFormat: false,
    csvMapping: {
      mapProfit: "profit",
      mapOpenTime: "openTime",
      mapCloseTime: "closeTime",
    },
    ...overrides,
  };
}

describe("kiploks analyze-trades input conversion", () => {
  it("detectInputFormat returns raw-trades for a JSON array", () => {
    const payload = [{ profit: 0.01, openTime: 1578182400000, closeTime: 1578528000000 }];
    expect(detectInputFormat(payload)).toBe("raw-trades");
  });

  it("detectInputFormat throws for non-array JSON (bot exports not supported in-tree)", () => {
    expect(() => detectInputFormat({ backtestResult: { trades: [] } })).toThrow(/top-level array/);
  });

  it("extractRawTrades + analyzeFromTrades runs on synthetic series", () => {
    const base = Date.UTC(2019, 0, 1);
    const DAY = 86400000;
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const d = i * 5;
      rows.push({
        profit: 0.008,
        openTime: base + d * DAY,
        closeTime: base + (d + 1) * DAY,
      });
    }
    const args = baseCliArgs();
    const trades = extractRawTrades(rows, args);
    expect(trades.length).toBe(40);

    const input: TradeBasedWFAInput = {
      trades,
      windowConfig: { inSampleMonths: 3, outOfSampleMonths: 1, stepMode: "rolling" },
      wfaInputMode: "tradeSlicedPseudoWfa",
    };
    const out = analyzeFromTrades(input, ANALYZE_CONFIG);
    expect(out.wfe).toBeDefined();
    expect(out.consistency).toBeDefined();
    expect(out.parameterStability.available).toBe(false);
    expect(out.benchmark.available).toBe(false);
    expect(out.dqg.available).toBe(false);
    expect(out.killSwitch.available).toBe(false);
    expect(typeof out.robustnessScore).toBe("number");
  });
});
