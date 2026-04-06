import { describe, expect, it } from "vitest";
import { mapPayloadToUnified } from "./mapPayloadToUnified";

describe("mapPayloadToUnified", () => {
  it("normalizes backtest results and WFA periods from mixed snake_case payload", () => {
    const raw = {
      id: "r1",
      backtest: {
        results: {
          total_trades: "42",
          profit_total: 12.5,
        },
      },
      wfaData: {
        periods: [
          {
            optimization_return: 30,
            validation_return: -12,
          },
          {
            metrics: {
              optimization: { total: 10 },
              validation: { totalReturn: 5 },
            },
          },
        ],
      },
    };

    const out = mapPayloadToUnified(raw);
    const backtestResult = out.backtestResult as
      | { results?: { totalTrades?: number; totalReturn?: number } }
      | undefined;
    const periods = (out.walkForwardAnalysis as { periods?: Array<{ optimizationReturn?: number; validationReturn?: number }> } | undefined)?.periods;

    expect(backtestResult?.results?.totalTrades).toBe(42);
    expect(backtestResult?.results?.totalReturn).toBe(0.125);

    expect(periods?.[0]).toMatchObject({
      optimizationReturn: 0.3,
      validationReturn: -0.12,
    });
    expect(periods?.[1]).toMatchObject({
      optimizationReturn: 0.1,
      validationReturn: 0.05,
    });
  });

  it("normalizes WFA from windows alias and keeps object links consistent", () => {
    const raw = {
      backtestResult: {
        results: {
          totalTrades: 7,
          totalReturn: 25,
        },
      },
      wfaResult: {
        windows: [{ optimizationReturn: 15, validationReturn: 3 }],
      },
    };

    const out = mapPayloadToUnified(raw);
    const wfa = out.walkForwardAnalysis as
      | { windows?: Array<{ optimizationReturn?: number; validationReturn?: number }> }
      | undefined;
    const backtestResult = out.backtestResult as
      | { results?: { totalTrades?: number; totalReturn?: number } }
      | undefined;

    expect(backtestResult?.results?.totalReturn).toBe(0.25);
    expect(wfa?.windows?.[0]).toMatchObject({
      optimizationReturn: 0.15,
      validationReturn: 0.03,
    });
    expect(out.wfaResult).toBe(out.walkForwardAnalysis);
  });

  it("reads return from profit_total_pct when totalReturn and profit_total are absent", () => {
    const raw = {
      backtest: {
        results: {
          profit_total_pct: 8,
        },
      },
    };
    const out = mapPayloadToUnified(raw);
    const results = (out.backtestResult as { results?: { totalReturn?: number } })?.results;
    expect(results?.totalReturn).toBeCloseTo(0.08, 10);
  });

  it("passes through non-numeric totalReturn without decimal conversion", () => {
    const raw = {
      backtest: {
        results: {
          totalTrades: 1,
          totalReturn: "pending",
        },
      },
    };
    const out = mapPayloadToUnified(raw);
    const results = (out.backtestResult as { results?: { totalReturn?: unknown } })?.results;
    expect(results?.totalReturn).toBe("pending");
  });

  it("does not write totalTrades when numeric conversion is invalid", () => {
    const raw = {
      backtest: {
        results: {
          total_trades: "not-a-number",
          profit_total: 5,
        },
      },
    };

    const out = mapPayloadToUnified(raw);
    const backtestResult = out.backtestResult as
      | { results?: { totalTrades?: number; totalReturn?: number; total_trades?: string } }
      | undefined;

    expect(backtestResult?.results?.totalTrades).toBeUndefined();
    expect(backtestResult?.results?.totalReturn).toBe(0.05);
    expect(backtestResult?.results?.total_trades).toBe("not-a-number");
  });
});
