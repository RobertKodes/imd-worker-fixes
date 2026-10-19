// #4 proposal: a "promise" assurance kind in the shared protocol schema (shipped copy in dist/config.js L59;
// the same block is bundled into cli.js, client.js and web.js). Illustrative: the plane owns the real schema.
const fs = require("fs"); const [src, dst] = process.argv.slice(2); let t = fs.readFileSync(src, "utf8");
function rep(a, b) { const n = t.split(a).length - 1; if (n !== 1) throw new Error(`expected 1 of ${a.slice(0, 60)}, got ${n}`); t = t.replace(a, b); }
rep('var AssuranceKind=external_exports.enum(["audit","bounty"]);', 'var AssuranceKind=external_exports.enum(["audit","bounty","promise"]);');
rep('note:external_exports.string().max(2e3).optional()}).refine(input2=>input2.kind!=="audit"||input2.commit!==void 0,{message:"an audit names the commit it covered",path:["commit"]});',
  'note:external_exports.string().max(2e3).optional(),chainId:external_exports.number().int().positive().optional(),contract:Address.optional(),ref:external_exports.string().regex(/^[0-9]{1,78}$/).optional()}).refine(input2=>input2.kind!=="audit"||input2.commit!==void 0,{message:"an audit names the commit it covered",path:["commit"]}).refine(input2=>input2.kind!=="promise"||input2.chainId!==void 0&&input2.contract!==void 0&&input2.ref!==void 0,{message:"a promise names the chain, the vault and the promise id it is read from",path:["ref"]});');
fs.writeFileSync(dst, t); console.log("patched ->", dst);
