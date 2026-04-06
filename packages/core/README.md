# @kiploks/engine-core

**Repository:** [github.com/kiploks/engine](https://github.com/kiploks/engine)

Deterministic **trading analytics engine** for **[Kiploks](https://kiploks.com)** Open Core: `analyze()`, walk-forward and professional-grade paths, benchmark and turnover logic, and types aligned with hosted Kiploks reports and integrations.

**Use cases** algorithmic trading research, **walk-forward analysis (WFA)**, backtest validation, risk and benchmark metrics in **TypeScript**, reproducible local pipelines.

## Install

```bash
npm install @kiploks/engine-core @kiploks/engine-contracts
```

## Quick example

```ts
import { analyze } from "@kiploks/engine-core";

const out = analyze(
  { strategyId: "demo", trades: [{ profit: 1.25 }, { profit: -0.4 }] },
  { seed: 42, decimals: 8 },
);

console.log(out.summary, out.metadata);
```

## Philosophy

Results are **deterministic** for a given input, config, and published version. The hosted product at [kiploks.com](https://kiploks.com) builds full reports and workflows on the same methodological stack; this package is the **embeddable core** for integrators and researchers.

## API policy

- **Stable (semver)** import from `@kiploks/engine-core` (root). The published package exposes this entry only.
- The repository includes a secondary `./internal` barrel (re-exports used by full-report assembly). It is **not** part of the npm tarball (`prepack` strips it). Prefer the root import unless you maintain a host that mirrors that assembly graph.

## License

Apache-2.0 (`LICENSE` in this package).

## Trademarks

The **Kiploks** name is a product trademark. Using this package does not grant rights to use the brand in a misleading way. See the repository root [`TRADEMARK.md`](https://github.com/kiploks/engine/blob/main/TRADEMARK.md).
