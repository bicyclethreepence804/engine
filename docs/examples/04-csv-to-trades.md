# CSV to `Trade[]`

Backtests often arrive as CSV with a header row. **Open Core** consumes `Trade[]`; mapping column names to fields happens in **your integration** (parse the file and build objects that match the contract).

## Column mapping

- Map each logical field (`profit`, `openTime`, `closeTime`, etc.) to the column header name in your file.
- `openTime` and `closeTime` should be **Unix timestamps in milliseconds** when provided.
- For profit-only CSVs, omit time columns where `analyze()` does not require timestamps.

## CLI path

For `.csv` files from the shell, use `kiploks analyze-trades` with `--format auto` (see `05-cli-validate-and-analyze-trades.md`).

## Next step

Pipe `trades` into `analyze()` from `@kiploks/engine-core`, or into `analyzeFromTrades()` if you also supply `windowConfig` and `wfaInputMode` (see `02-wfa-from-trades.md`).
