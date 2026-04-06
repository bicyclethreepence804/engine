import { describe, expect, it } from "vitest";

import { analyzeFromWindows } from "@kiploks/engine-core";

import type { PrecomputedWFAInput, WFAWindow, AnalyzeConfig } from "@kiploks/engine-contracts";

import { runAnalyzeWindows } from "./analyze-windows";

import fs from "node:fs";
import path from "node:path";

const ANALYZE_CONFIG: AnalyzeConfig = { seed: 42, decimals: 8 };

function tmpJsonFile(name: string, obj: unknown): string {
  const dir = path.resolve(__dirname, ".tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const p = path.resolve(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj), "utf8");
  return p;
}

describe("kiploks analyze-windows", () => {
  it("runs analyzeFromWindows on valid precomputed input", async () => {
    const windows: WFAWindow[] = [
      {
        period: { start: "2020-01-01T00:00:00.000Z", end: "2020-04-01T00:00:00.000Z" },
        inSample: { return: 0.12 },
        outOfSample: { return: 0.08 },
      },
      {
        period: { start: "2020-04-01T00:00:00.000Z", end: "2020-07-01T00:00:00.000Z" },
        inSample: { return: 0.1 },
        outOfSample: { return: 0.06 },
      },
    ];

    const payload = { windows };
    const filePath = tmpJsonFile("windows-ok.json", payload);

    const input: PrecomputedWFAInput = { windows, wfaInputMode: "precomputed" };
    const out = analyzeFromWindows(input, ANALYZE_CONFIG);
    expect(out.wfe).toBeDefined();

    await runAnalyzeWindows({
      inputPath: filePath,
      json: true,
      seed: 42,
      decimals: 8,
    });
  });

  it("throws when fewer than 2 windows", async () => {
    const windows: WFAWindow[] = [
      {
        period: { start: "2020-01-01T00:00:00.000Z", end: "2020-04-01T00:00:00.000Z" },
        inSample: { return: 0.12 },
        outOfSample: { return: 0.08 },
      },
    ];

    const payload = { windows };
    const filePath = tmpJsonFile("windows-bad.json", payload);

    await expect(
      runAnalyzeWindows({
        inputPath: filePath,
        json: true,
        seed: 42,
        decimals: 8,
      }),
    ).rejects.toThrow(/INSUFFICIENT_WINDOWS_FROM_TRADES/);
  });
});

