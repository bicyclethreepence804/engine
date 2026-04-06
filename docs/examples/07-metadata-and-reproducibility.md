# Metadata and reproducibility (`analyze()` output)

Every `analyze()` call returns `metadata` you should persist when comparing runs or filing bug reports.

## TypeScript

```ts
import { analyze } from "@kiploks/engine-core";

const { summary, metadata } = analyze(
  { strategyId: "demo", trades: [{ profit: 0.01 }, { profit: -0.005 }] },
  { seed: 42, decimals: 8 },
);

console.log({
  engineVersion: metadata.engineVersion,
  formulaVersion: metadata.formulaVersion,
  riskAnalysisVersion: metadata.riskAnalysisVersion,
  contractVersion: metadata.contractVersion,
  inputHash: metadata.inputHash,
  configHash: metadata.configHash,
  seed: metadata.seed,
  decimals: metadata.decimals,
});
```

## Rules of thumb

- **Same** logical input and config should yield the **same** hashes for a fixed engine version.
- Changing **decimals** or **seed** changes `configHash` and may change outputs.
- After formula or canonicalization changes, refresh **test vectors** (see `packages/test-vectors/CONFORMANCE.md`; run `npm run engine:vectors:refresh-metadata` from the **engine** repository root when that script exists in your checkout).

See [`OPEN_CORE_REPRODUCIBILITY.md`](../OPEN_CORE_REPRODUCIBILITY.md) for CI gates and release checks.
