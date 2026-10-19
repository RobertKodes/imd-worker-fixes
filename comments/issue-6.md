The root cause is in the plane's dependency resolution, which isn't in this distribution. The worker side reproduces exactly as you describe, though, and there is a small worker change that makes the failure name its real cause.

### Reproduced with the shipped worker code

I built the job's git shape locally as real bundles:
- base
- `build_website` head, which changes `README.md`, `DESIGN.md` and adds `index.html`
- `write_readme_and_docs` started from **baseCommit**, the way it was dispatched

I then ran the shipped `applyDependencies` and `fetchDependency`, cut out of [`dist/cli.js` L180](https://github.com/Identity-md/worker/blob/7f215cad92b999d2bf6a796a68006758e3606dc7/dist/cli.js#L180), with `deps.fetch` serving the bundles by sha256 the way `/bundles/:hash` does:

```
== design_critic, as dispatched [build, readme-from-base]
   ok=false
   accepted dependencies conflict, which plan validation should have prevented: Command failed: git -c user.name=IdentityMD Worker -c user.email=worker@identitymd.invalid merge --no-edit -m imd: combine accepted dependencies 967f199a…

== design_critic, with inherited deps [build, readme-from-build]
   ok=true head=b12ba5d52857 (fast-forward to the README head)
```

The first case gives the same message as your three seats. The second case is your expected behaviour: when the README node starts from the build's head, the shipped merge is a clean fast-forward. So no worker change is needed for the happy path.

### Plane side (reference, not a diff: the plane isn't public)

A pure resolver that carries dependencies through accepted nodes that have no bundle, run on the job's plan:

```js
function effectiveDependencies(nodeId, plan, accepted) {
  const out = [], seen = new Set(), add = (h) => { if (!seen.has(h)) { seen.add(h); out.push(h); } };
  for (const dep of plan[nodeId]) {
    for (const h of accepted[dep].effective) add(h);      // what the dependency itself was given
    if (accepted[dep].bundleHash) add(accepted[dep].bundleHash);
  }
  return out;
}
// build_website          []
// site_content_check     ["001741de"]
// write_readme_and_docs  ["001741de"]                 <- today: []
// design_critic          ["001741de","b3c77fe8"]
```

Plan validation could then check the line property before dispatch: `git merge-base --is-ancestor heads[i-1] heads[i]` for each consecutive pair. That runs on the plane's own copy of the bundles, so it doesn't cost three seats' dispatches.

### Worker side: say what actually happened

Two problems with the current failure:
- git prints the `CONFLICT` lines on **stdout**, while the worker only keeps `stderr`, which falls back to `error.message`. The conflicting paths are lost.
- The detail reads as a machine failure (`clone_failed`, `failureClass: machine`), so the plane tries other seats.

`FailureReason` is a fixed protocol enum (L65), so this change keeps `clone_failed` on the wire. It makes the detail machine-readable, names the paths and aborts the merge:

```diff
-if(!merge2.ok){return{ok:false,detail:`accepted dependencies conflict, which plan validation should have prevented: ${merge2.stderr.slice(0,300)}`}}
+if(!merge2.ok){const unmerged=await git(workspace,["diff","--name-only","--diff-filter=U"]);await git(workspace,["merge","--abort"]);
+  const paths=unmerged.stdout.split("\n").filter(Boolean);const siblings=[];
+  for(const head of heads.slice(1)){const above=await git(workspace,["merge-base","--is-ancestor",heads[0],head]);if(!above.ok)siblings.push(head.slice(0,12))}
+  return{ok:false,detail:`plan_conflict: accepted dependencies ${heads.map(head=>head.slice(0,12)).join(", ")} are not on one line (${siblings.join(", ")||"none"} does not descend from ${heads[0].slice(0,12)}) and both change ${paths.slice(0,12).join(", ")||"the same files"}; no seat can combine them, so this node needs a new plan, not another dispatch`}}
```

With this patch the same reproduction prints (the commit ids differ from the run above because each run builds fresh commits):

```
plan_conflict: accepted dependencies fd95d7a2579d, 483c0314a1e0 are not on one line (483c0314a1e0 does not descend from fd95d7a2579d) and both change DESIGN.md, README.md; no seat can combine them, so this node needs a new plan, not another dispatch
```

The plane could match the `plan_conflict:` prefix and stop re-dispatching to other seats. Better still would be a dedicated `FailureReason` value (`plan_conflict`), but the plane has to accept it before the worker can send it.

Reproduction (`issue6-review-node-deps.mjs <dist/cli.js>`, offline, git only), the patch (`6-worker-plan-conflict-detail.diff`, `git apply`-able on `7f215ca`) and `6-apply.cjs`: I can attach them to this issue or put them in a gist.

Found while building NIGHTSHIFT on IMD (getnightshift.tech). Happy to test a fix.
