// Before/after test for Identity-md/worker#5. Loads the relay and sandbox builders
// straight out of a dist/cli.js (shipped or patched), runs real loopback HTTP
// against a mocked upstream. No provider calls, no keys.
// Usage: node issue5-relay.test.mjs <path/to/dist/cli.js>
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
const src = readFileSync(process.argv[2], "utf8");
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error("segment not found: " + from); return src.slice(a, b); };
const relaySrc = cut("var MAX_REQUEST_BYTES=", "function redactRpcUrl(");
const startRpcRelay = new Function("createServer", "readFile14", "join22", relaySrc + ";return startRpcRelay")(createServer);
const jailSrc = cut("var DENIED_HOSTS=", "function readSetting(") + cut("function claudeJailSettings(", "function withNodeOnPath(");
const { claudeJailSettings, codexJailArgs } = new Function(jailSrc + ";return{claudeJailSettings,codexJailArgs}")();
const hasRelayedHosts = src.includes("function relayedHosts(");

const LIMIT = 10000n, HEAD = 0x5b67n; // 23,400 blocks = 13 h on a 2 s chain
let calls = [];
function mockOwn({ style = "413", failChunkAt = null } = {}) {
  return async (url, init) => {
    const req = JSON.parse(init.body.toString());
    calls.push(`${new URL(url).host} ${req.method} ${req.params?.[0]?.fromBlock ?? ""}-${req.params?.[0]?.toBlock ?? ""}`);
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
    if (url.includes("public")) return json(429, { jsonrpc: "2.0", id: req.id, error: { code: -32005, message: "rate limited" } });
    if (req.method === "eth_getBlockByNumber") return json(200, { jsonrpc: "2.0", id: req.id, result: { number: "0x" + HEAD.toString(16) } });
    if (req.method === "eth_call") return json(200, { jsonrpc: "2.0", id: req.id, error: { code: 3, message: "execution reverted" } });
    if (req.method === "eth_getLogs") {
      const f = req.params[0]; const from = BigInt(f.fromBlock); const to = f.toBlock === "latest" ? HEAD : BigInt(f.toBlock);
      if (failChunkAt !== null && from <= failChunkAt && failChunkAt <= to && to - from < LIMIT) return json(503, { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: "upstream down" } });
      if (to - from + 1n > LIMIT) {
        const err = { jsonrpc: "2.0", id: req.id, error: { code: -32614, message: "eth_getLogs is limited to a 10,000 range" } };
        return json(style === "413" ? 413 : 200, err);
      }
      const logs = []; for (let b = from; b <= to; b++) if (b % 1000n === 0n) logs.push({ blockNumber: "0x" + b.toString(16), logIndex: "0x0" });
      return json(200, { jsonrpc: "2.0", id: req.id, result: logs });
    }
    return json(200, { jsonrpc: "2.0", id: req.id, result: "0x1" });
  };
}
async function ask(relay, body) {
  const r = await fetch(relay.endpoints[0].url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const logsReq = (toBlock = "0x" + HEAD.toString(16)) => ({ jsonrpc: "2.0", id: 7, method: "eth_getLogs", params: [{ address: "0x00000000000000000000000000000000000000aa", fromBlock: "0x0", toBlock }] });
const expected = Number(HEAD / 1000n) + 1;
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

for (const [name, opts, req] of [
  ["HTTP 413 + -32614, 13 h eth_getLogs", { style: "413" }, logsReq()],
  ["HTTP 200 + -32614 envelope", { style: "200" }, logsReq()],
  ["toBlock \"latest\" is pinned once", { style: "413" }, logsReq("latest")],
]) {
  calls = []; const relay = await startRpcRelay({ 8453: "https://own.example/key" }, { fetch: mockOwn(opts) });
  const r = await ask(relay, req); await relay.close();
  const got = Array.isArray(r.body.result) ? r.body.result.length : null;
  const blocks = got ? r.body.result.map((l) => BigInt(l.blockNumber)) : [];
  const ordered = blocks.every((b, i) => i === 0 || b > blocks[i - 1]);
  check(name, r.status === 200 && got === expected && ordered && r.body.id === 7, `status ${r.status}, ${got ?? r.body.error?.message} logs of ${expected}, upstream calls ${calls.length}`);
}
{ // one chunk fails: no partial success
  calls = []; const relay = await startRpcRelay({ 8453: "https://own.example/key" }, { fetch: mockOwn({ style: "413", failChunkAt: 12000n }) });
  const r = await ask(relay, logsReq()); await relay.close();
  check("a failed chunk yields an error, never a partial result", !Array.isArray(r.body.result), `status ${r.status}, ${r.body.error?.message}`);
}
{ // unrelated execution error passes unchanged and is not retried
  calls = []; const relay = await startRpcRelay({ 8453: "https://own.example/key" }, { fetch: mockOwn() });
  const r = await ask(relay, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{}, "0x1"] }); await relay.close();
  check("eth_call revert passes through untouched", r.body.error?.code === 3 && calls.length === 1, `upstream calls ${calls.length}`);
}
{ // existing fallback behaviour unchanged: 429 from own -> public tried
  calls = []; const relay = await startRpcRelay({ 8453: "https://own.example/key" }, { fetch: async (u, i) => { calls.push(u); return new Response('{"jsonrpc":"2.0","id":1,"result":"0x2"}', { status: u.includes("own") ? 429 : 200 }); } });
  relay.learn(8453, ["https://public.example/rpc"]); const r = await ask(relay, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }); await relay.close();
  check("429 on own still falls back to the public endpoint", r.body.result === "0x2" && calls.length === 2);
}
{ // enforcement: the jailed task's sandbox denies the public RPC hosts of a relayed chain
  const deniedHosts = ["mainnet.base.org", "base-rpc.publicnode.com"];
  const claude = JSON.parse(claudeJailSettings({ workspace: "/w", shell: true, network: true, readRoots: [], deniedHosts }));
  const codex = codexJailArgs({ write: true, network: true, readRoots: [], deniedHosts }).join(" ");
  const ok = hasRelayedHosts && deniedHosts.every((h) => claude.sandbox.network.deniedDomains.includes(h) && claude.permissions.deny.includes(`WebFetch(domain:${h})`) && codex.includes(`"${h}"="deny"`));
  check("jailed sandbox (claude + codex) denies the relayed chain's public hosts", ok, hasRelayedHosts ? "" : "shipped build never passes them");
}
console.log(failures ? `\n${failures} failing` : "\nall passing"); process.exitCode = failures ? 1 : 0;
