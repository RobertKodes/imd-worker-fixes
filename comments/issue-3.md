I checked what the public API, the docs and the worker distribution can confirm. Some of this only the maintainers can answer, and I've marked where.

**What is confirmed**

- `GET /launches/6e9ac2a3-…` currently returns `logo: {jobId, state, hash, cleared, link}`. The `link` field is new since this issue was opened. Here it is `{"jobId":"3ddc4977-…","state":"completed","hash":"db1c85a8…","cleared":null,"link":null}`.
- `GET /artifacts/db1c85a8…` answers `302` to `https://media.imd-cdn.xyz/db1c85a8…`, with `Cache-Control: public, max-age=86400`. So the logo is a content-addressed file on IMD's CDN.
- The logo job is `template: "skill:token-logo"` with `paidBy: null`, so the launch opened it at no cost to you. Its objective says *"Wallets and token lists crop a logo to a circle, so keep the mark inside the central circle"*. The logo was drawn with wallets in mind, but that sentence doesn't show it is sent to any of them.
- The docs (imd.fun/docs/llms.txt) never mention a logo. The Launches section documents only `GET /launches`, `GET /launches/:id`, `GET /launches/:id/assurances` and `GET /launch/policies`, with no write route for a logo. The worker distribution has no logo code at all; only the `token-logo` skill job produces one.
- In the 40 most recent launches, every `logo` is either `null` or `{state:"completed", cleared:null, link:null}`. I found no example of `cleared` or `link` being set, so I can't tell from the outside what sets them or who can.

**Answers, as far as they can be confirmed**

1. *Where does it go?* Confirmed: IMD's own launch record and its CDN. Nothing documented pushes it to token lists, explorers or aggregators. Rabby/GMGN showing no icon fits that, since they read their own token metadata sources. The maintainers would need to confirm there is no outbound integration.
2. *Can the requester replace it / set `cleared`?* No documented route allows it, and `cleared` is never set in the sample. Whether it is an operator-only moderation flag (the name suggests a takedown) is for the maintainers to say.
3. *A `logo` input on `launch.open`?* Below is a proposal that fits the existing body rules.

**Proposal**

- `launch.open` (and `job.continue` for a launched project) would take an optional `logo`, in one of two forms:
  - `{ "path": "brand/token-logo.png" }`: a file in the launch's own source repository at `sourceCommit`. The plane already clones that repository, and this needs no new upload path.
  - an `inputs[]`-style accepted file (`path`, `hash`, `mediaType`, `bytes`, `submissionHash`), exactly as the docs already define for chaining jobs.
- The file would go through the checks the `token-logo` objective already states: square PNG, ≥512 px, the mark inside the central circle. A requester-supplied logo skips the drawing job. If the file fails the checks, the launch falls back to the drawn one, and the reason is recorded on `logo`.
- After a launch, the paying wallet could sign a message (as @hexysdev offers) to swap in a new file. It goes through the same checks, and `logo` gains `source: "requester" | "drawn"` and `replacedAt`.
- Distribution: a stable `GET /launches/:id/logo` URL, plus an optional per-chain token list (Uniswap `tokenlist` schema: `chainId, address, name, symbol, decimals, logoURI`) that aggregators can ingest. Wallets would still need someone to submit the list to them; that step isn't automatic.

Workaround for #1166 today, unconfirmed: none documented. A job that copies `brand/token-logo.png` into `artifacts/logo.png` would produce an accepted file, but nothing documented attaches it to a launch.

Found while building NIGHTSHIFT on IMD (getnightshift.tech). Happy to test a fix.
