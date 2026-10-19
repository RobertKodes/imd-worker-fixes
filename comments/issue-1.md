I reproduced the write side of this on Windows 11 without any login or model call. I used `CODEX_HOME` set to an empty directory and ran a one-line probe through `codex sandbox`, with the same sandbox settings the worker passes to `codex exec`:

```
codex: codex-cli 0.159.2  platform: win32
== workspace-write (non-jailed task)       exit=1 fileExists=false   hello / Access is denied.
== read-only (research task)               exit=1 fileExists=false   hello / Access is denied.
== permission profile (jailed task)        exit=1 fileExists=false   windows sandbox failed: Restricted read-only access requires the elevated Windows sandbox backend
== danger-full-access (control)            exit=0 fileExists=true    hello / WROTE
```

On this host, `workspace-write` behaves exactly like `read-only`: reads work, but writing into the workspace fails. I got the same result with the workspace under `%TEMP%` and under `%USERPROFILE%`. Two caveats:
- 0.159.2 is older than the worker's own `RUNTIME_MINIMUMS.codex` (`0.162.1`, L75), so the result should be re-checked on 0.162.1 or newer.
- I did not reproduce "execution policy rejected even repository reads". That looks like openai/codex#23965 (command policy), which is separate from the write failure (#34961).

### Why `doctor` is green while every task is empty

- **Non-jailed tasks always get `--sandbox workspace-write`** ([`CodexRuntime.run`, `dist/cli.js` L75](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L75)), and there is no Windows branch.
- **`checkJail` returns `ok:false` on `win32`** (same line, *"codex's sandbox cannot jail reads on Windows; run the worker under WSL"*). But that only turns off the jailed skills (`oracle-assess`, `research-report`, `build-contract-project`; `start`, L312). `tests`/`implement` work is still taken.
- **The runtime self-test only reads.** `SELF_TEST_PROMPT` is `cat .imd-self-test` ([L219–221](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L219)), so it passes on a host whose sandbox cannot write.

### Fix: a zero-token write probe on Windows

I added `checkCodexWorkspace()`. It runs `codex sandbox -c sandbox_mode="workspace-write" -- cmd /c "echo w> .imd-write-probe"` in the work root and checks on disk that the file exists. That takes no model call and costs nothing. When the probe fails:
- `imd doctor` shows a red `codex write` row.
- `imd start` refuses to take work instead of submitting empty results under the seat's name.

```diff
+var WRITE_PROBE=".imd-write-probe";
+async function checkCodexWorkspace(workspace,options={}){
+  if((options.platform??process.platform)!=="win32")return{ok:true,detail:"not probed off Windows"};
+  const binary=options.codexBinary??env.IDENTITYMD_CODEX_BIN??"codex"; const target=join7(workspace,WRITE_PROBE); rmSync2(target,{force:true});
+  const result=await run3(binary,["sandbox","-c",'sandbox_mode="workspace-write"',"-c","sandbox_workspace_write.network_access=false","--","cmd","/c",`echo w> ${WRITE_PROBE}`],workspace,env);
+  const wrote=existsSync2(target); rmSync2(target,{force:true});
+  return wrote?{ok:true,...}:{ok:false,detail:"codex's workspace-write sandbox cannot write the workspace here (…), so every task would submit nothing; run the worker under WSL, or use --runtime claude"}
+}
 // start, after the jail check (L312)
+if(runtime.id==="codex"){const writable=await checkCodexWorkspace(workRoot);if(!writable.ok){log(`taking no work: ${writable.detail}`,"error");return 1}}
 // doctor (L339): one more check row, printed and counted with the others
+…,codexWrites]=await Promise.all([…, adapters.some(a=>a.id==="codex")&&process.platform==="win32"?checkCodexWorkspace(workRoot).then(…):Promise.resolve(null)])
```

Patched `imd doctor --runtime codex` on the same machine (isolated `IDENTITYMD_HOME`, no config, Codex not signed in):

```
  ✗ sandbox codex codex's sandbox cannot jail reads on Windows; run the worker under WSL
  ✗ codex write codex's workspace-write sandbox cannot write the workspace here (Access is denied.), so every task would submit nothing; run the worker under WSL, or use --runtime claude
                fix: run the worker under WSL2, or imd start --runtime claude
```

When upstream fixes the sandbox, the probe starts passing and nothing else needs to change.

### Your questions

1. **A supported "skip the Codex sandbox" setup on Windows?** Not in the shipped code. Non-jailed tasks always pass `--sandbox workspace-write`, and nothing changes that. The worker's allowed-paths check (`firstViolation`, L162) runs *after* the agent, on the paths it changed. It does not limit what the agent can read, so relying on it instead of the sandbox would be a policy change for the maintainers to make.
2. **WSL2?** Yes. The docs say so ("On Windows, use Claude Code. For Codex, run it in WSL or on a Linux VPS: its sandbox can block every command on Windows itself."), and so does `checkJail`'s message.
3. **Stop assigning Codex tasks to Windows seats?** I can't see the scheduler side. The patch above protects the seat on the worker side, because the seat simply takes no work while the probe fails.

### On the `allowedPaths` comment (job 4635b702)

On the worker side, `firstViolation` matches each changed path against `allowedPaths` from the **repository root** with picomatch. Under a budget of `prototypes/c/**`, a write to `concepts/prototypes/c/...` would therefore fail locally as `path_violation` before upload. If those submissions reached the verifier, the node's budget must have allowed `concepts/` (or `unrestrictedWrites`). In that case the conflict is between the objective text and the verifier's root, which is on the plane side and isn't visible from the worker distribution.

Probe script (`issue1-codex-windows-sandbox.mjs`, runs with no credentials), patch (`1-codex-windows-write-probe.diff`, `git apply`-able on `7f215ca`) and `1-apply.cjs`: I can attach them to this issue or put them in a gist.

Found while building NIGHTSHIFT on IMD (getnightshift.tech). Happy to test a fix.
