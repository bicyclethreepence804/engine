import { describe, expect, it } from "vitest";
import type { TradeBasedWFAInput } from "@kiploks/engine-contracts";

import { validate } from "./validate";

function baseValidInput(): TradeBasedWFAInput {
  return {
    wfaInputMode: "tradeSlicedPseudoWfa",
    windowConfig: { inSampleMonths: 2, outOfSampleMonths: 1, stepMode: "rolling" },
    trades: [
      { profit: 0.01, openTime: 1700000000000, closeTime: 1700000100000 },
      { profit: -0.02, openTime: 1700000200000, closeTime: 1700000300000 },
      { profit: 0.03, openTime: 1700000400000, closeTime: 1700000500000 },
    ],
  };
}

describe("kiploks validate trade-based-wfa", () => {
  it("ok for minimal valid input", () => {
    const input = baseValidInput();
    const out = validate(input as unknown, "trade-based-wfa", true);
    expect(out.ok).toBe(true);
    expect(out.errors.length).toBe(0);
  });

  it("reports missing openTime", () => {
    const input: any = baseValidInput();
    delete input.trades[0]!.openTime;
    const out = validate(input, "trade-based-wfa", true);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.path === "trades[0].openTime" && e.code === "MISSING_TIMESTAMPS")).toBe(true);
  });

  it("reports insufficient trades", () => {
    const input: any = baseValidInput();
    input.trades = input.trades.slice(0, 2);
    const out = validate(input, "trade-based-wfa", false);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.path === "trades" && e.code === "INSUFFICIENT_TRADES")).toBe(true);
  });
});

