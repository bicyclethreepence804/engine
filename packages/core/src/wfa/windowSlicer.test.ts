import { describe, expect, it } from "vitest";
import { KiploksValidationError } from "@kiploks/engine-contracts";
import type { Trade } from "@kiploks/engine-contracts";
import { compoundTradeReturns, sliceTradesIntoWindows } from "./windowSlicer";

const DAY = 24 * 60 * 60 * 1000;

function trade(
  profit: number,
  closeOffsetDays: number,
  openOffsetDays = closeOffsetDays - 1,
): Trade {
  const base = Date.UTC(2020, 0, 1);
  return {
    profit,
    openTime: base + openOffsetDays * DAY,
    closeTime: base + closeOffsetDays * DAY,
  };
}

describe("compoundTradeReturns", () => {
  it("returns 0 for empty", () => {
    expect(compoundTradeReturns([])).toBe(0);
  });
  it("compounds two profits", () => {
    expect(compoundTradeReturns([0.1, -0.05])).toBeCloseTo(1.1 * 0.95 - 1, 10);
  });
});

describe("sliceTradesIntoWindows", () => {
  it("throws MISSING_TIMESTAMPS when no closeTime", () => {
    expect(() =>
      sliceTradesIntoWindows([{ profit: 0.01 }], {
        inSampleMonths: 1,
        outOfSampleMonths: 1,
        stepMode: "rolling",
      }),
    ).toThrow(KiploksValidationError);
  });

  it("throws INSUFFICIENT_WINDOWS_FROM_TRADES when span too short", () => {
    const trades: Trade[] = [trade(0.01, 10), trade(0.02, 20), trade(-0.01, 25)];
    expect(() =>
      sliceTradesIntoWindows(trades, {
        inSampleMonths: 6,
        outOfSampleMonths: 2,
        stepMode: "anchored",
      }),
    ).toThrow(/INSUFFICIENT_WINDOWS_FROM_TRADES|WindowSlicer produced/);
  });

  it("produces at least 2 rolling windows over long span", () => {
    const trades: Trade[] = [];
    for (let d = 0; d < 400; d += 3) {
      trades.push(trade(0.001, d));
    }
    const windows = sliceTradesIntoWindows(trades, {
      inSampleMonths: 2,
      outOfSampleMonths: 1,
      stepMode: "rolling",
    });
    expect(windows.length).toBeGreaterThanOrEqual(2);
    expect(windows[0].inSample.return).toBeDefined();
    expect(windows[0].outOfSample.return).toBeDefined();
  });

});
