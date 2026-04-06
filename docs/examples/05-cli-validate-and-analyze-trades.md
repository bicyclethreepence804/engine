# CLI: validate trade-based WFA JSON, then `analyze-trades`

## 1) Canonical `trade-based-wfa` shape

Save as `trade-based-wfa.json`:

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

Validate:

```bash
kiploks validate trade-based-wfa.json --schema trade-based-wfa --explain
```

## 2) Raw trades array

Save `trades.json` as a **array** of trades (same objects as `trades` above). Run:

```bash
kiploks analyze-trades trades.json --format raw --json \
  --in-sample-months 2 --out-of-sample-months 1 --step rolling
```

## 3) Auto format

`--format auto` uses **CSV** when the path ends with `.csv`, otherwise loads JSON and expects a **top-level array** of trades (same fields as above). Nested bot export JSON is not supported in-tree; convert to `Trade[]` or CSV first.

```bash
kiploks analyze-trades trades.json --format auto --show-detected-format --json \
  --in-sample-months 3 --out-of-sample-months 1 --step rolling
```

Optional `permutationN` (100..10000) matches `AnalyzeConfig` for WFE permutation draws.
