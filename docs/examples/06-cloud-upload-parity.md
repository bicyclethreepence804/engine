# Cloud upload with local engine parity (`kiploks upload`)

Compare **local** `analyze()` output with what the server runs on `oos_trades` by attaching a prior CLI JSON.

## 1) Produce local analyze JSON

```bash
kiploks analyze ./minimal-input.json --json --seed 42 --decimals 8 > local-analyze.json
```

## 2) Upload standalone result with parity

```bash
export KIPLOKS_API_BASE=https://kiploks.com
export KIPLOKS_API_KEY=your_integration_key

kiploks upload ./standalone-result.json --cloud --local-analyze ./local-analyze.json
```

Use `--dry-run` first to inspect the planned POST. The response includes per-result **parity** fields when the server supports them.

See `engine/packages/cli/README.md` for `--skip-status`, `--api-base-url`, and environment variable details.
