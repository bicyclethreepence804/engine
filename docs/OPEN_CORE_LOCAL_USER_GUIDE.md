# Open Core: local setup for users

This guide explains how to run the **Kiploks Open Core engine** on your machine: the deterministic `analyze()` pipeline, the `kiploks` CLI, and optional conformance checks. Scope is **this repository and published packages** only.

## 5-minute quick start

If you only need the first successful `analyze()` call:

```bash
mkdir my-kiploks-run && cd my-kiploks-run
npm init -y
npm install @kiploks/engine-core @kiploks/engine-contracts
node -e "const { analyze } = require('@kiploks/engine-core'); console.log(analyze({strategyId:'demo',trades:[{profit:1.2},{profit:-0.4}]},{seed:42,decimals:8}).summary)"
```

Then continue with Option 1 or Option 2 sections for CLI/conformance/upload.

You can work in two ways:

1. **Clone from Git** - full source, best for contributors and for running `test-conformance` and the full engine test suite.
2. **Install from npm** - intended for integrators (CI or custom glue code) once packages are published; smaller footprint, fewer dev commands.

---

## Prerequisites

- **Node.js** 20.x or newer (LTS recommended). Check with `node -v`.
- **npm** 9+ (comes with Node). Check with `npm -v`.
- A shell where you can run `bash`-style commands (macOS, Linux, or Windows with Git Bash or WSL).

Optional:

- **Git**, if you clone the repository.
- **tsx** may be a dev dependency when developing this repo; the npm-only path assumes published `dist/` artifacts inside packages (no `tsx` required for end users after publish).

---

## Option 1: Clone from Git (recommended for development and full validation)

Use this when you want the complete engine source, golden vectors, and scripts that match CI.

### 1.1 Get the repository

Clone the **engine** repository (public Open Core root):

```bash
git clone https://github.com/kiploks/engine.git
cd engine
```

### 1.2 Install dependencies

From the **repository root** (where the root `package.json` lives):

```bash
npm ci
```

Use `npm install` only if you do not rely on a lockfile (not recommended for reproducible builds).

### 1.3 Build published-style engine libraries (optional but recommended)

Consumers and local scripts typically expect compiled `dist/` for `@kiploks/engine-contracts` and `@kiploks/engine-core`:

```bash
npm run build
```

### 1.4 Run the analyzer on a JSON file

Create a file `input.json` with a minimal `AnalyzeInput` shape:

```json
{
  "strategyId": "demo",
  "trades": [{ "profit": 10.5 }, { "profit": -2.2 }]
}
```

Run analysis (machine-readable output):

```bash
npx tsx cli/src/index.ts analyze ./input.json --json
```

Or after `npm link` / local install of the CLI package, use the `kiploks` binary.

On Windows, use the same paths; prefer forward slashes or quoted paths if your directory names contain spaces.

### 1.5 Run the full engine validation suite (optional)

This runs Vitest for this workspace, plus boundary and npm bundle safety checks:

```bash
npm run engine:validate
```

Or via the CLI helper (must be run **from the engine repository root** so it can find `vitest.config.ts` and `engine:validate`):

```bash
npm run engine:test-conformance
```

### 1.6 Optional: cloud upload from CLI

If you have a Kiploks integration API key and a standalone result payload:

```bash
export KIPLOKS_API_BASE=https://kiploks.com
export KIPLOKS_API_KEY=your_integration_key
npx tsx cli/src/index.ts upload ./result.json --cloud --dry-run
```

Remove `--dry-run` only when you intend to POST for real. See `cli/README.md` for `--local-analyze` and parity options.

---

## Option 2: Install from npm (integrators, minimal install)

Use this when official packages are published to the npm registry under scopes such as `@kiploks/engine-cli`, `@kiploks/engine-core`, and `@kiploks/engine-contracts`. **Publishing and public registry names are part of your release process**; until then, prefer Option 1.

Pin the **same** semver line for all `@kiploks/engine-*` packages you install.

### 2.1 Create a project directory

```bash
mkdir my-kiploks-run && cd my-kiploks-run
npm init -y
```

### 2.2 Install the CLI and engine packages

Pin versions to the same release line (example versions only):

```bash
npm install @kiploks/engine-cli@^0.2.0 @kiploks/engine-core@^0.2.0 @kiploks/engine-contracts@^0.2.0
```

If the CLI declares `peerDependencies`, install those versions as shown by `npm install` warnings.

### 2.3 Run `analyze` without a monorepo

After publish, the `kiploks` binary should be available via `npx`:

```bash
npx kiploks analyze ./input.json --json
```

Or add an npm script in your `package.json`:

```json
{
  "scripts": {
    "analyze": "kiploks analyze ./input.json --json"
  }
}
```

### 2.4 Conformance and tests from npm-only installs

- **`kiploks test-conformance`** is designed to discover a checkout whose root has `vitest.config.ts` or `vitest.engine.config.ts` and the `engine:validate` npm script. It will **not** replace a full clone for running the golden vector suite if you only installed packages from the registry.
- To verify published bits as a consumer, rely on the **version** you installed and optional upstream CI badges or release notes. To run the full suite locally, use **Option 1** (clone).

### 2.5 Programmatic use (TypeScript or JavaScript)

```ts
import { analyze } from "@kiploks/engine-core";
import type { AnalyzeInput } from "@kiploks/engine-contracts";

const input: AnalyzeInput = {
  strategyId: "demo",
  trades: [{ profit: 1 }],
};

const out = analyze(input, { seed: 42, decimals: 8 });
console.log(out.summary, out.metadata);
```

Ensure `moduleResolution` and `target` in `tsconfig.json` match your Node version. Use the package `main`/`types` fields (typically `dist/`) from the published tarball.

---

## Input and output contract

- Input types are defined in **`@kiploks/engine-contracts`** (`AnalyzeInput`, `AnalyzeConfig`, `AnalyzeOutput`).
- Outputs include reproducibility fields: `inputHash`, `configHash`, `engineVersion`, `formulaVersion`, `riskAnalysisVersion`, `contractVersion`, `seed`, `decimals`.
- Use **`@kiploks/engine-core`** as the public, semver-stable API (root import from the published package).

A **full** analysis report (`TestResultData`) with every block (WFA, turnover, benchmark, verdict, and so on) is assembled by **hosting-side** pipelines that consume unified payloads. Most of the underlying math still lives in **`@kiploks/engine-core`**; the CLI `analyze` path is a smaller, reproducible surface. Details of how a host wires I/O and assembly are **outside** this repository.

See also [`packages/test-vectors/CONFORMANCE.md`](../packages/test-vectors/CONFORMANCE.md) for how golden JSON vectors are maintained.

---

## Troubleshooting

| Issue | What to try |
| ----- | ----------- |
| `Cannot find module '@kiploks/engine-core'` | Run `npm install` from the directory that contains your `package.json`; ensure workspaces are not required for a standalone project. |
| Workspace cannot resolve `@kiploks/engine-*` | Ensure `npm run build` was run in this repo so `dist/` exists, or pin published versions from npm. |
| CLI not found after npm install | Use `npx kiploks` or `./node_modules/.bin/kiploks`. |
| `test-conformance` says it cannot find monorepo root | Run it from the **git clone root** (Option 1), or use `npm run engine:validate` there. |
| Wrong numbers vs cloud | Align **engine package version** with the server; compare `metadata` hashes and `engineVersion` in the API response. |

---

## License

Engine packages follow the license shipped in the repository or npm tarball (see root `LICENSE` or package metadata). Using the CLI against the hosted API is subject to the product terms and your API key scope.
