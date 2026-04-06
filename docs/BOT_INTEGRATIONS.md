# Freqtrade and OctoBot integrations (without the TypeScript engine)

You **do not have to** install or call **`@kiploks/engine-core`** or other Open Core npm packages if your workflow is built around **Freqtrade** or **OctoBot**.

Separate repositories ship **Python-side bridges** that send backtest and walk-forward results to **Kiploks** (hosted analysis, API keys, upload flow). They are **not** part of this `engine` repository; they complement it for users who want a direct bot integration instead of mapping exports to `Trade[]` or CSV in Node.

| Integration | Repository |
| ----------- | ---------- |
| Freqtrade | [github.com/kiploks/kiploks-freqtrade](https://github.com/kiploks/kiploks-freqtrade) |
| OctoBot | [github.com/kiploks/kiploks-octobot](https://github.com/kiploks/kiploks-octobot) |

Use the README in each repo for setup (config, script entrypoints, and Kiploks API usage).

**Relation to Open Core:** The engine repo still defines **contracts and formulas** that power cloud analysis. The Python integrations are **client paths** into the product; they do not replace reading [`CHANGELOG.md`](../CHANGELOG.md) when you care about version alignment between bot export shape and server expectations.
