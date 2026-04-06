# Minimal `analyze()` example

This example runs the deterministic Open Core `analyze()` pipeline from `@kiploks/engine-core`.

## TypeScript

```ts
import { analyze } from "@kiploks/engine-core";

const result = analyze(
  {
    trades: [{ profit: 0.05 }, { profit: -0.02 }, { profit: 0.08 }],
  },
  { seed: 42, decimals: 8 },
);

console.log(result.summary.netProfit);
```

`profit` is a decimal fraction of capital (e.g. `0.05` means +5%). Time fields are optional for `analyze()`.

## CLI (optional)

Create `input.json`:

```json
{
  "trades": [{ "profit": 0.05 }, { "profit": -0.02 }, { "profit": 0.08 }]
}
```

Run:

```bash
kiploks analyze ./input.json --json --seed 42 --decimals 8
```

