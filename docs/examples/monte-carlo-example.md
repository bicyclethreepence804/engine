# Example: path-based Monte Carlo (`buildPathMonteCarloSimulation`)

English comments only. Requires `@kiploks/engine-core` (same version as your contracts package).

## Toy equity curve

Rising equity from 100 to 119 over 20 daily timestamps (19 period returns). Enough points for default `minPeriods` if you lower it for demos, or add more points for production defaults.

## Code

```ts
import { buildPathMonteCarloSimulation } from "@kiploks/engine-core";

const DAY_MS = 24 * 60 * 60 * 1000;
const equityPoints = Array.from({ length: 20 }, (_, i) => ({
  value: 100 + i,
  timestamp: i * DAY_MS,
}));

const block = buildPathMonteCarloSimulation(equityPoints, {
  seed: 42,
  simulations: 2_000,
  minPeriods: 10,
  horizonYears: 1,
});

if (block === null) {
  console.log("Path MC unavailable (too short, flat, or invalid input)");
} else {
  console.log("Median CAGR (decimal):", block.cagrDistribution.p50);
  console.log("P5 / P95 CAGR:", block.cagrDistribution.p5, block.cagrDistribution.p95);
  console.log("Median max drawdown (decimal, negative):", block.maxDrawdownDistribution.p50);
  console.log("P(positive CAGR):", block.probabilityPositive);
  console.log("Path stability / tail risk:", block.pathStability, block.tailRisk);
  console.log("Method version:", block.meta.methodVersion);
  block.interpretation.forEach((line) => console.log("-", line));
}
```

## Reading the labels

- **`pathStability`:** How tight simulated outcomes are around the median (engine thresholds in `pathMonteCarloConstants.ts`).
- **`tailRisk`:** Stress on the left tail of the simulated CAGR distribution.
- **`interpretation`:** Human-readable bullets; the last bullets stress bootstrap limits and cross-checking with WFA-style evidence where applicable.

## Golden regression fixture

CI locks a subset of output in [`monte-carlo-seed42.json`](./monte-carlo-seed42.json). Regenerate from repo root after intentional algorithm changes:

```bash
npm run build
npm run engine:examples:generate-monte-carlo-fixture
```

Then bump `PATH_MONTE_CARLO_METHOD_VERSION` and record the change in `CHANGELOG.md`.
