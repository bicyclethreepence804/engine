# Open Core reproducibility

This page defines reproducibility guarantees and operational checks for Open Core.

## Reproducible output metadata

`analyze()` output includes metadata fields that must be preserved:

- `engineVersion`
- `formulaVersion`
- `riskAnalysisVersion`
- `contractVersion`
- `inputHash`
- `configHash`
- `seed`
- `decimals`

These fields make local and CI comparisons machine-verifiable.

## Hash and canonical rules

- Hashes are SHA-256 over canonical JSON representation.
- Equivalent logical inputs should produce identical hashes.
- Any canonicalization or hash-policy update requires vector metadata refresh.

Refresh command:

```bash
npm run engine:vectors:refresh-metadata
```

## Conformance fixtures

### v1 (`engine/packages/test-vectors/v1`)

- Locks summary expectations for `analyze()`
- Locks `expected.metadata.inputHash` and `configHash`

### v2 (`engine/packages/test-vectors/v2`)

- Golden fixtures for pure risk/benchmark/turnover functions
- Locks `expected.metadata.fixtureHash` computed from fixture input shape without `expected` blocks

## CI and release checks

Minimum release gate for Open Core changes:

1. `npm run engine:test`
2. `npm run engine:conformance`
3. `npm run engine:check:boundary`
4. `npm run engine:check:bundle`

Combined command:

```bash
npm run engine:validate
```

## When reproducibility is considered broken

- Same input/config yields different summary or metadata hashes
- Conformance vectors fail without intentional formula/version changes
- Published npm bundles differ in executable behavior from validated source

## Related docs

- [`OPEN_CORE_METHODOLOGY.md`](OPEN_CORE_METHODOLOGY.md)
- [`packages/test-vectors/CONFORMANCE.md`](../packages/test-vectors/CONFORMANCE.md)
- [`CHANGELOG.md`](../CHANGELOG.md)
