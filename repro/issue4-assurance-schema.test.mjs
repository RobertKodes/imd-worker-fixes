// Parses an audit and a Pinky promise against LaunchAssuranceInput from a dist/config.js
// (shipped or with patches/4-assurance-promise-kind.diff applied). Offline.
// Usage: node issue4-assurance-schema.test.mjs <path/to/dist/config.js>
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "imd-4-"));
const copy = join(dir, "config.mjs");
writeFileSync(copy, readFileSync(process.argv[2], "utf8") + "\nexport{LaunchAssuranceInput as __LaunchAssuranceInput};\n");
const { __LaunchAssuranceInput: schema } = await import(pathToFileURL(copy).href);
const cases = {
  "audit (today)": { kind: "audit", provider: "Example Audits", url: "https://example.com/report.pdf", commit: "b86d7aea5bd2d67e38c6868148168fabf3c83b3d" },
  "pinky promise #2": { kind: "promise", provider: "Pinky", url: "https://pinkybond.fun", chainId: 4663, contract: "0x3c81384aa1ca064316576a214e2fb30969992772", ref: "2", note: "no PINKY out of the team wallet for a day" },
  "promise without vault (must be refused)": { kind: "promise", provider: "Pinky", url: "https://pinkybond.fun" },
};
for (const [name, input] of Object.entries(cases)) {
  const r = schema.safeParse(input);
  console.log(`${r.success ? "accepted" : "refused "}  ${name}${r.success ? "" : `: ${r.error.issues.map((i) => i.message).join("; ")}`}`);
}
