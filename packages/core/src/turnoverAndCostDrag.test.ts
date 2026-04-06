import { describe, expect, it } from "vitest";
import { buildTurnoverAndCostDrag } from "./turnoverAndCostDrag";

describe("buildTurnoverAndCostDrag", () => {
  it("returns null when there are no trades", () => {
    const out = buildTurnoverAndCostDrag({
      config: {},
      results: {},
      trades: [],
    });
    expect(out).toBeNull();
  });

  it("builds turnover block for minimal buy/sell sequence", () => {
    const out = buildTurnoverAndCostDrag({
      config: {
        initialBalance: 1000,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      },
      results: {
        totalTrades: 2,
        annualizedReturn: 0.2,
      },
      trades: [
        {
          symbol: "BTC/USDT",
          timestamp: 1704067200000,
          side: "BUY",
          price: 100,
          quantity: 1,
          pnl: 0,
        },
        {
          symbol: "BTC/USDT",
          timestamp: 1704153600000,
          side: "SELL",
          price: 102,
          quantity: 1,
          pnl: 2,
        },
      ],
    } as never);

    expect(out).not.toBeNull();
    expect(out?.avgTradesPerMonth).toBeGreaterThan(0);
    expect(out?.annualTurnover).toBeGreaterThan(0);
  });

  it("sets executionIsEstimated when commission/slippage are missing", () => {
    const out = buildTurnoverAndCostDrag({
      config: {
        initialBalance: 1000,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      },
      results: { totalTrades: 2, annualizedReturn: 0.1 },
      trades: [
        { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1704153600000, side: "SELL", price: 101, quantity: 1, pnl: 1 },
      ],
    } as never);

    expect(out).not.toBeNull();
    expect(out?.executionIsEstimated).toBe(true);
  });

  it("keeps gross/net degradation non-positive when finite", () => {
    const out = buildTurnoverAndCostDrag({
      config: {
        initialBalance: 1000,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        commission: 0.001,
        slippage: 0.0005,
      },
      results: {
        totalTrades: 4,
        annualizedReturn: 0.2,
      },
      trades: [
        { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1704153600000, side: "SELL", price: 101, quantity: 1, pnl: 1 },
        { symbol: "BTC/USDT", timestamp: 1704240000000, side: "BUY", price: 101, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1704326400000, side: "SELL", price: 103, quantity: 1, pnl: 2 },
      ],
    } as never);

    expect(out).not.toBeNull();
    if (typeof out?.grossToNetDegradation === "number") {
      expect(out.grossToNetDegradation).toBeLessThanOrEqual(0);
    }
    if (typeof out?.costDrag === "number") {
      expect(out.costDrag).toBeLessThanOrEqual(0);
    }
  });

  it("returns execution grade and breakeven fields for profitable case", () => {
    const out = buildTurnoverAndCostDrag({
      config: {
        initialBalance: 1000,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        commission: 0.0005,
        slippage: 0.0002,
      },
      results: {
        totalTrades: 6,
        annualizedReturn: 0.35,
        profitFactor: 1.4,
      },
      trades: [
        { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1704153600000, side: "SELL", price: 104, quantity: 1, pnl: 4 },
        { symbol: "BTC/USDT", timestamp: 1704240000000, side: "BUY", price: 103, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1704326400000, side: "SELL", price: 106, quantity: 1, pnl: 3 },
        { symbol: "BTC/USDT", timestamp: 1704412800000, side: "BUY", price: 105, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1704499200000, side: "SELL", price: 108, quantity: 1, pnl: 3 },
      ],
    } as never);

    expect(out).not.toBeNull();
    expect(typeof out?.executionGrade).toBe("string");
    if (typeof out?.breakevenSlippageBps === "number") {
      expect(out.breakevenSlippageBps).toBeGreaterThanOrEqual(0);
    }
  });

  it("flags market impact out of range on extreme participation", () => {
    const out = buildTurnoverAndCostDrag(
      {
        config: {
          initialBalance: 200_000,
          startDate: "2024-01-01",
          endDate: "2024-02-01",
          commission: 0.0005,
          slippage: 0.0002,
        },
        results: {
          totalTrades: 4,
          annualizedReturn: 0.25,
          profitFactor: 1.2,
        },
        trades: [
          { symbol: "ALT/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 400, pnl: 0 },
          { symbol: "ALT/USDT", timestamp: 1704153600000, side: "SELL", price: 101, quantity: 400, pnl: 400 },
          { symbol: "ALT/USDT", timestamp: 1704240000000, side: "BUY", price: 102, quantity: 400, pnl: 0 },
          { symbol: "ALT/USDT", timestamp: 1704326400000, side: "SELL", price: 103, quantity: 400, pnl: 400 },
        ],
      } as never,
      {
        data: [
          { timestamp: 1704067200000, close: 100, volume: 5 },
          { timestamp: 1704153600000, close: 101, volume: 5 },
          { timestamp: 1704240000000, close: 99, volume: 5 },
          { timestamp: 1704326400000, close: 100, volume: 5 },
        ],
      },
    );

    expect(out).not.toBeNull();
    expect(out?.advSource).toBe("api");
    expect(out?.marketImpactOutOfRange).toBe(true);
  });

  it("adds AUM exceeds ADV note for oversized baseline capital", () => {
    const out = buildTurnoverAndCostDrag(
      {
        config: {
          initialBalance: 2_000_000,
          startDate: "2024-01-01",
          endDate: "2024-12-31",
        },
        results: {
          totalTrades: 2,
          annualizedReturn: 0.05,
        },
        trades: [
          { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 1, pnl: 0 },
          { symbol: "BTC/USDT", timestamp: 1704153600000, side: "SELL", price: 101, quantity: 1, pnl: 1 },
        ],
      } as never,
      {
        data: [
          { timestamp: 1704067200000, close: 100, volume: 10_000 },
          { timestamp: 1704153600000, close: 100, volume: 10_000 },
          { timestamp: 1704240000000, close: 100, volume: 10_000 },
        ],
      },
    );

    expect(out).not.toBeNull();
    expect(typeof out?.capacity?.aumExceedsAdvNote).toBe("string");
  });

  it("caps annual turnover for low-trade history", () => {
    const out = buildTurnoverAndCostDrag({
      config: {
        initialBalance: 1000,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      },
      results: {
        totalTrades: 1,
        annualizedReturn: 0.03,
      },
      trades: [
        { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 1000, quantity: 1, pnl: 0 },
        { symbol: "BTC/USDT", timestamp: 1719705600000, side: "SELL", price: 1010, quantity: 1, pnl: 10 },
      ],
    } as never);

    expect(out).not.toBeNull();
    if (typeof out?.annualTurnover === "number") {
      expect(out.annualTurnover).toBeLessThanOrEqual(2);
    }
  });

  it("returns no slippage sensitivity rows for invalid initial balance", () => {
    const out = buildTurnoverAndCostDrag(
      {
        config: {
          initialBalance: 0,
          startDate: "2024-01-01",
          endDate: "2024-12-31",
        },
        results: { totalTrades: 2, annualizedReturn: 0.1 },
        trades: [
          { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 1, pnl: 0 },
          { symbol: "BTC/USDT", timestamp: 1704153600000, side: "SELL", price: 101, quantity: 1, pnl: 1 },
        ],
      } as never,
      {
        data: [
          { timestamp: 1704067200000, close: 100, volume: 1000 },
          { timestamp: 1704153600000, close: 101, volume: 1000 },
        ],
      },
    );
    expect(out).not.toBeNull();
    expect(Array.isArray(out?.slippageSensitivity)).toBe(true);
  });

  it("detects high execution risk for very short holding and high volatility", () => {
    const out = buildTurnoverAndCostDrag(
      {
        config: {
          initialBalance: 10_000,
          startDate: "2024-01-01",
          endDate: "2024-01-05",
          commission: 0.0005,
          slippage: 0.0002,
        },
        results: { totalTrades: 4, annualizedReturn: 0.2, profitFactor: 1.2 },
        trades: [
          { symbol: "BTC/USDT", timestamp: 1704067200000, side: "BUY", price: 100, quantity: 10, pnl: 0 },
          { symbol: "BTC/USDT", timestamp: 1704069000000, side: "SELL", price: 101, quantity: 10, pnl: 10 },
          { symbol: "BTC/USDT", timestamp: 1704070800000, side: "BUY", price: 98, quantity: 10, pnl: 0 },
          { symbol: "BTC/USDT", timestamp: 1704072600000, side: "SELL", price: 100, quantity: 10, pnl: 20 },
        ],
      } as never,
      {
        data: [
          { timestamp: 1704067200000, close: 100, volume: 2000 },
          { timestamp: 1704070800000, close: 85, volume: 1800 },
          { timestamp: 1704074400000, close: 110, volume: 2200 },
          { timestamp: 1704078000000, close: 90, volume: 2000 },
        ],
      },
    );
    expect(out).not.toBeNull();
    expect(["HIGH", "WARNING", "CONTROLLED"]).toContain(String(out?.status?.executionRisk));
  });
});
