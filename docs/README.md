# Kiploks Open Core documentation

Authoritative copies of engine-focused guides live **in this folder** so they ship with this **engine** repository (public OSS root). Pre-release steps (including docs vs contracts) are in root [`RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md); versioning and publish notes are in [`OSS_PUBLIC_REPO_SYNC.md`](OSS_PUBLIC_REPO_SYNC.md).

**Start here:** [`ENTRYPOINTS.md`](ENTRYPOINTS.md) — input/output map and entrypoint choice (includes a text fallback if Mermaid does not render).

**Package names vs directories** npm packages use scoped names such as `@kiploks/engine-core`, `@kiploks/engine-contracts`. In this repo they live under **`packages/core/`**, **`packages/contracts/`**, **`packages/cli/`** (not `engine-core/` as a folder name).

## Guides

| Document | Description |
| -------- | ----------- |
| [`ENTRYPOINTS.md`](ENTRYPOINTS.md) | **Start here:** which entrypoint to call, inputs/outputs, `mapPayloadToUnified` warning, CSV vs stream |
| [`OPEN_CORE_INTEGRATION_PRINCIPLES.md`](OPEN_CORE_INTEGRATION_PRINCIPLES.md) | Why there is no `runEverything()`, `BlockResult` design |
| [`examples-map-payload-to-unified.md`](examples-map-payload-to-unified.md) | `mapPayloadToUnified` and CSV-first workflows |
| [`OPEN_CORE_LOCAL_USER_GUIDE.md`](OPEN_CORE_LOCAL_USER_GUIDE.md) | Install, first `analyze()`, CLI, conformance, optional cloud upload |
| [`OPEN_CORE_METHODOLOGY.md`](OPEN_CORE_METHODOLOGY.md) | Scope, determinism, validation model |
| [`OPEN_CORE_REPRODUCIBILITY.md`](OPEN_CORE_REPRODUCIBILITY.md) | Hashes, versions, CI gates |
| [`WFA_PROFESSIONAL.md`](WFA_PROFESSIONAL.md) | Professional WFA / WFE methodology |
| [`ERROR_CATALOG.md`](ERROR_CATALOG.md) | Engine warnings and error codes |
| [`OSS_PUBLIC_REPO_SYNC.md`](OSS_PUBLIC_REPO_SYNC.md) | Repository layout, one `VERSION`, `sync-versions`, publish notes |
| [`RELEASE_CHECKLIST.md`](../RELEASE_CHECKLIST.md) | Pre-release checks (tests, docs vs contracts) |
| [`BOT_INTEGRATIONS.md`](BOT_INTEGRATIONS.md) | Freqtrade / OctoBot Python integrations (optional path without npm engine) |

## TODO

- **`monteCarloValidation`:** Current engine behavior is **bootstrap** over per-window OOS returns (see [`WFA_PROFESSIONAL.md`](WFA_PROFESSIONAL.md) §5). **Planned:** full Monte Carlo validation (design and versioning TBD). Repository root [`README.md`](../README.md) lists the same item.

## Examples

See [`examples/README.md`](examples/README.md) (Markdown how-tos, [`result-layout-demo.html`](examples/result-layout-demo.html), and `sample-output/` JSON). For the methodology-style block chain (DQG through Final Verdict) mapped to engine source, see [`examples/10-methodology-flow-and-engine.md`](examples/10-methodology-flow-and-engine.md).
