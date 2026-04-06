import { describe, expect, it } from "vitest";
import { deduplicateNormalizedTrades, normalizeTradesForTurnover } from "./normalizeTrades";

describe("normalizeTradesForTurnover", () => {
  it("returns empty for empty input", () => {
    expect(normalizeTradesForTurnover([], "BTC/USDT")).toEqual([]);
  });

  it("normalizes kiploks trade shape and fills default symbol", () => {
    const out = normalizeTradesForTurnover(
      [
        {
          price: 100,
          quantity: 1,
          pnl: 2,
          timestamp: "2024-01-01T00:00:00Z",
          side: "BUY",
        },
      ],
      "BTC/USDT",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.symbol).toBe("BTC/USDT");
  });

  it("normalizes freqtrade trade into two legs", () => {
    const out = normalizeTradesForTurnover(
      [
        {
          open_date: "2024-01-01T00:00:00Z",
          close_date: "2024-01-02T00:00:00Z",
          open_rate: 100,
          close_rate: 105,
          profit_abs: 5,
          stake_amount: 100,
          pair: "BTCUSDT",
        },
      ],
      "default",
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.side).toBe("BUY");
    expect(out[1]!.side).toBe("SELL");
    expect(out[1]!.pnl).toBe(5);
    expect(out[0]!.symbol).toBe("BTC/USDT");
  });

  it("uses amount when stake_amount is not usable", () => {
    const out = normalizeTradesForTurnover(
      [
        {
          open_date: "2024-01-01T00:00:00Z",
          close_date: "2024-01-02T00:00:00Z",
          open_rate: 10,
          close_rate: 11,
          profit_abs: 1,
          stake_amount: Number.NaN,
          amount: 4,
          pair: "ETH/USDT",
        },
      ],
      "default",
    );
    expect(out[0]!.quantity).toBe(4);
  });

  it("keeps slash pairs and maps bare USDT tickers", () => {
    const slash = normalizeTradesForTurnover(
      [
        {
          open_date: "2024-01-01T00:00:00Z",
          close_date: "2024-01-02T00:00:00Z",
          open_rate: 1,
          close_rate: 1,
          profit_abs: 0,
          stake_amount: 10,
          pair: "SOL/USDT",
        },
      ],
      "default",
    );
    expect(slash[0]!.symbol).toBe("SOL/USDT");

    const bare = normalizeTradesForTurnover(
      [
        {
          open_date: "2024-01-01T00:00:00Z",
          close_date: "2024-01-02T00:00:00Z",
          open_rate: 1,
          close_rate: 1,
          profit_abs: 0,
          stake_amount: 10,
          pair: "ADAUSDT",
        },
      ],
      "default",
    );
    expect(bare[0]!.symbol).toBe("ADA/USDT");
  });

  it("falls back to quantity 1 and preserves non-USDT pair strings", () => {
    const out = normalizeTradesForTurnover(
      [
        {
          open_date: "2024-01-01T00:00:00Z",
          close_date: "2024-01-02T00:00:00Z",
          open_rate: 2,
          close_rate: 2,
          profit_abs: 0,
          pair: "ALT/QUOTE",
        },
      ],
      "default",
    );
    expect(out[0]!.quantity).toBe(1);
    expect(out[0]!.symbol).toBe("ALT/QUOTE");
  });

  it("deduplicates exact duplicate normalized legs", () => {
    const out = normalizeTradesForTurnover(
      [
        {
          price: 100,
          quantity: 1,
          pnl: 2,
          timestamp: "2024-01-01T00:00:00Z",
          side: "BUY",
          symbol: "BTC/USDT",
        },
        {
          price: 100,
          quantity: 1,
          pnl: 2,
          timestamp: "2024-01-01T00:00:00Z",
          side: "BUY",
          symbol: "BTC/USDT",
        },
      ],
      "BTC/USDT",
    );
    expect(out).toHaveLength(1);
  });

  it("deduplicate helper keeps first occurrence order", () => {
    const deduped = deduplicateNormalizedTrades([
      { price: 1, quantity: 1, pnl: 0, timestamp: 1, side: "BUY", symbol: "BTC/USDT" },
      { price: 2, quantity: 1, pnl: 0, timestamp: 2, side: "SELL", symbol: "BTC/USDT" },
      { price: 1, quantity: 1, pnl: 0, timestamp: 1, side: "BUY", symbol: "BTC/USDT" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]!.price).toBe(1);
    expect(deduped[1]!.price).toBe(2);
  });
});
