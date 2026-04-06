import { describe, expect, it, vi } from "vitest";
import { resolveBenchmarkBtcKlines } from "./benchmarkKlinesResolver";

const baseArgs = {
  exchangeType: "binance",
  symbol: "BTC/USDT",
  interval: "1h",
  startMs: 1,
  endMs: 2,
};

describe("resolveBenchmarkBtcKlines", () => {
  it("calls onError when fetch fails and returns null", async () => {
    const onError = vi.fn();
    const fetchKlines = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    const out = await resolveBenchmarkBtcKlines({
      ...baseArgs,
      fetchKlines,
      onError,
    });

    expect(out).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("uses processed klines when valid and sorts by timestamp", async () => {
    const fetchKlines = vi.fn();
    const out = await resolveBenchmarkBtcKlines({
      ...baseArgs,
      processedKlines: [
        { timestamp: 200, close: 2 },
        { timestamp: 100, close: 1 },
        { timestamp: 150, close: NaN },
      ],
      fetchKlines,
    });
    expect(fetchKlines).not.toHaveBeenCalled();
    expect(out).toEqual([
      { timestamp: 100, close: 1 },
      { timestamp: 200, close: 2 },
    ]);
  });

  it("returns null when processed klines have fewer than two valid points", async () => {
    const out = await resolveBenchmarkBtcKlines({
      ...baseArgs,
      processedKlines: [{ timestamp: 1, close: 1 }, { timestamp: 2, close: Number.NaN }],
      fetchKlines: vi.fn(),
    });
    expect(out).toBeNull();
  });

  it("normalizes providedKlines when present", async () => {
    const out = await resolveBenchmarkBtcKlines({
      ...baseArgs,
      providedKlines: [
        [1000, 0, 0, 0, 50, 0],
        [2000, 0, 0, 0, 55, 0],
      ],
      fetchKlines: vi.fn(),
    });
    expect(out).toEqual([
      { timestamp: 1000, close: 50 },
      { timestamp: 2000, close: 55 },
    ]);
  });

  it("fetches and validates when processed and provided inputs are absent", async () => {
    const fetchKlines = vi.fn(async () => [
      { timestamp: 300, close: 3 },
      { timestamp: 100, close: 1 },
    ]);
    const out = await resolveBenchmarkBtcKlines({
      ...baseArgs,
      fetchKlines,
    });
    expect(fetchKlines).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      { timestamp: 100, close: 1 },
      { timestamp: 300, close: 3 },
    ]);
  });

  it("returns null when fetch returns too few usable rows", async () => {
    const out = await resolveBenchmarkBtcKlines({
      ...baseArgs,
      fetchKlines: vi.fn(async () => [{ timestamp: 1, close: 1 }]),
    });
    expect(out).toBeNull();
  });
});
