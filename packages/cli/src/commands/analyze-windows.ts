import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AnalyzeConfig, PrecomputedWFAInput, WFAAnalysisOutput } from "@kiploks/engine-contracts";
import type { EquityPoint, EquityPoint as EquityPointType, WFAWindow } from "@kiploks/engine-contracts";
import { KiploksValidationError } from "@kiploks/engine-contracts";
import { analyzeFromWindows } from "@kiploks/engine-core";

type UnknownJson = unknown;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null;
}

function buildConfig(seed?: number, decimals?: number, permutationN?: number): AnalyzeConfig {
  return {
    ...(typeof seed === "number" && !Number.isNaN(seed) ? { seed } : {}),
    ...(typeof decimals === "number" && !Number.isNaN(decimals) ? { decimals } : {}),
    ...(typeof permutationN === "number" && !Number.isNaN(permutationN) ? { permutationN } : {}),
  };
}

type AnalyzeWindowsCliArgs = {
  inputPath: string;
  json: boolean;
  seed?: number;
  decimals?: number;
  permutationN?: number;
};

function extractWindowsInput(payload: UnknownJson): { windows: WFAWindow[]; equityCurve?: EquityPointType[] } {
  if (Array.isArray(payload)) {
    return { windows: payload as WFAWindow[] };
  }
  if (!isRecord(payload)) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      "analyze-windows expects either a JSON array of windows or an object with a 'windows' field",
    );
  }

  const windows = (payload.windows ?? payload.wfaWindows ?? payload.WFAWindows) as unknown;
  const equityCurve = (payload.equityCurve ?? payload.equity_curve) as unknown;

  if (!Array.isArray(windows)) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      "analyze-windows input object must include a 'windows' array",
    );
  }

  const out: { windows: WFAWindow[]; equityCurve?: EquityPointType[] } = {
    windows: windows as WFAWindow[],
  };

  if (Array.isArray(equityCurve)) {
    out.equityCurve = equityCurve as EquityPointType[];
  }
  return out;
}

async function readInputJson(inputPath: string): Promise<UnknownJson> {
  const abs = path.resolve(process.cwd(), inputPath);
  const fileContent = await readFile(abs, "utf8");
  return JSON.parse(fileContent) as UnknownJson;
}

function formatHuman(out: WFAAnalysisOutput): string {
  return [
    `WFA robustnessScore: ${out.robustnessScore ?? "n/a"}`,
    `WFE verdict: ${out.wfe?.verdict ?? "n/a"}`,
    `- totalTrades: ${out.summary.totalTrades}`,
  ].join("\n");
}

export async function runAnalyzeWindows(args: AnalyzeWindowsCliArgs): Promise<void> {
  const payload = await readInputJson(args.inputPath);
  const { windows, equityCurve } = extractWindowsInput(payload);

  const input: PrecomputedWFAInput = {
    windows,
    wfaInputMode: "precomputed",
    equityCurve,
  };

  if (input.windows.length < 2) {
    throw new KiploksValidationError(
      "INSUFFICIENT_WINDOWS_FROM_TRADES",
      `INSUFFICIENT_WINDOWS_FROM_TRADES: analyzeFromWindows requires at least 2 windows; got ${input.windows.length}`,
    );
  }

  const config = buildConfig(args.seed, args.decimals, args.permutationN);
  const output = analyzeFromWindows(input, config);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }
  process.stdout.write(formatHuman(output));
  process.stdout.write("\n");
}

export type { AnalyzeWindowsCliArgs };

