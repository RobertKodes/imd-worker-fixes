// Reproduces Identity-md/worker#1 without any model call or credentials:
// runs a one-line write probe through `codex sandbox` with the same sandbox
// settings the worker passes to `codex exec` (dist/cli.js, CodexRuntime.run).
// Usage: node issue1-codex-windows-sandbox.mjs [workspaceDir]
// Set CODEX_HOME to an empty dir to be sure no login is read.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const codex = process.env.IDENTITYMD_CODEX_BIN ?? "codex";
const ws = process.argv[2] ?? mkdtempSync(join(tmpdir(), "imd-ws-"));
writeFileSync(join(ws, "a.txt"), "hello\n");

const toml = (v) => JSON.stringify(v);
// Copied from shipped dist/cli.js codexJailArgs (line 75)
function codexJailArgs(o) {
  const fs = [`":minimal"="read"`, `":workspace_roots"={"."=${toml(o.write ? "write" : "read")}}`, ...o.readRoots.map((r) => `${toml(r)}="read"`)].join(", ");
  const net = `{enabled=false}`;
  return ["-c", `default_permissions="imd"`, "-c", `permissions.imd={description="identitymd task", filesystem={${fs}}, network=${net}}`];
}

const probe = process.platform === "win32"
  ? ["cmd", "/c", "type a.txt && (echo w> probe.txt) && if exist probe.txt (echo WROTE) else (echo NOWRITE)"]
  : ["/bin/sh", "-c", "cat a.txt && echo w > probe.txt && echo WROTE || echo NOWRITE"];

const cases = {
  // what the worker passes for a non-jailed task: `--sandbox workspace-write`
  "workspace-write (non-jailed task)": ["-c", 'sandbox_mode="workspace-write"', "-c", "sandbox_workspace_write.network_access=false"],
  "read-only (research task)": ["-c", 'sandbox_mode="read-only"'],
  "permission profile (jailed task)": codexJailArgs({ write: true, readRoots: [] }),
  "danger-full-access (control, no sandbox)": ["-c", 'sandbox_mode="danger-full-access"'],
};
console.log(`codex: ${execFileSync(codex, ["--version"], { encoding: "utf8" }).trim().split("\n").pop()}  platform: ${process.platform}  ws: ${ws}`);
for (const [name, args] of Object.entries(cases)) {
  rmSync(join(ws, "probe.txt"), { force: true });
  const r = spawnSync(codex, ["sandbox", ...args, "--", ...probe], { cwd: ws, encoding: "utf8", timeout: 60000 });
  const out = `${r.stdout}${r.stderr}`.split(/\r?\n/).filter((l) => l && !/PATH aliases/.test(l));
  console.log(`\n== ${name}\n   exit=${r.status} fileExists=${existsSync(join(ws, "probe.txt"))}\n   ${out.join("\n   ")}`);
}
rmSync(join(ws, "probe.txt"), { force: true });
