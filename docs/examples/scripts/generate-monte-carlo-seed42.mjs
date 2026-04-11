/**
 * Writes ../monte-carlo-seed42.json for pathMonteCarlo.test.ts §8.6.
 * Run from engine repo root: npm run engine:examples:generate-monte-carlo-fixture
 * Requires: npm run build (core dist must exist).
 * After regenerating: bump PATH_MONTE_CARLO_METHOD_VERSION if the algorithm changed; update CHANGELOG.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildPathMonteCarloSimulation } = require(join(__dirname, "../../../packages/core/dist/index.js"));

const DAY_MS = 24 * 60 * 60 * 1000;
const pts = [];
for (let v = 100; v < 200; v++) {
  pts.push({ value: v, timestamp: (v - 100) * DAY_MS });
}
const options = { seed: 42, simulations: 1000, minPeriods: 10, horizonYears: 1 };
const r = buildPathMonteCarloSimulation(pts, options);
if (!r) {
  throw new Error("buildPathMonteCarloSimulation returned null for golden input");
}
const doc = {
  description:
    "Golden fixture for packages/core/src/pathMonteCarlo.test.ts §8.6. Regenerate via npm run engine:examples:generate-monte-carlo-fixture after algorithm changes; bump PATH_MONTE_CARLO_METHOD_VERSION and CHANGELOG.",
  input: { equityPoints: pts, options },
  expected: {
    cagrDistribution: { p50: r.cagrDistribution.p50 },
    meta: { simulationsRun: r.meta.simulationsRun },
  },
};
const outPath = join(__dirname, "../monte-carlo-seed42.json");
writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log("Wrote", outPath, doc.expected);
