# Open Core methodology

This page describes methodology principles for the public Kiploks Open Core engine.

## Scope

Open Core includes deterministic analytics computation:

- canonical input processing
- versioned formulas
- reproducible summary outputs
- conformance vectors for regression control

Cloud and product orchestration are out of scope for this page.

## Single source of truth

- Formula logic should live in `engine/packages/core`.
- Integration hosts should call Open Core functions instead of duplicating math.
- Clients should render server-provided payloads and avoid recomputing final analytical verdicts on the client.

## Determinism policy

For the same normalized input and config:

- output summary must be stable
- metadata hashes must be stable
- conformance fixtures must pass unchanged

Determinism depends on:

- canonical serialization
- explicit decimals policy
- explicit seed defaults
- versioned contracts and formula metadata

## Validation model

Open Core uses layered validation:

1. Unit tests for pure helpers in `engine/packages/core/src/*.test.ts`
2. Conformance vectors:
   - `v1` for `analyze()`
   - `v2` for risk/benchmark/turnover golden fixtures
3. Boundary check: no cloud-side imports in Open Core packages
4. Bundle safety check: npm artifact must contain only public Open Core code

Run all checks with:

```bash
npm run engine:validate
```

## Versioning and change impact

Releases are **semver-versioned** together across `@kiploks/engine-*` packages. When you upgrade, read [`CHANGELOG.md`](../CHANGELOG.md) and align your integration with `engineVersion` / `contractVersion` in outputs.

If you **change** formulas, contracts, or hash policy in this repo (contributors and maintainers), follow the checklist in [`CONTRIBUTING.md`](../CONTRIBUTING.md#changing-formulas-contracts-or-hashes).

## Related docs

- [`packages/test-vectors/CONFORMANCE.md`](../packages/test-vectors/CONFORMANCE.md)
- [`OPEN_CORE_REPRODUCIBILITY.md`](OPEN_CORE_REPRODUCIBILITY.md)
- [`OPEN_CORE_LOCAL_USER_GUIDE.md`](OPEN_CORE_LOCAL_USER_GUIDE.md)
- [`CHANGELOG.md`](../CHANGELOG.md)
