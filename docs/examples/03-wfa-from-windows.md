# WFA from precomputed windows (`analyzeFromWindows`)

If you already have WFA windows (for example, coming from `sliceTradesIntoWindows` or from your own slicing pipeline), you can run the public WFA entrypoint `analyzeFromWindows()`.

Key points:
- `PrecomputedWFAInput.wfaInputMode` must be `precomputed`.
- `input.windows.length` must be at least 2.
- `benchmark` block is available only when `equityCurve` is provided.

## TypeScript (synthetic windows)

```ts
import { analyzeFromWindows } from "@kiploks/engine-core";
import type { PrecomputedWFAInput } from "@kiploks/engine-contracts";

const input: PrecomputedWFAInput = {
  wfaInputMode: "precomputed",
  equityCurve: [
    { timestamp: 1577836800000, value: 10000 },
    { timestamp: 1580515200000, value: 10300 },
    { timestamp: 1583020800000, value: 10150 },
  ],
  windows: [
    {
      period: { start: "2020-01-01T00:00:00.000Z", end: "2020-03-01T00:00:00.000Z" },
      inSample: { return: 0.02 },
      outOfSample: { return: -0.01 },
    },
    {
      period: { start: "2020-02-01T00:00:00.000Z", end: "2020-04-01T00:00:00.000Z" },
      inSample: { return: 0.01 },
      outOfSample: { return: 0.015 },
    },
  ],
};

const result = analyzeFromWindows(input, { seed: 42, decimals: 8, permutationN: 1000 });

console.log("robustnessScore:", result.robustnessScore);
console.log("consistencyVerdict:", result.consistency.verdict);
console.log("wfe rankWfe:", result.wfe.rankWfe, "p:", result.wfe.permutationPValue, "n:", result.wfe.permutationN);

if (!result.benchmark.available) {
  console.log("benchmark unavailable:", result.benchmark.reason);
}
```

## Notes

The `period.start` / `period.end` fields are ISO-8601 strings (UTC recommended).
If you omit `equityCurve`, the engine still produces `wfe` / `consistency`, but the `benchmark` block becomes unavailable with an explicit `available: false` reason.

Optional `permutationN` on analyze options sets the permutation count for `wfe.permutationPValue` (default 1000, bounds 100..10000).

