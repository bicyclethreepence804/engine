import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";

import { csvToTrades, csvToTradesFromStream } from "./csvToTrades";

describe("csvToTrades", () => {
  it("autodetects comma delimiter and maps fields", () => {
    const csv = [
      "profit_ratio,open_time,close_time,symbol",
      "0.01,2024-01-01T00:00:00Z,2024-01-02T00:00:00Z,BTC/USDT",
      "-0.02,2024-01-03T00:00:00Z,2024-01-04T00:00:00Z,BTC/USDT",
    ].join("\n");

    const trades = csvToTrades(csv, {
      profit: "profit_ratio",
      openTime: "open_time",
      closeTime: "close_time",
      symbol: "symbol",
    });

    expect(trades.length).toBe(2);
    expect(trades[0]!.profit).toBeCloseTo(0.01, 12);
    expect(trades[0]!.symbol).toBe("BTC/USDT");
    expect(trades[0]!.openTime).toBe(1704067200000);
    expect(trades[0]!.closeTime).toBe(1704153600000);
  });

  it("autodetects semicolon delimiter", () => {
    const csv = [
      "profit_ratio;open_time;close_time;symbol",
      "0.1;2024-01-01T00:00:00Z;2024-01-02T00:00:00Z;BTC/USDT",
      "0.2;2024-01-03T00:00:00Z;2024-01-04T00:00:00Z;BTC/USDT",
    ].join("\n");

    const trades = csvToTrades(csv, {
      profit: "profit_ratio",
      openTime: "open_time",
      closeTime: "close_time",
      symbol: "symbol",
    });

    expect(trades.length).toBe(2);
    expect(trades[1]!.profit).toBeCloseTo(0.2, 12);
  });

  it("streams and maps fields (csvToTradesFromStream)", async () => {
    const csv = [
      "profit,openTime,closeTime,direction,symbol",
      "0.01,2024-01-01T00:00:00Z,2024-01-02T00:00:00Z,long,BTC/USDT",
      "-0.02,2024-01-03T00:00:00Z,2024-01-04T00:00:00Z,short,BTC/USDT",
    ].join("\n");

    const trades = await csvToTradesFromStream(Readable.from([csv]), {
      profit: "profit",
      openTime: "openTime",
      closeTime: "closeTime",
      direction: "direction",
      symbol: "symbol",
    });

    expect(trades.length).toBe(2);
    expect(trades[0]!.profit).toBeCloseTo(0.01, 12);
    expect(trades[0]!.direction).toBe("long");
    expect(trades[1]!.direction).toBe("short");
  });

  it("enforces maxTrades limit", async () => {
    const csv = [
      "profit,openTime,closeTime",
      "0.01,2024-01-01T00:00:00Z,2024-01-02T00:00:00Z",
      "0.02,2024-01-03T00:00:00Z,2024-01-04T00:00:00Z",
    ].join("\n");

    await expect(
      csvToTradesFromStream(Readable.from([csv]), { profit: "profit", openTime: "openTime", closeTime: "closeTime" }, { maxTrades: 1 }),
    ).rejects.toThrow(/maxTrades exceeded/i);
  });
});

