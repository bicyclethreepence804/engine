import { describe, expect, it } from "vitest";
import { validateStandalonePayload } from "./standalonePayloadValidation";

describe("validateStandalonePayload", () => {
  it("rejects non-object payload", () => {
    const out = validateStandalonePayload(null);
    expect(out.valid).toBe(false);
    expect(out.errors[0]).toContain("Payload must be an object");
  });

  it("accepts a minimal valid standalone payload", () => {
    const payload = {
      strategy: { symbol: "BTCUSDT" },
      backtestResult: {
        config: { startDate: "2024-01-01", endDate: "2024-12-31" },
        results: { totalTrades: 10, totalReturn: 0.1 },
      },
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.2, validationReturn: 0.1, startDate: "2024-01-01", endDate: "2024-02-01" },
        ],
      },
    };

    const out = validateStandalonePayload(payload);
    expect(out.valid).toBe(true);
    expect(out.errors).toHaveLength(0);
  });

  it("returns explicit error when symbol is missing", () => {
    const payload = {
      backtestResult: {
        config: { startDate: "2024-01-01", endDate: "2024-12-31" },
        results: { totalTrades: 10, totalReturn: 0.1 },
      },
      walkForwardAnalysis: {
        periods: [{ optimizationReturn: 0.2, validationReturn: 0.1 }],
      },
    };

    const out = validateStandalonePayload(payload);
    expect(out.valid).toBe(false);
    expect(
      out.errors.some((e) => e.includes("Symbol is missing or invalid")),
    ).toBe(true);
  });

  it("fails with explicit period field errors", () => {
    const out = validateStandalonePayload({
      strategy: { symbol: "BTCUSDT" },
      backtestResult: {
        config: { symbol: "BTCUSDT", startDate: "2024-01-01", endDate: "2024-12-31" },
        results: {},
      },
      walkForwardAnalysis: {
        periods: [{ optimizationReturn: "bad", validationReturn: null }],
      },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.includes("validationReturn"))).toBe(true);
    expect(out.errors.some((e) => e.includes("optimizationReturn"))).toBe(true);
  });

  it("supports alias fields for backtest/wfa and nested metric returns", () => {
    const out = validateStandalonePayload({
      backtest: {
        config: { symbol: "ETHUSDT", startDate: "2024-01-01", endDate: "2024-02-01" },
        results: { symbol: "ETHUSDT" },
      },
      wfaData: {
        windows: [
          {
            metrics: {
              validation: { total_return: "0.05" },
              optimization: { total_return: "0.10" },
            },
            validation_start_date: "2024-01-01",
            validation_end_date: "2024-01-31",
          },
        ],
      },
      parameters: { strategy: "demo-strategy" },
    });
    expect(out.valid).toBe(true);
    expect(out.errors).toHaveLength(0);
  });

  it("returns date-range error when both backtest and WFA dates missing", () => {
    const out = validateStandalonePayload({
      strategy: { symbol: "BTCUSDT" },
      backtestResult: { config: {}, results: { symbol: "BTCUSDT" } },
      walkForwardAnalysis: {
        periods: [{ optimizationReturn: 0.1, validationReturn: 0.05 }],
      },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.includes("Date range is required"))).toBe(true);
  });

  it("validates period object shape and parameters.strategy type", () => {
    const out = validateStandalonePayload({
      strategy: { symbol: "BTCUSDT" },
      backtestResult: {
        config: { startDate: "2024-01-01", endDate: "2024-12-31" },
        results: { symbol: "BTCUSDT" },
      },
      walkForwardAnalysis: {
        periods: [null, { optimizationReturn: 0.1, validationReturn: 0.05 }],
      },
      parameters: { strategy: 123 },
    });
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.includes("must be an object"))).toBe(true);
    expect(out.errors.some((e) => e.includes("parameters.strategy must be a string"))).toBe(true);
  });
});
