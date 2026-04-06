# WFA from trades (`analyzeFromTrades`)

This example shows how to compute public WFA blocks using `analyzeFromTrades()` and the canonical `WFAAnalysisOutput`.

Key points:
- `wfaInputMode` is required and must be `tradeSlicedPseudoWfa`.
- For `analyzeFromTrades()`, each trade must include `openTime` and `closeTime` (unix ms).
- `parameterStability` and `benchmark` may be unavailable, and that is represented explicitly in the output via `available: false`.

## TypeScript (synthetic trades)

```ts
import { analyzeFromTrades } from "@kiploks/engine-core";
import type { TradeBasedWFAInput } from "@kiploks/engine-contracts";

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

const input: TradeBasedWFAInput = {
  trades,
  windowConfig: {
    inSampleMonths: 2,
    outOfSampleMonths: 1,
    stepMode: "rolling",
  },
  wfaInputMode: "tradeSlicedPseudoWfa",
};

const result = analyzeFromTrades(input, { seed: 42, decimals: 8, permutationN: 1000 });

console.log("robustnessScore:", result.robustnessScore);
console.log("consistencyVerdict:", result.consistency.verdict);
console.log("wfe rankWfe:", result.wfe.rankWfe, "p:", result.wfe.permutationPValue, "n:", result.wfe.permutationN);

if (!result.parameterStability.available) {
  console.log("parameterStability unavailable:", result.parameterStability.reason);
}
if (!result.benchmark.available) {
  console.log("benchmark unavailable:", result.benchmark.reason);
}
```

Optional `permutationN` on the analyze options (and on `AnalyzeConfig` when using the full contract) controls how many OOS shuffles are used for the WFE permutation p-value (default 1000, bounds 100..10000).

## CLI (using a canonical engine input shape)

Prepare two files:

1) `trade-based-wfa.json` - the canonical engine input shape (for `validate`)

```json
{
  "trades": [
    { "profit": 0.01, "openTime": 1578182400000, "closeTime": 1578528000000 },
    { "profit": -0.02, "openTime": 1578969600000, "closeTime": 1579442400000 },
    { "profit": 0.03, "openTime": 1580342400000, "closeTime": 1580815200000 }
  ],
  "windowConfig": {
    "inSampleMonths": 2,
    "outOfSampleMonths": 1,
    "stepMode": "rolling"
  },
  "wfaInputMode": "tradeSlicedPseudoWfa"
}
```

2) `trades-array.json` - raw trades array (for `analyze-trades`)

```json
[
  { "profit": 0.01, "openTime": 1578182400000, "closeTime": 1578528000000 },
  { "profit": -0.02, "openTime": 1578969600000, "closeTime": 1579442400000 },
  { "profit": 0.03, "openTime": 1580342400000, "closeTime": 1580815200000 }
]
```

Validate the canonical contract:

```bash
kiploks validate trade-based-wfa.json --schema trade-based-wfa --explain
```

Then run:

```bash
kiploks analyze-trades trades-array.json --format raw --json \
  --in-sample-months 2 --out-of-sample-months 1 --step rolling
```

> Note: `analyze-trades --format auto` accepts a **JSON array** of trades or a `.csv` file. Bot-specific JSON objects are not parsed in-tree; convert to `Trade[]` or CSV first.

