import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

import type { AnalyzeConfig, Trade, WFAAnalysisOutput } from "@kiploks/engine-contracts";
import type { WindowConfig, TradeBasedWFAInput as TradeBasedWFAInputContract } from "@kiploks/engine-contracts";
import { KiploksValidationError } from "@kiploks/engine-contracts";
import { analyzeFromTrades } from "@kiploks/engine-core";

import { csvToTradesFromStream } from "@kiploks/engine-adapters";
import type { CsvColumnMapping } from "@kiploks/engine-adapters";

export type JsonInputFormat = "raw-trades";
export type InputFormat = JsonInputFormat | "csv";

export type AnalyzeTradesCliArgs = {
  inputPath: string;
  json: boolean;
  seed?: number;
  decimals?: number;
  /** WFE permutation count; passed to AnalyzeConfig.permutationN when set. */
  permutationN?: number;

  inSampleMonths: number;
  outOfSampleMonths: number;
  stepMode: "anchored" | "rolling";

  format: "auto" | InputFormat;
  showDetectedFormat: boolean;

  csvMapping: {
    mapProfit: string;
    mapOpenTime: string;
    mapCloseTime: string;
    mapDirection?: string;
    mapSymbol?: string;
  };

  /**
   * Only used when converting "raw-trades" that provide profit_abs but no profit_ratio.
   * Optional: if you pass proper `profit` field, it is ignored.
   */
  initialBalance?: number;
};

type UnknownJson = unknown;

function buildConfig(seed?: number, decimals?: number, permutationN?: number): AnalyzeConfig {
  return {
    ...(typeof seed === "number" && !Number.isNaN(seed) ? { seed } : {}),
    ...(typeof decimals === "number" && !Number.isNaN(decimals) ? { decimals } : {}),
    ...(typeof permutationN === "number" && !Number.isNaN(permutationN) ? { permutationN } : {}),
  };
}

function detectInputFormatFromPath(inputPath: string): "csv" | undefined {
  return inputPath.toLowerCase().endsWith(".csv") ? "csv" : undefined;
}

function toWindowConfig(args: AnalyzeTradesCliArgs): WindowConfig {
  return {
    inSampleMonths: args.inSampleMonths,
    outOfSampleMonths: args.outOfSampleMonths,
    stepMode: args.stepMode,
  };
}

export function extractRawTrades(payload: UnknownJson, args: AnalyzeTradesCliArgs): Trade[] {
  if (!Array.isArray(payload)) {
    throw new Error(
      "raw-trades: expecting JSON array of trade-like objects. Bot-specific export JSON is not supported in-tree; convert to Trade[] or CSV first.",
    );
  }

  const out: Trade[] = [];
  const initialBalance = args.initialBalance ?? 1;
  for (const row of payload as any[]) {
    if (!row || typeof row !== "object") continue;
    const profit =
      Number.isFinite(Number(row.profit)) ? Number(row.profit) : Number.isFinite(Number(row.profit_ratio)) ? Number(row.profit_ratio) : null;
    const profitAbs = Number.isFinite(Number(row.profit_abs)) ? Number(row.profit_abs) : Number.isFinite(Number(row.profitAbs)) ? Number(row.profitAbs) : null;
    const p = profit != null ? profit : profitAbs != null ? profitAbs / initialBalance : null;
    const openTime =
      row.openTime ?? row.open_time ?? row.open_date ?? row.open_timestamp ?? null;
    const closeTime =
      row.closeTime ?? row.close_time ?? row.close_date ?? row.close_timestamp ?? null;
    const open = new Date(openTime).getTime();
    const close = new Date(closeTime).getTime();
    if (!Number.isFinite(p) || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    out.push({ profit: p as number, openTime: open, closeTime: close, direction: row.direction, symbol: row.symbol });
  }
  return out;
}

export async function readInputTradesJson(inputPath: string): Promise<unknown> {
  const abs = path.resolve(process.cwd(), inputPath);
  const fileContent = await readFile(abs, "utf8");
  return JSON.parse(fileContent) as unknown;
}

function detectInfo(payload: UnknownJson, format: JsonInputFormat): string {
  try {
    if (format === "raw-trades" && Array.isArray(payload)) return `Detected format: raw-trades (items=${payload.length})`;
  } catch {
    // ignore
  }
  return `Detected format: ${format}`;
}

/** Auto: .csv -> csv; otherwise JSON must be a top-level array (raw trades). */
export function detectInputFormat(payload: UnknownJson): JsonInputFormat {
  if (Array.isArray(payload)) return "raw-trades";
  throw new Error(
    "Unknown trades JSON: expected a top-level array of trades with profit and timestamps. Convert bot exports to Trade[] first, or use a CSV file with --format csv.",
  );
}

export async function runAnalyzeTrades(args: AnalyzeTradesCliArgs): Promise<void> {
  const abs = path.resolve(process.cwd(), args.inputPath);

  let detected: InputFormat;
  let payload: UnknownJson | undefined;

  if (args.format !== "auto") {
    detected = args.format;
  } else {
    const byExt = detectInputFormatFromPath(args.inputPath);
    detected = byExt ?? "raw-trades";
    if (!byExt) {
      payload = await readInputTradesJson(args.inputPath);
      detected = detectInputFormat(payload);
    }
  }

  if (detected !== "csv") {
    payload = payload ?? (await readInputTradesJson(args.inputPath));
  }

  if (args.showDetectedFormat) {
    const msg =
      detected === "csv"
        ? `Detected format: csv`
        : detectInfo(payload as UnknownJson, detected as JsonInputFormat);
    if (args.json) process.stderr.write(`${msg}\n`);
    else process.stdout.write(`${msg}\n`);
  }

  const trades =
    detected === "csv"
      ? await convertCsvToTrades(abs, args)
      : extractRawTrades(payload as UnknownJson, args);
  if (trades.length === 0) {
    throw new KiploksValidationError("INVALID_RETURN_VALUE", "No trades could be converted from input payload.");
  }

  const input: TradeBasedWFAInputContract = {
    trades,
    windowConfig: toWindowConfig(args),
    wfaInputMode: "tradeSlicedPseudoWfa",
  };

  const config = buildConfig(args.seed, args.decimals, args.permutationN);
  const output: WFAAnalysisOutput = analyzeFromTrades(input, config);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    process.stdout.write(`WFA robustnessScore: ${output.robustnessScore ?? "n/a"}\n`);
    process.stdout.write(`WFE verdict: ${output.wfe?.verdict ?? "n/a"}\n`);
    process.stdout.write(`- totalTrades: ${output.summary.totalTrades}\n`);
  }
}

const DEFAULT_CSV_MAX_TRADES = 500_000;

async function convertCsvToTrades(absPath: string, args: AnalyzeTradesCliArgs): Promise<Trade[]> {
  const stream = createReadStream(absPath, { encoding: "utf8" });
  const mapping: CsvColumnMapping = {
    profit: args.csvMapping.mapProfit,
    openTime: args.csvMapping.mapOpenTime,
    closeTime: args.csvMapping.mapCloseTime,
    direction: args.csvMapping.mapDirection,
    symbol: args.csvMapping.mapSymbol,
  };

  return csvToTradesFromStream(stream, mapping, { maxTrades: DEFAULT_CSV_MAX_TRADES });
}
