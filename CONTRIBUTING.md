# Contributing (Open Core engine)

Thank you for contributing to the Kiploks engine packages (`@kiploks/engine-*`).

## License

By contributing, you agree your contributions are licensed under the same terms as this repository. See [`LICENSE`](LICENSE) (Apache License 2.0). Brand and trademark expectations: [`TRADEMARK.md`](TRADEMARK.md).

## Repository

This repository **is** the public Open Core root (npm scope `@kiploks/engine-*`). Work is pushed and tagged **here**; there is no separate git subtree step.

### Layout (repository root)

```text
VERSION                 # single semver for all @kiploks/engine-* packages
LICENSE
README.md
CHANGELOG.md
CONTRIBUTING.md
SECURITY.md
CODE_OF_CONDUCT.md
vitest.config.ts
package.json            # private workspace root (not published)
scripts/                # prepack, version sync, boundary/bundle checks
packages/
  contracts/
  core/
  adapters/
  cli/
  test-vectors/
docs/                   # guides and examples (see docs/README.md)
```

## Checks before a PR or release

From this folder (repository root):

```bash
npm install
npm run build
npm run engine:validate
```

**Releases:** follow **[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)** (tests, doc JSON vs contracts, version sync).

**Integrators:** start with **[`docs/ENTRYPOINTS.md`](docs/ENTRYPOINTS.md)** (which API to call and what inputs are required).


## Version policy

All publishable `@kiploks/engine-*` packages share **one** semver, stored in [`VERSION`](VERSION). After bumping it, run from this directory:

```bash
npm run sync-versions
```

Then commit the updated `package.json` files together with `VERSION`.

## Changing formulas, contracts, or hashes

Methodology changes must be explicit:

- **Formula behavior** - changelog entry and updated conformance vectors where behavior changes.
- **Contract-breaking API** - **major** semver bump for the shared engine release.
- **Canonical or hash policy** - metadata refresh (see [`packages/test-vectors/CONFORMANCE.md`](packages/test-vectors/CONFORMANCE.md)) and migration notes in the changelog.

## Code style

- English for code comments and user-facing docs in this tree.
- Prefer changes in `contracts` for type/version changes, `core` for numerical logic.

## Security

See [`SECURITY.md`](SECURITY.md).
