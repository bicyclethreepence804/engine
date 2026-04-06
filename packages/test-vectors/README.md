# @kiploks/engine-test-vectors

**Repository:** [github.com/kiploks/engine](https://github.com/kiploks/engine)

Golden **JSON fixtures** for **[Kiploks](https://kiploks.com)** Open Core: **conformance** and **regression** tests for `analyze()` and core pure functions (risk, benchmark, turnover). Consumers of `@kiploks/engine-core` normally do not need this package unless you replicate our test suite.

**Keywords** trading engine golden tests, backtest fixture data, deterministic regression vectors, WFA test data.

## Install

```bash
npm install @kiploks/engine-test-vectors
```

## Package contents

- `v1/*` - Analyze pipeline vectors with locked input/config hashes
- `v2/*` - Extended goldens (risk, benchmark, turnover blocks)
- `CONFORMANCE.md` - Policy and when to refresh metadata

## License

Apache-2.0 (`LICENSE` in this package).

## Trademarks

See [TRADEMARK.md](https://github.com/kiploks/engine/blob/main/TRADEMARK.md) in the repository root.
