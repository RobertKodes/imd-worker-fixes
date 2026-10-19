# IMD worker fixes, by NIGHTSHIFT

Fixes, reproductions and analysis for the open issues of the IMD (identity.md) worker,
[Identity-md/worker](https://github.com/Identity-md/worker), written by the team behind
**[NIGHTSHIFT](https://getnightshift.tech)**, a platform of autonomous AI companies, games and an
agent arena that runs on IMD ([source](https://github.com/RobertKodes/nightshift)).

Everything is checked against `Identity-md/worker@7f215ca` (worker `0.1.2+cf06456a`). The worker repository
is generated from a private source, so these are proposals for the maintainers to carry into it: every `.diff`
passes `git apply --check` on that commit, and each `N-apply.cjs` makes the same change by exact replacement.

| Issue | What | Confidence | Files |
|---|---|---|---|
| [#5](https://github.com/Identity-md/worker/issues/5) | Own-RPC relay: split too-wide `eth_getLogs` (413 / -32614) inside the relay, all or nothing; keep jailed oracle agents on the relay | high / medium | `patches/5-*`, `repro/issue5-relay.test.mjs` (shipped 4 fail, patched 7/7) |
| [#6](https://github.com/Identity-md/worker/issues/6) | Dependency lost behind a review node: `clone_failed` reproduced; plane resolver as reference; worker names the conflicting files | high (diagnosis) | `patches/6-*`, `repro/issue6-review-node-deps.mjs` |
| [#1](https://github.com/Identity-md/worker/issues/1) | Codex on Windows: workspace writes are denied while `imd doctor` is green; a zero-token write probe in doctor and start | high (guard) | `patches/1-*`, `repro/issue1-codex-windows-sandbox.mjs` |
| [#4](https://github.com/Identity-md/worker/issues/4) | Pinky promises as launch assurances: a `promise` assurance kind | medium (design) | `patches/4-*`, `repro/issue4-assurance-schema.test.mjs` |
| [#3](https://github.com/Identity-md/worker/issues/3) | Launch logos: where they are published today, and a proposal | medium | `comments/issue-3.md` |
| [#2](https://github.com/Identity-md/worker/issues/2) | A first-class `acp` runtime: adapter design | low / medium | `comments/issue-2.md` |

No keys, wallets or provider accounts were used: every test runs offline or against public endpoints.

Also by NIGHTSHIFT: **[IMD Watchtower](https://github.com/RobertKodes/imd-watchtower)**, an open monitor for IMD's order
intake, deployments and swarm health, with a live status page at [getnightshift.tech/imd-status](https://getnightshift.tech/imd-status).

MIT licensed.
