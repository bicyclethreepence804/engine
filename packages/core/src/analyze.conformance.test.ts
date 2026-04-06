/**
 * v1 analyze vectors: see test-vectors/CONFORMANCE.md; refresh metadata via `npm run engine:vectors:refresh-metadata` from the engine repository root.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalyzeConfig, AnalyzeInput } from "@kiploks/engine-contracts";
import { analyze } from "./analyze";
import { resolveEngineTestVectorsRoot } from "./testPaths";

type ConformanceVector = {
  name: string;
  input: AnalyzeInput;
  config: AnalyzeConfig;
  expected: {
    summary: {
      totalTrades: number;
      netProfit: number;
      avgTradeProfit: number;
    };
    /** When set, locks canonical hash regression for this vector (engine decimals/seed policy). */
    metadata?: {
      inputHash: string;
      configHash: string;
    };
  };
};

async function loadVectors(): Promise<ConformanceVector[]> {
  const vectorsDir = path.join(resolveEngineTestVectorsRoot(), "v1");
  const entries = await readdir(vectorsDir);
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));

  return Promise.all(
    jsonFiles.map(async (fileName) => {
      const content = await readFile(path.join(vectorsDir, fileName), "utf8");
      return JSON.parse(content) as ConformanceVector;
    }),
  );
}

describe("Conformance vectors", () => {
  it("matches expected summaries for all vectors", async () => {
    const vectors = await loadVectors();

    for (const vector of vectors) {
      const result = analyze(vector.input, vector.config);
      // Canonicalize -0 to +0 so JSON (+0) fixtures match IEEE -0 sums.
      const summary = {
        ...result.summary,
        netProfit: result.summary.netProfit + 0,
        avgTradeProfit: result.summary.avgTradeProfit + 0,
      };
      expect(summary).toEqual(vector.expected.summary);
      expect(result.metadata.inputHash).toHaveLength(64);
      expect(result.metadata.configHash).toHaveLength(64);
      if (vector.expected.metadata) {
        expect(result.metadata.inputHash, vector.name).toBe(vector.expected.metadata.inputHash);
        expect(result.metadata.configHash, vector.name).toBe(vector.expected.metadata.configHash);
      }
    }
  });
});
