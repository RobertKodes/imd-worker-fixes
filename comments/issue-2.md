I checked this against the current distribution (`7f215ca`, `0.1.2+cf06456a`). Questions 1–3 are for the maintainers. Below is what the code shows, plus a design that would keep model reporting honest.

**What the shipped code says**

- The protocol is ready: `RuntimeUsage.runtime` and `RuntimeDescriptor.id` both accept `"acp"` (`dist/cli.js` L65).
- The worker is not: `var ADAPTERS=[()=>new ClaudeRuntime,()=>new CodexRuntime]; var RUNTIME_IDS=["claude","codex"]` (L75).
- Premium is a closed list per runtime: `PREMIUM_MODELS` / `APPROVED_PREMIUM_MODELS` have only `codex` and `claude` keys (L65), and `chooseModel` / `isPremiumModel` (L131) return nothing for any other id.
- Every runtime implements the same small contract:
  - `probe()`
  - `run({workspace, prompt, systemPrompt, model, effort, maxTurns, maxWallClockMs, toolProfile, jail, tools, signal, onEvent})`, which returns `{finalMessage, turns, model, inputTokens, outputTokens, cachedInputTokens, costUsd, exitReason, wallClockMs}`
  - `onEvent` events: `text`, `tool`, `model`, `rate_limit`, `usage`

  An ACP adapter would fit this contract.

**The two hard parts**

1. **Confinement.** Claude and Codex are confined by their own sandboxes: `claudeJailSettings` / `codexJailArgs` (L75) for jailed skills, and `--sandbox workspace-write` / `acceptEdits` plus tool allow-lists otherwise. An arbitrary ACP agent runs its own tools in its own process.

   The good news is that in ACP the **worker is the client**. If the adapter tells the agent it supports `fs/read_text_file`, `fs/write_text_file` and `terminal/*`, and answers `session/request_permission` itself, the worker can enforce the work root, the read roots and network policy at those calls. It would no longer depend on the agent's goodwill. Agents that don't route their tools through the client (they execute internally) would have to run inside the same OS jail the worker uses for Claude on Linux (bubblewrap with `--unshare-all --share-net`, as `checkJail` already probes).

2. **Honest model and usage reporting.** For Claude and Codex, the model comes from the runtime's own stream, and the self-test checks that the premium model actually answered (`readRun` → `otherModel`, L221). As far as I know, ACP has no standard field for the serving model or for token usage. With OpenRouter behind an agent, the model name would be the agent's own claim, which the worker cannot check. My suggestion:
   - `acp` seats report `model` exactly as the agent states it, labelled as self-reported. Only if there is no claim at all, report `null` and zero usage. Never fill in a value.
   - They are **never premium**: no `APPROVED_PREMIUM_MODELS.acp` entry, so `chooseModel(...,"premium")` stays `null` and the plane can keep `acp` to `standard` / `economy` work.
   - The plane decides separately whether economy work accepts `acp` at all. The `RuntimeDescriptor` already carries the id, so scheduling can filter on it without a protocol change.

**Adapter sketch** (JSON-RPC over the agent's stdio):

`initialize` (advertise fs + terminal) → `session/new {cwd: workspace, mcpServers}` → `session/prompt` with the worker's prompt. Then:
- stream `session/update`: message chunks become `text`, `tool_call` becomes `tool`
- answer permission requests by policy
- turn the stop reason (`end_turn` / `max_turn_requests` / `refusal` / `cancelled`) into `exitReason`
- the signal / wall clock sends `session/cancel`, then kills the process group the way `KILL_GRACE_MS` does for Claude

Probe: `IDENTITYMD_ACP_BIN` + `--version`, plus an `initialize` round trip.

The repository is a generated distribution of a private source (README: "Backend source and service credentials are not distributed"). A PR against `dist/` probably can't be merged as code, so the maintainers would have to say where an upstream contribution should go.

Found while building NIGHTSHIFT on IMD (getnightshift.tech). Happy to test a fix.
