# Sample engine JSON outputs

Files here are produced by the Open Core engine for the same inputs as in [`01-minimal-analyze.md`](../01-minimal-analyze.md) and [`02-wfa-from-trades.md`](../02-wfa-from-trades.md) (six-trade series).

| File | Source |
| ---- | ------ |
| `minimal-analyze.json` | `analyze()` on three profits (`0.05`, `-0.02`, `0.08`), `seed` 42, `decimals` 8 |
| `wfa-from-trades.json` | `analyzeFromTrades()` on the six-trade example, rolling 2+1 months, `permutationN` 1000 |

## Regenerate

From the engine repository root (after `npm run build`):

```bash
npm run engine:examples:generate-samples
```

If you change formulas or hashing, hashes and numbers will change. After regeneration, update the embedded samples in [`result-layout-demo.html`](../result-layout-demo.html) so the static demo stays in sync (search for `SAMPLE_MINIMAL` / `SAMPLE_WFA`).
