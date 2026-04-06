import type { ProcessedKline } from "./benchmarkCore";
import { normalizeKlines } from "./benchmarkCore";

export type BenchmarkKlinesFetchFn = (args: {
  exchangeType: string;
  symbol: string;
  interval: string;
  startMs: number;
  endMs: number;
}) => Promise<ProcessedKline[]>;

export interface ResolveBenchmarkKlinesArgs {
  exchangeType: string;
  symbol: string;
  interval: string;
  startMs: number;
  endMs: number;
  processedKlines?: ProcessedKline[];
  providedKlines?: unknown[];
  fetchKlines: BenchmarkKlinesFetchFn;
  onError?: (error: unknown) => void;
}

function isValidProcessedKline(k: unknown): k is ProcessedKline {
  if (!k || typeof k !== "object") return false;
  const rec = k as { timestamp?: unknown; close?: unknown };
  return (
    typeof rec.timestamp === "number" &&
    Number.isFinite(rec.timestamp) &&
    typeof rec.close === "number" &&
    Number.isFinite(rec.close)
  );
}

/**
 * Resolve BTC klines for benchmark calculations.
 * Priority: `processedKlines` (already normalized by caller) -> `providedKlines` (raw) -> `fetchKlines` (I/O boundary).
 */
export async function resolveBenchmarkBtcKlines(
  args: ResolveBenchmarkKlinesArgs,
): Promise<ProcessedKline[] | null> {
  const {
    processedKlines,
    providedKlines,
    fetchKlines,
    onError,
    exchangeType,
    symbol,
    interval,
    startMs,
    endMs,
  } = args;

  if (processedKlines != null && Array.isArray(processedKlines) && processedKlines.length >= 2) {
    const valid = processedKlines.filter(isValidProcessedKline);
    if (valid.length < 2) return null;
    return valid.sort((a, b) => a.timestamp - b.timestamp);
  }

  if (providedKlines != null && Array.isArray(providedKlines) && providedKlines.length >= 2) {
    const normalized = normalizeKlines(providedKlines);
    if (normalized.length < 2) return null;
    return normalized;
  }

  try {
    const fetched = await fetchKlines({
      exchangeType,
      symbol,
      interval,
      startMs,
      endMs,
    });
    if (!Array.isArray(fetched) || fetched.length < 2) return null;
    const valid = fetched.filter(isValidProcessedKline);
    if (valid.length < 2) return null;
    return valid.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    onError?.(error);
    return null;
  }
}

