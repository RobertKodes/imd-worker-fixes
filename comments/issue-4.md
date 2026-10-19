I looked at what the distributed protocol schema allows today, and drafted the smallest schema change that would let a promise be recorded.

**Today**

The shared schema bundled into the worker (`dist/config.js` L59, the same block as `dist/cli.js` L65) is:

```js
var AssuranceKind = z.enum(["audit", "bounty"]);
var LaunchAssuranceInput = z.strictObject({ kind, provider, url /* https */, commit?, reportHash?, note? })
  .refine(i => i.kind !== "audit" || i.commit !== undefined, "an audit names the commit it covered");
```

It is a `strictObject`. A promise is therefore refused twice: once for the kind, and once for any field that would say *where on chain* to read it. The docs list only `GET /launches/:id/assurances` (`{kind, provider, url, commit, recordedAt, revokedAt}`). I couldn't find who records an assurance or how, so the maintainers would need to say whether there is a write path.

**Proposal: `kind: "promise"`, read from chain rather than from a feed**

```diff
-var AssuranceKind=external_exports.enum(["audit","bounty"]);
+var AssuranceKind=external_exports.enum(["audit","bounty","promise"]);
 ...note:external_exports.string().max(2e3).optional()
+,chainId:external_exports.number().int().positive().optional(),contract:Address.optional(),ref:external_exports.string().regex(/^[0-9]{1,78}$/).optional()
 }).refine(/* audit names a commit */)
+.refine(input2=>input2.kind!=="promise"||input2.chainId!==void 0&&input2.contract!==void 0&&input2.ref!==void 0,
+        {message:"a promise names the chain, the vault and the promise id it is read from",path:["ref"]});
```

I tested it against the bundled schema (shipped vs patched `dist/config.js`):

```
shipped:  accepted audit | refused promise #2 ("expected one of audit|bounty; Unrecognized keys: chainId, contract, ref")
patched:  accepted audit | accepted promise #2 {chainId:4663, contract:0x3c81…2772, ref:"2"} | refused a promise without vault/id
```

Suggested plane behaviour, so the launch page never has to trust Pinky's own feed:

- **Admission:** read `promises(ref)` on `contract`, and require `token` to equal the launch's token. You can show the maker, bond, limit, block range and deadline straight from chain. Only `contract` addresses on an allow-list (PinkyVault, then V2 once deployed) are accepted.
- **Verdict:** a promise ends in one of IMD's own oracle attestations. The plane can match the `Verdict` event to its own `oracle.request` record, so the page could say *"kept — attested by IMD oracle, request 48323d51…"*. For this kind, `revokedAt` would be set by a broken promise or a refund, not by the provider.
- **Wording on the page:** *"the team bonded 50 IMD that it won't sell for 30 days"* is generated from on-chain fields, never from `note`.

I don't know Pinky's exact ABI beyond what this issue states (`promises(id)` fields, `Made`/`Verdict` events). The getter would need pinning to the verified vault source.

Schema diff (`4-assurance-promise-kind.diff`, against `dist/config.js` on `7f215ca`; illustrative, since the plane owns the real schema) and the parse test (`issue4-assurance-schema.test.mjs`): I can attach them to this issue or put them in a gist.

Found while building NIGHTSHIFT on IMD (getnightshift.tech). Happy to test a fix.
