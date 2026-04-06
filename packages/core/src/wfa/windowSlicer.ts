/**
 * Trade-based pseudo-WFA: slice trades into calendar windows (IS / OOS) by closeTime (UTC).
 * See docs/KIPLOKS_ENGINE_ROADMAP.md Sprint 2.
 */

import type { Trade, WFAWindow, WindowConfig } from "@kiploks/engine-contracts";
import { KiploksValidationError } from "@kiploks/engine-contracts";

/** Mean Gregorian month length in ms. */
export const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000;

function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

/** Compound period return from per-trade profit fractions. */
export function compoundTradeReturns(profits: number[]): number {
  if (profits.length === 0) return 0;
  let eq = 1;
  for (const p of profits) {
    if (typeof p === "number" && Number.isFinite(p)) eq *= 1 + p;
  }
  return eq - 1;
}

/**
 * Slice trades into WFA windows. Assign each trade to IS or OOS by `closeTime` in half-open
 * intervals `[rangeStart, rangeEnd)` in UTC ms.
 *
 * @throws KiploksValidationError MISSING_TIMESTAMPS if no trade has `closeTime`
 * @throws KiploksValidationError INSUFFICIENT_WINDOWS_FROM_TRADES if fewer than 2 full windows fit in the data range
 */
export function sliceTradesIntoWindows(trades: Trade[], config: WindowConfig): WFAWindow[] {
  const sorted = trades
    .filter((t) => t.closeTime != null && Number.isFinite(t.closeTime))
    .sort((a, b) => (a.closeTime as number) - (b.closeTime as number));

  if (sorted.length === 0) {
    throw new KiploksValidationError(
      "MISSING_TIMESTAMPS",
      "Trade-based WFA requires closeTime (unix ms) on trades.",
    );
  }

  const tMin = sorted[0].closeTime as number;
  const tMax = sorted[sorted.length - 1].closeTime as number;

  const isMs = config.inSampleMonths * MS_PER_MONTH;
  const oosMs = config.outOfSampleMonths * MS_PER_MONTH;
  const totalMs = isMs + oosMs;
  const stepMs = config.stepMode === "rolling" ? oosMs : totalMs;

  const windows: WFAWindow[] = [];
  let start = tMin;

  while (true) {
    const isStart = start;
    const isEnd = start + isMs;
    const oosEnd = isEnd + oosMs;
    if (oosEnd > tMax) break;

    const isTrades = sorted.filter((t) => {
      const c = t.closeTime as number;
      return c >= isStart && c < isEnd;
    });
    const oosTrades = sorted.filter((t) => {
      const c = t.closeTime as number;
      return c >= isEnd && c < oosEnd;
    });

    const inSampleReturn = compoundTradeReturns(isTrades.map((t) => t.profit));
    const outSampleReturn = compoundTradeReturns(oosTrades.map((t) => t.profit));

    windows.push({
      period: { start: toIsoUtc(isStart), end: toIsoUtc(oosEnd) },
      inSample: { return: inSampleReturn },
      outOfSample: { return: outSampleReturn },
    });

    start += stepMs;
  }

  if (windows.length < 2) {
    throw new KiploksValidationError(
      "INSUFFICIENT_WINDOWS_FROM_TRADES",
      `WindowSlicer produced ${windows.length} full window(s); need at least 2 for WFA (check date span vs inSampleMonths/outOfSampleMonths).`,
    );
  }

  return windows;
}
