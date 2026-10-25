// UI test harness: serves the bundled UI in a normal browser with window.rpc / window.app
// backed by a running quantd (private RPC, cookie auth), so screens can be tested without the exe.
//   node tools/devbridge.mjs <quantd datadir>/<network> [port=8095]
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [netDir, port = "8095"] = process.argv.slice(2);
const UI = new URL("../ui/", import.meta.url);
const rpcPort = { regtest: 27338, test: 17338, main: 7338 }[netDir.split(/[\\/]/).pop()];
let prefs = {};

async function rpc(method, params) {
  const token = readFileSync(join(netDir, ".cookie"), "utf8").trim();
  const r = await fetch(`http://127.0.0.1:${rpcPort}/`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ method, params, id: 1 }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function app(cmd, p) {
  if (cmd === "status") {
    let wallet = false; try { await rpc("getwalletinfo", []); wallet = true; } catch {}
    return { started: true, network: netDir.split(/[\\/]/).pop(), wallet_file: wallet, wallet_loaded: wallet, datadir: netDir, version: "dev" };
  }
  if (cmd === "prefs") return prefs;
  if (cmd === "savePrefs") { prefs = p; return true; }
  if (cmd === "newWords") return (await rpc("createwallet", [])).seed_words; // harness: creates immediately
  if (cmd === "createWallet") return true;
  return true;
}

const shim = `<script>
window.rpc = (m, p) => fetch("/rpc", { method: "POST", body: JSON.stringify([m, p]) }).then(async (r) => { const j = await r.json(); if (j.e) throw new Error(j.e); return j.r; });
window.app = (c, a) => fetch("/app", { method: "POST", body: JSON.stringify([c, a]) }).then(async (r) => { const j = await r.json(); if (j.e) throw new Error(j.e); return j.r; });
</script>`;

createServer(async (req, res) => {
  if (req.method === "POST") {
    let body = ""; for await (const c of req) body += c;
    const [a, b] = JSON.parse(body);
    try { res.end(JSON.stringify({ r: req.url === "/rpc" ? await rpc(a, b || []) : await app(a, b || {}) })); }
    catch (e) { res.end(JSON.stringify({ e: e.message })); }
    return;
  }
  const f = new URL("." + (req.url === "/" ? "/index.html" : req.url.split("?")[0]), UI);
  if (!existsSync(f)) { res.statusCode = 404; return res.end(); }
  let data = readFileSync(f);
  if (f.pathname.endsWith("index.html")) data = data.toString().replace("<head>", "<head>" + shim);
  res.setHeader("Content-Type", f.pathname.endsWith(".css") ? "text/css" : f.pathname.endsWith(".svg") ? "image/svg+xml" : f.pathname.endsWith(".js") ? "text/javascript" : "text/html");
  res.end(data);
}).listen(+port, "127.0.0.1", () => console.log(`UI harness on http://127.0.0.1:${port}/`));
