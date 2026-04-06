/**
 * Regenerates JSON under ../sample-output/ from the built @kiploks/engine-core.
 * Run from the engine repository root: npm run engine:examples:generate-samples
 * Requires: npm run build (core dist must exist).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { analyze, analyzeFromTrades } = require(join(__dirname, "../../../packages/core/dist/index.js"));

const outDir = join(__dirname, "../sample-output");
mkdirSync(outDir, { recursive: true });

const minimal = analyze(
  { trades: [{ profit: 0.05 }, { profit: -0.02 }, { profit: 0.08 }] },
  { seed: 42, decimals: 8 },
);
writeFileSync(join(outDir, "minimal-analyze.json"), `${JSON.stringify(minimal, null, 2)}\n`);

const DAY_MS = 24 * 60 * 60 * 1000;
const base = Date.UTC(2020, 0, 1);
const trades = [
  { profit: 0.01, openTime: base + 5 * DAY_MS, closeTime: base + 20 * DAY_MS },
  { profit: -0.02, openTime: base + 35 * DAY_MS, closeTime: base + 55 * DAY_MS },
  { profit: 0.03, openTime: base + 80 * DAY_MS, closeTime: base + 105 * DAY_MS },
  { profit: 0.02, openTime: base + 140 * DAY_MS, closeTime: base + 165 * DAY_MS },
  { profit: -0.01, openTime: base + 210 * DAY_MS, closeTime: base + 235 * DAY_MS },
  { profit: 0.015, openTime: base + 270 * DAY_MS, closeTime: base + 295 * DAY_MS },
];

const wfa = analyzeFromTrades(
  {
    trades,
    windowConfig: { inSampleMonths: 2, outOfSampleMonths: 1, stepMode: "rolling" },
    wfaInputMode: "tradeSlicedPseudoWfa",
  },
  { seed: 42, decimals: 8, permutationN: 1000 },
);
writeFileSync(join(outDir, "wfa-from-trades.json"), `${JSON.stringify(wfa, null, 2)}\n`);

console.log("Wrote:", join(outDir, "minimal-analyze.json"));
console.log("Wrote:", join(outDir, "wfa-from-trades.json"));
