# Open Core engine: public repository

This repository **is** the public Open Core root (npm scope `@kiploks/engine-*`). Push and tag **this** repo directly; there is no git subtree step.

## Layout (repository root)

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
docs/                   # Open Core guides and examples (see docs/README.md)
```

## One version for all packages

- Source of truth: `VERSION` (one line, e.g. `0.1.0`).
- Run from **this** repository root:

```bash
npm run sync-versions
```

This sets every workspace `package.json` `version` and internal `@kiploks/engine-*` `dependencies` to that exact semver.

After changing `VERSION`, commit, then sync, then rebuild and run checks before publishing.

## Publish workflow (later)

- GitHub Actions on **this** repo (CI, npm publish).
- npm org scope `@kiploks` and access tokens.
- GitHub Release notes and tags (optional).
