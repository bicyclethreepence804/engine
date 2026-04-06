import { readFile } from "node:fs/promises";
import path from "node:path";
import * as engineCore from "@kiploks/engine-core";
import type { AnalyzeConfig, AnalyzeInput } from "@kiploks/engine-contracts";

export type AnalyzeCliArgs = {
  inputPath: string;
  json: boolean;
  seed?: number;
  decimals?: number;
};

export async function readInputJson(inputPath: string): Promise<AnalyzeInput> {
  const abs = path.resolve(process.cwd(), inputPath);
  const fileContent = await readFile(abs, "utf8");
  return JSON.parse(fileContent) as AnalyzeInput;
}

export function buildConfig(seed?: number, decimals?: number): AnalyzeConfig {
  return {
    ...(typeof seed === "number" && !Number.isNaN(seed) ? { seed } : {}),
    ...(typeof decimals === "number" && !Number.isNaN(decimals) ? { decimals } : {}),
  };
}

export async function runAnalyze(args: AnalyzeCliArgs): Promise<void> {
  const input = await readInputJson(args.inputPath);
  const config = buildConfig(args.seed, args.decimals);
  const output = engineCore.analyze(input, config);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return;
  }

  process.stdout.write(
    [
      "Kiploks analyze result",
      `- trades: ${output.summary.totalTrades}`,
      `- netProfit: ${output.summary.netProfit}`,
      `- avgTradeProfit: ${output.summary.avgTradeProfit}`,
      `- inputHash: ${output.metadata.inputHash}`,
      `- configHash: ${output.metadata.configHash}`,
      "",
    ].join("\n"),
  );
}
