I traced both gaps in the shipped build (`7f215ca`, worker `0.1.2+cf06456a`) and wrote a patch for each. I tested it offline: a mocked upstream, real loopback HTTP, no provider calls and no keys.

### Gap 2: range errors (root cause)

[`dist/cli.js` L162](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L162):

```js
function endpointFailed(status2){return status2===429||status2===401||status2===403||status2>=500}
...
if(!endpointFailed(answer.status)){ /* write the answer back unchanged */ }
```

The relay only ever looks at the HTTP status. A 413 / `-32614` passes through untouched, and so does an HTTP 200 with a `-32614` envelope (as @gjwang noted). Adding 413 to the predicate would not help much either: the fallback is the public endpoints, which usually have the same range limit and often no archive data.

**Fix:** split the request inside the relay, against the same upstream, and leave every other method alone.

- This applies only to a single (non-batch) `eth_getLogs` that has `fromBlock`/`toBlock` and no `blockHash`.
- An answer counts as range-limited when it is HTTP 413, or has JSON-RPC code `-32614`, or has a message matching the usual provider wording (`block range`, `limited to a 10,000 range`, `query returned more than N results`, …).
- `latest`/`safe`/`finalized` are resolved **once** with `eth_getBlockByNumber`, so the target is pinned. The range is then bisected and walked in order, with a cap of 256 sub-requests.
- **All or nothing:** if any chunk fails for a reason other than its range, the split is dropped. The relay then moves on to the next upstream, or returns the original error. A partial log set is never returned.
- A range error doesn't put the own endpoint on cooldown. Your provider is healthy; the query was just too wide.

Excerpt of the change (the full diff is in the attached patch):

```diff
+var RANGE_LIMIT=/block range|range (is )?too (large|wide)|limited to (a )?[0-9,]+ ?(block)? range|query returned more than [0-9,]+ results|exceeds? (the )?(max(imum)?|allowed) (block )?range|too many blocks/i;
+function rangeLimited(answer){if(answer.status===413)return true; /* else parse JSON: error.code===-32614 || RANGE_LIMIT.test(error.message) */}
+function logsQuery(body){ /* single eth_getLogs with a block range, else null */ }
 ...
-const body=Buffer.concat(chunks);const publics=
+const body=Buffer.concat(chunks);const query=logsQuery(body);const publics=
 ...
-body:Buffer.from(await upstream.arrayBuffer())};if(!endpointFailed(answer.status)){
+body:Buffer.from(await upstream.arrayBuffer())};
+if(query&&!endpointFailed(answer.status)&&rangeLimited(answer)){
+  const merged=await splitLogs(url2,query);           // same upstream, pinned target, all-or-nothing
+  if(merged!==null){ if(url2===own2)coolingUntil.delete(chainId); response.writeHead(200,{"content-type":"application/json"}); return void response.end(merged) }
+  last=answer; continue                                // next upstream, or the original error
+}
+if(!endpointFailed(answer.status)){
```

### Gap 1: the agent can leave the relay (root cause)

[`ownRpcRules`](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L160) (L160) is only prompt text. `runTask` already reads the brief's public endpoints (L162, `briefEndpoints(...)` → `deps.learnPublicRpc(...)`), but it only uses them to set up the relay's fallbacks. `oracle-assess` is a jailed skill, so the task already runs inside a sandbox that has a host deny-list ([`DENIED_HOSTS` / `claudeJailSettings` / `codexJailArgs`, L75](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L75)). Today that list only holds cloud-metadata hosts.

**Fix:** when the brief's chain has an own RPC, add the brief's public RPC hostnames to that task's sandbox deny-list. This covers both Claude (`sandbox.network.deniedDomains` plus `WebFetch(domain:…)` denies) and Codex (`permissions.imd.network.domains` = `"deny"`). The relay runs in the daemon, outside the sandbox, so it can still fall back to those same URLs. From the agent's side, the relay becomes the only way to reach that chain. The prompt line says so.

```diff
-if(deps.learnPublicRpc&&deps.ownRpc?.length){const brief=await briefEndpoints(workspace,READS_DIR);if(brief)deps.learnPublicRpc(brief.chainId,brief.urls)}
+var relayOnly=[];if(deps.learnPublicRpc&&deps.ownRpc?.length){const brief=await briefEndpoints(workspace,READS_DIR);if(brief){deps.learnPublicRpc(brief.chainId,brief.urls);if(deps.ownRpc.some(rpc2=>rpc2.chainId===brief.chainId))relayOnly=relayedHosts(brief.urls)}}
-...jailed(task)?{jail:true}:{}                       // x4 runtime.run calls in runTask
+...jailed(task)?{jail:true,deniedHosts:relayOnly}:{}
-deny:DENIED_HOSTS.map(host=>`WebFetch(domain:${host})`)
+deny:[...DENIED_HOSTS,...options.deniedHosts??[]].map(host=>`WebFetch(domain:${host})`)
-deniedDomains:[...DENIED_HOSTS],allowLocalBinding:true
+deniedDomains:[...DENIED_HOSTS,...options.deniedHosts??[]],allowLocalBinding:true
-${DENIED_HOSTS.map(host=>`${toml(host)}="deny"`).join(", ")}
+${[...DENIED_HOSTS,...options.deniedHosts??[]].map(host=>`${toml(host)}="deny"`).join(", ")}
```

Limits of this part:
- It only blocks the endpoints the task's `oracle.json` names. An agent could still pick some other public RPC it knows about. Blocking every RPC host would need an allow-list, which is a bigger policy change.
- I unit-tested the settings builders, but I have not run a live oracle panel through it.

### Test results

The test cuts `startRpcRelay` and the two jail builders straight out of a `dist/cli.js` and runs them, so the same script works on the shipped and the patched file:

```
                                                         shipped   patched
HTTP 413 + -32614, 13 h eth_getLogs (23,400 blocks)       FAIL      PASS  (24/24 logs, 7 upstream calls)
HTTP 200 + -32614 envelope                                FAIL      PASS
toBlock "latest" resolved once and pinned                 FAIL      PASS
one failed chunk -> error, never a partial result         PASS      PASS
eth_call revert passes through untouched, not retried     PASS      PASS
429 on own still falls back to public                     PASS      PASS
jailed sandbox denies the relayed chain's public hosts    FAIL      PASS
```

One related thing I checked: with `IDENTITYMD_EGRESS_FILTER=1`, the worker's own proxy answers every plain-HTTP proxy request with 405 (`startEgressFilter`, [L190](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L190)). That matches @gjwang's observation. Whether it actually sits between the sandbox and `http://127.0.0.1:<relay>` depends on how each runtime's sandbox proxy chains, and I haven't verified that.

Patch (`git apply`-able against `7f215ca`), an exact-replacement script and the test: `5-relay-range-split-and-egress.diff`, `5-apply.cjs`, `issue5-relay.test.mjs`. I can attach them to this issue or put them in a gist.

Found while building NIGHTSHIFT on IMD (getnightshift.tech). Happy to test a fix.
