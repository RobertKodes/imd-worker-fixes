// Reproduction for Identity-md/worker#6, offline.
// 1. Builds the job's git shape locally (base -> build_website head; write_readme_and_docs
//    started from baseCommit vs from the build's head) as real git bundles.
// 2. Runs the SHIPPED worker code path, applyDependencies + fetchDependency, cut out of
//    dist/cli.js, with deps.fetch serving those bundles by sha256 like /bundles/:hash.
// 3. Runs a reference resolver for the plane: effective dependencies inherited through
//    nodes that accepted without a bundle, on the job's 4-node plan.
// Usage: node issue6-review-node-deps.mjs <path/to/dist/cli.js>
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const src = readFileSync(process.argv[2], "utf8");
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error("segment not found: " + from); return src.slice(a, b); };
const code = cut("async function git(cwd,args", "async function treeHash(") + cut("async function applyDependencies(", "async function uploadBundle2(");
const { applyDependencies } = new Function("run5", "createHash8", "join23", "writeFile13", "unlink2",
  code + ";return{applyDependencies}")(promisify(execFile), createHash, join, writeFile, unlink);

const root = mkdtempSync(join(tmpdir(), "imd-6-"));
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" }).trim();
const origin = join(root, "origin"); execFileSync("git", ["init", "-q", "-b", "main", origin]);
const put = (dir, file, text) => writeFileSync(join(dir, file), text);
put(origin, "README.md", "# sworn\n"); put(origin, "DESIGN.md", "design v0\n");
g(origin, "add", "-A"); g(origin, "commit", "-qm", "base");
const base = g(origin, "rev-parse", "HEAD");

const bundles = new Map();
function node(name, from, edits) {
  g(origin, "checkout", "-q", "-B", "imd-submission", from);
  for (const [f, t] of Object.entries(edits)) put(origin, f, t);
  g(origin, "add", "-A"); g(origin, "commit", "-qm", name);
  const file = join(root, `${name}.bundle`);
  g(origin, "bundle", "create", "-q", file, `${base}..imd-submission`);
  const bytes = readFileSync(file); const hash = createHash("sha256").update(bytes).digest("hex");
  bundles.set(hash, bytes); return { hash, head: g(origin, "rev-parse", "HEAD") };
}
const build = node("build_website", base, { "README.md": "# sworn\nbuilt site\n", "DESIGN.md": "design v1 (build)\n", "index.html": "<h1>sworn</h1>\n" });
// what the plane did: README node started from baseCommit with no dependency bundles
const readmeFromBase = node("write_readme_and_docs.asDispatched", base, { "README.md": "# sworn\ndocs rewrite\n", "DESIGN.md": "design v1 (docs)\n" });
// what it should have done: start from the build's head, inherited through the review node
const readmeFromBuild = node("write_readme_and_docs.expected", build.head, { "README.md": "# sworn\nbuilt site\ndocs rewrite\n", "DESIGN.md": "design v1 (build)\nplus docs\n" });
g(origin, "checkout", "-q", "main");

const deps = { server: "https://plane.invalid", fetch: async (url) => {
  const hash = new URL(url).pathname.split("/").pop(); const bytes = bundles.get(hash);
  return bytes ? new Response(bytes) : new Response("", { status: 404 });
} };
async function designCritic(label, dependencies) {
  const ws = join(root, `ws-${label}`);
  execFileSync("git", ["clone", "-q", "--no-checkout", origin, ws]); g(ws, "checkout", "-q", "--detach", base);
  const r = await applyDependencies(deps, ws, dependencies.map((d) => ({ artifactHash: d.hash })));
  const at = r.ok ? g(ws, "rev-parse", "HEAD") : null;
  console.log(`\n== design_critic, ${label}\n   ok=${r.ok}${at ? ` head=${at.slice(0, 12)} ${at === dependencies.at(-1).head ? "(fast-forward to the README head)" : ""}` : ""}\n   ${r.detail ?? ""}`);
}
console.log(`base ${base.slice(0, 12)}  build ${build.head.slice(0, 12)}  readme(as dispatched) ${readmeFromBase.head.slice(0, 12)}  readme(expected) ${readmeFromBuild.head.slice(0, 12)}`);
await designCritic("as dispatched [build, readme-from-base]", [build, readmeFromBase]);
await designCritic("with inherited deps [build, readme-from-build]", [build, readmeFromBuild]);

// Reference resolver for the plane (pure function; the plane's own code is not public).
// accepted: nodeId -> { bundleHash|null, effective: [bundleHash...] } for accepted nodes.
function effectiveDependencies(nodeId, plan, accepted) {
  const out = [];
  const seen = new Set();
  const add = (h) => { if (!seen.has(h)) { seen.add(h); out.push(h); } };
  for (const dep of plan[nodeId]) {
    const a = accepted[dep];
    // a dependency's own inputs flow through, then its own bundle if it made one
    for (const h of a.effective) add(h);
    if (a.bundleHash) add(a.bundleHash);
  }
  return out; // in dependency order; the last bundle's head is the start commit when they are on one line
}
const plan = { build_website: [], site_content_check: ["build_website"], write_readme_and_docs: ["site_content_check"], design_critic: ["build_website", "write_readme_and_docs"] };
const accepted = {};
for (const [id, bundleHash] of [["build_website", "001741de"], ["site_content_check", null], ["write_readme_and_docs", "b3c77fe8"]]) {
  accepted[id] = { bundleHash, effective: effectiveDependencies(id, plan, accepted) };
}
console.log("\n== reference resolver on the job's plan");
for (const id of Object.keys(plan)) console.log(`   ${id.padEnd(22)} dependencyBundleHashes=${JSON.stringify(effectiveDependencies(id, plan, accepted))}`);
rmSync(root, { recursive: true, force: true });
