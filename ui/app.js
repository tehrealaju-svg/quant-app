// Quant for Windows — UI. Calls the built-in node through window.rpc / window.app (bound by
// main.cpp). Keys stay in the node's encrypted wallet file; this page never sees them.
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = $("#view");
const call = (m, p = []) => window.rpc(m, p);
const app = (c, a = {}) => window.app(c, a);
let status = null;

// The page is loaded from memory (no origin), so localStorage isn't available: preferences
// live in the app's data folder via the native bridge.
let prefs = {};
const prefGet = (k) => (k in prefs ? prefs[k] : null);
function prefSet(k, v) { prefs[k] = String(v); app("savePrefs", prefs).catch(() => {}); }
function applyTheme() { const t = prefGet("quant.theme"); if (t && t !== "system") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

function toast(msg, ms = 3200) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function modal(html) {
  const bg = document.createElement("div"); bg.className = "modal-bg"; bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg); return bg;
}
const busy = (b, on, l = "") => { b.disabled = on; if (on) { b.dataset.l = b.innerHTML; b.innerHTML = `<span class="spinner"></span>${l}`; } else if (b.dataset.l) b.innerHTML = b.dataset.l; };
const num = (s) => +String(s).replace(/,/g, "");
function fmt(x, max = 4) {
  x = +x; if (!isFinite(x)) return "–"; if (x === 0) return "0";
  if (Math.abs(x) < 1) return x.toFixed(Math.min(10, 3 - Math.floor(Math.log10(Math.abs(x))))).replace(/0+$/, "");
  if (Math.abs(x) >= 1e6) return (x / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  return x.toLocaleString(undefined, { maximumFractionDigits: max });
}
const ago = (t) => { const s = Date.now() / 1000 - t; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : new Date(t * 1000).toLocaleDateString(); };
function tokenIcon(t) {
  const tk = (t?.ticker || "?").slice(0, 3); let h = 0; for (const c of t?.id || tk) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="token-icon" style="background:hsl(${h % 360} 70% 45%)">${esc(tk)}</span>`;
}
async function guard(fn, btn) { try { if (btn) busy(btn, true); await fn(); } catch (e) { toast(e.message || String(e), 5000); } finally { if (btn) busy(btn, false); } }

// ---------------------------------------------------------------- router
const routes = { "": home, coins, messages, token, create, mining, network, settings, send, receive };
async function route() {
  view.classList.remove("full");
  status = await app("status");
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === (name || "home")));
  if (!status.started) { view.innerHTML = `<div class="notice err">The Quant node couldn't start: ${esc(status.error)}</div>`; return; }
  if (!status.wallet_loaded && !["network", "settings"].includes(name)) return walletGate();
  try { await (routes[name] || home)(arg && decodeURIComponent(arg)); }
  catch (e) { view.innerHTML = `<div class="notice err">${esc(e.message || e)}</div>`; }
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- wallet setup / unlock
function walletGate() {
  if (status.wallet_file) {
    view.innerHTML = `<div class="card stack onboard"><h1>Unlock your wallet</h1>
      <input class="in" type="password" id="pw" placeholder="Wallet password" autofocus>
      <button class="btn block" id="go">Unlock</button></div>`;
    const go = () => guard(async () => { await app("openWallet", { password: $("#pw").value }); route(); }, $("#go"));
    $("#go").onclick = go; $("#pw").onkeydown = (e) => e.key === "Enter" && go();
    return;
  }
  view.innerHTML = `<div class="card stack onboard"><img src="logo.svg" width="64" height="64" alt="">
    <h1>Welcome to <span class="gradient-text">Quant</span></h1>
    <p class="muted">Quantum-safe money. This app is a full Quant node: it keeps the network running, mines, and holds your wallet.</p>
    <button class="btn block" id="new">Create a new wallet</button><button class="btn ghost block" id="old">Restore from 24 seed words</button></div>`;
  $("#new").onclick = async () => setupWallet(await app("newWords"), false);
  $("#old").onclick = () => setupWallet("", true);
}
function setupWallet(words, restore) {
  view.innerHTML = `<div class="card stack onboard"><h1>${restore ? "Restore wallet" : "Write these words down"}</h1>
    ${restore ? `<textarea class="in" id="w" placeholder="Your 24 words, in order"></textarea>`
      : `<p class="muted" style="margin:0">These 24 words <b>are</b> your money. Write them on paper and keep it safe. They also open this wallet on the Quant website.</p>
         <div class="words selectable">${words.split(" ").map((w) => `<span>${w}</span>`).join("")}</div>
         <label class="row"><input type="checkbox" id="ok"> I wrote them down in order</label>`}
    <input class="in" type="password" id="p1" placeholder="Password for this computer (8+ characters)">
    <input class="in" type="password" id="p2" placeholder="Repeat password">
    <button class="btn block" id="go">${restore ? "Restore" : "Create wallet"}</button>
    <button class="btn line sm" id="back">Back</button></div>`;
  $("#back").onclick = walletGate;
  $("#go").onclick = () => guard(async () => {
    if (!restore && !$("#ok").checked) throw new Error("Tick the box once the words are written down");
    if ($("#p1").value.length < 8) throw new Error("Use at least 8 characters");
    if ($("#p1").value !== $("#p2").value) throw new Error("Passwords don't match");
    await app("createWallet", { words: restore ? $("#w").value : words, password: $("#p1").value, restored: restore });
    toast(restore ? "Wallet restored — finding your coins…" : "Wallet created");
    route();
  }, $("#go"));
}

// ---------------------------------------------------------------- home (wallet)
async function home() {
  const [w, tx, toks] = await Promise.all([call("getwalletinfo"), call("listtransactions", [30]), call("gettokenbalances")]);
  view.innerHTML = `
  <div class="page-head"><div><span class="muted">Balance</span><div class="balance-big selectable">${esc(w.confirmed)} <small>QNT</small></div>
    ${num(w.unconfirmed) ? `<div class="muted">+ ${esc(w.unconfirmed)} QNT arriving</div>` : ""}
    ${num(w.immature) ? `<div class="muted">${esc(w.immature)} QNT mined, spendable after 100 blocks</div>` : ""}</div>
    <div class="row"><a class="btn" href="#/send">Send</a><a class="btn ghost" href="#/receive">Receive</a></div></div>
  <div class="grid cols-2">
    <div class="card"><h2>Activity</h2>${tx.length ? `<ul class="list">${tx.map((t) => `<li>
      <span class="token-icon" style="background:${t.type === "mined" ? "var(--accent)" : t.amount.startsWith("-") ? "var(--surface)" : "var(--up)"};color:${t.amount.startsWith("-") && t.type !== "mined" ? "var(--text)" : "#fff"}">${t.type === "mined" ? "Q" : t.amount.startsWith("-") ? "↑" : "↓"}</span>
      <div class="grow"><b>${esc(t.note || ({ mined: "Mined", sent: "Sent", received: "Received" })[t.type])}</b>
        <div class="faint" style="font-size:13px">${t.confirmations ? ago(t.time) : "pending"} ${t.counterparty ? "· " + esc(t.counterparty.slice(0, 14)) + "…" : ""}</div></div>
      <div class="r"><b class="${t.amount.startsWith("-") ? "" : "up"}">${t.amount.startsWith("-") ? "" : "+"}${esc(t.amount)}</b></div></li>`).join("")}</ul>`
      : `<p class="muted">No transactions yet. Start <a href="#/mining">mining</a> or share your <a href="#/receive">address</a>.</p>`}</div>
    <div class="card"><h2>Coins</h2>${toks.length ? `<ul class="list">${toks.map((t) => `<li>${t.asset.endsWith("-SHARE") ? `<span class="token-icon" style="background:var(--surface);color:var(--muted)">LP</span>` : tokenIcon({ ticker: t.asset, id: t.asset_id })}
      <div class="grow"><b>${esc(t.asset)}</b></div><div class="r"><b>${fmt(t.amount)}</b></div>
      ${t.asset.endsWith("-SHARE") ? "" : `<a class="btn ghost sm" href="#/token/${t.asset_id}">Trade</a>`}</li>`).join("")}</ul>`
      : `<p class="muted">You don't hold any meme coins yet. <a href="#/coins">Browse coins</a> or <a href="#/create">create one</a>.</p>`}</div>
  </div>`;
}

async function send() {
  const [w, toks] = await Promise.all([call("getwalletinfo"), call("gettokenbalances")]);
  const assets = [["QNT", "", w.confirmed], ...toks.filter((t) => !t.asset.endsWith("-SHARE")).map((t) => [t.asset, t.asset_id, t.amount])];
  view.innerHTML = `<div class="card stack" style="max-width:520px"><h1>Send</h1>
    <div><label class="f">Asset</label><select class="in" id="as">${assets.map(([n, id, a]) => `<option value="${id}">${esc(n)} — ${fmt(a)} available</option>`).join("")}</select></div>
    <div><label class="f">To address</label><input class="in mono" id="to" placeholder="${status.network === "main" ? "qnt1…" : "tqnt1…"}" spellcheck="false"></div>
    <div><label class="f">Amount</label><input class="in" id="amt" inputmode="decimal" placeholder="0.0"></div>
    <button class="btn block" id="go">Send</button></div>`;
  $("#go").onclick = () => guard(async () => {
    const id = $("#as").value, to = $("#to").value.trim(), amt = $("#amt").value.trim();
    const v = await call("validateaddress", [to]);
    if (!v.valid) throw new Error("That isn't a valid Quant address");
    if (!(+amt > 0)) throw new Error("Enter an amount");
    const name = assets.find((a) => a[1] === id)[0];
    const m = modal(`<h2>Confirm</h2><p>Send <b>${esc(amt)} ${esc(name)}</b> to<br><span class="mono">${esc(to)}</span></p>
      <div class="row"><button class="btn" id="ok">Send</button><button class="btn ghost" id="no">Cancel</button></div>`);
    $("#no", m).onclick = () => m.remove();
    $("#ok", m).onclick = (e) => guard(async () => {
      await (id ? call("sendtoken", [id, to, amt]) : call("send", [to, amt]));
      m.remove(); toast("Sent ✓"); location.hash = "#/";
    }, e.target);
  }, $("#go"));
}

async function receive() {
  const w = await call("getwalletinfo");
  view.innerHTML = `<div class="card stack" style="max-width:520px"><h1>Receive</h1>
    <p class="muted" style="margin:0">Share this address to receive QNT or any Quant coin.</p>
    <div class="mono selectable" style="font-size:15px;padding:14px;background:var(--surface);border-radius:12px">${esc(w.receive_address)}</div>
    <div class="row"><button class="btn" id="cp">Copy</button><button class="btn ghost" id="nw">New address</button></div></div>`;
  $("#cp").onclick = async () => { await navigator.clipboard.writeText(w.receive_address).catch(() => {}); toast("Copied"); };
  $("#nw").onclick = () => guard(async () => { await call("getnewaddress", ["receive"]); receive(); });
}

// ---------------------------------------------------------------- coins
async function coins() {
  view.classList.add("full");
  view.innerHTML = `<div class="term-host"></div>`;
  QTerminal.mount($(".term-host"), {
    markets: (sort) => call("listmarkets", [sort, 300]),
    history: (id) => call("getpoolhistory", [id, 2000]),
    trades: (id) => call("getpooltrades", [id, 200]),
    async portfolio() {
      const [w, toks] = await Promise.all([call("getwalletinfo"), call("gettokenbalances")]);
      return { qnt: num(w.confirmed), tokens: toks.filter((t) => !t.asset.endsWith("-SHARE")).map((t) => ({ id: t.asset_id, ticker: t.asset, amount: num(t.amount) })) };
    },
    quote: (id, side, amt) => call("quote", [id, side, amt]),
    swap: (id, side, amt, slip) => call("swap", [id, side, amt, String(slip)]),
    prefGet, prefSet, toast,
  }, { createHref: "#/create", refreshMs: 15000 });
}

function chart(points) {
  if (points.length < 2) return `<div class="muted" style="height:200px;display:grid;place-items:center">Not enough trades yet for a chart</div>`;
  const W = 600, H = 200, P = 6, xs = points.map((p) => p.time), ys = points.map((p) => p.price_qnt);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) * 0.98, y1 = Math.max(...ys) * 1.02;
  const X = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (y) => H - P - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.time).toFixed(1)},${Y(p.price_qnt).toFixed(1)}`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:200px"><path class="area" d="${d}L${X(x1)},${H}L${X(x0)},${H}Z"/><path class="line" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

async function token(id) {
  const t = await call("gettoken", [id]);
  const pool = t.pool, hist = pool ? await call("getpoolhistory", [id, 300]) : [];
  view.innerHTML = `<div class="page-head"><div class="row">${tokenIcon(t)}<div><h1 style="margin:0">${esc(t.name)}</h1><span class="muted">${esc(t.ticker)}</span></div></div>
    ${pool ? `<div class="balance-big" style="font-size:28px">${fmt(pool.price_qnt, 10)} <small>QNT</small></div>` : ""}</div>
  <div class="grid cols-2"><div class="stack">
    <div class="card">${pool ? chart(hist) : `<div class="notice">No pool yet. Open one under Liquidity to make it tradable.</div>`}</div>
    <div class="card"><dl class="kv"><dt>Supply</dt><dd>${fmt(num(t.supply))}</dd>${pool ? `<dt>Liquidity</dt><dd>${fmt(pool.liquidity_qnt)} QNT</dd>` : ""}
      <dt>Decimals</dt><dd>${t.decimals}</dd><dt>ID</dt><dd class="mono selectable" style="font-size:11px">${t.id}</dd></dl></div></div>
  <div class="stack">
    ${pool ? `<div class="card stack"><div class="row between"><h2 style="margin:0">Trade</h2><div class="seg buy-sell"><button class="buy on" data-s="buy">Buy</button><button class="sell" data-s="sell">Sell</button></div></div>
      <input class="in" id="amt" inputmode="decimal" placeholder="Amount of QNT to spend"><div class="muted" id="qt" style="min-height:40px;font-size:14px"></div>
      <button class="btn block" id="go">Buy ${esc(t.ticker)}</button></div>` : ""}
    <div class="card stack"><h2 style="margin:0">Liquidity</h2><input class="in" id="lq" placeholder="QNT" inputmode="decimal"><input class="in" id="lt" placeholder="${esc(t.ticker)}" inputmode="decimal">
      <div class="row"><button class="btn ghost" id="add">${pool ? "Add" : "Open pool"}</button>${pool ? `<button class="btn line" id="rm">Withdraw all mine</button>` : ""}</div></div></div></div>`;
  let side = "buy";
  const quote = async () => {
    const a = $("#amt").value.trim();
    if (!(+a > 0)) { $("#qt").textContent = ""; return; }
    try { const q = await call("quote", [id, side, a]); $("#qt").innerHTML = `You get about <b>${esc(q.out)} ${side === "buy" ? esc(t.ticker) : "QNT"}</b> · impact ${q.price_impact_percent.toFixed(2)}%`; }
    catch (e) { $("#qt").textContent = e.message; }
  };
  if (pool) {
    $$("[data-s]").forEach((b) => (b.onclick = () => {
      side = b.dataset.s; $$("[data-s]").forEach((x) => x.classList.toggle("on", x === b));
      $("#amt").placeholder = side === "buy" ? "Amount of QNT to spend" : `Amount of ${t.ticker} to sell`;
      $("#go").textContent = (side === "buy" ? "Buy " : "Sell ") + t.ticker; $("#go").className = "btn block" + (side === "sell" ? " danger" : ""); quote();
    }));
    let tm; $("#amt").oninput = () => { clearTimeout(tm); tm = setTimeout(quote, 250); };
    $("#go").onclick = () => guard(async () => { const r = await call("swap", [id, side, $("#amt").value.trim(), "1"]); toast(`${side === "buy" ? "Bought" : "Sold"} ✓ (${r.out})`); token(id); }, $("#go"));
    $("#rm").onclick = () => guard(async () => { const r = await call("removeliquidity", [id, "all"]); toast(`Withdrew ${r.qnt} QNT + ${r.tok}`); token(id); }, $("#rm"));
  }
  $("#add").onclick = () => guard(async () => { await call("addliquidity", [id, $("#lq").value.trim(), $("#lt").value.trim()]); toast("Liquidity added ✓"); token(id); }, $("#add"));
}

async function create() {
  view.innerHTML = `<div class="card stack" style="max-width:560px"><h1>Create a coin</h1>
    <p class="muted" style="margin:0">Free — only the normal network fee. The whole supply goes to your wallet.</p>
    <input class="in" id="tk" maxlength="10" placeholder="Ticker (e.g. DOGE2)" style="text-transform:uppercase">
    <input class="in" id="nm" maxlength="32" placeholder="Name">
    <input class="in" id="sp" inputmode="decimal" placeholder="Total supply">
    <select class="in" id="dc">${[0, 2, 4, 6, 8, 10].map((d) => `<option ${d === 8 ? "selected" : ""} value="${d}">${d} decimals</option>`).join("")}</select>
    <input class="in" id="ur" maxlength="120" placeholder="Logo or website (https, optional)">
    <button class="btn block" id="go">Create coin</button></div>`;
  $("#go").onclick = () => guard(async () => {
    const r = await call("createtoken", [$("#tk").value.trim(), $("#nm").value.trim(), $("#sp").value.trim(), $("#dc").value, $("#ur").value.trim()]);
    toast(`Created ${r.ticker} ✓`); location.hash = "#/token/" + r.token;
  }, $("#go"));
}

// ---------------------------------------------------------------- mining
let mineTimer = null;
async function mining() {
  const cores = navigator.hardwareConcurrency || 4;
  const draw = async () => {
    if (!location.hash.startsWith("#/mining")) { clearInterval(mineTimer); mineTimer = null; return; }
    const m = await call("getmininginfo");
    const hr = m.hashrate >= 1e6 ? (m.hashrate / 1e6).toFixed(2) + " MH/s" : (m.hashrate / 1e3).toFixed(1) + " kH/s";
    const ring = $("#ring");
    if (ring) {
      ring.style.setProperty("--p", m.mining ? Math.min(100, (m.threads / cores) * 100) + "%" : "0%");
      $("#hr").textContent = m.mining ? hr : "Stopped";
      $("#st").innerHTML = `<dt>Blocks found</dt><dd>${m.blocks_found}</dd><dt>Block reward</dt><dd>${esc(m.reward)} QNT</dd>
        <dt>Network height</dt><dd>${m.height.toLocaleString()}</dd><dt>Difficulty</dt><dd>${fmt(m.difficulty)}</dd>
        <dt>Paying to</dt><dd class="mono selectable" style="font-size:11px">${esc(m.payout_address || "your wallet")}</dd>`;
      $("#tg").textContent = m.mining ? "Stop mining" : "Start mining";
      $("#tg").className = "btn block" + (m.mining ? " danger" : "");
      $("#tg").dataset.on = m.mining ? "1" : "";
    }
  };
  view.innerHTML = `<div class="grid cols-2"><div class="card stack" style="text-align:center"><h1>Mining</h1>
      <div class="mine-ring" id="ring"><div><span><b id="hr">…</b><span class="muted">hashrate</span></span></div></div>
      <div><label class="f">CPU threads: <b id="tv"></b> of ${cores}</label><input type="range" id="th" min="1" max="${cores}" value="${prefGet("app.threads") || Math.max(1, cores >> 1)}"></div>
      <button class="btn block" id="tg">…</button></div>
    <div class="card"><h2>Stats</h2><dl class="kv" id="st"></dl>
      <p class="faint" style="font-size:13px">Mined coins can be spent after 100 blocks (~3 hours). Mining uses your CPU: the computer may run warmer.</p></div></div>`;
  const th = $("#th"); const sv = () => { $("#tv").textContent = th.value; prefSet("app.threads", th.value); };
  th.oninput = sv; sv();
  th.onchange = () => $("#tg").dataset.on && guard(async () => { await call("setmining", [th.value]); draw(); });
  $("#tg").onclick = () => guard(async () => { await call("setmining", [$("#tg").dataset.on ? "0" : th.value]); await draw(); }, $("#tg"));
  await draw();
  clearInterval(mineTimer); mineTimer = setInterval(draw, 2000);
}

// ---------------------------------------------------------------- network
const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : (b / 1e3).toFixed(0) + " KB");
function left(until) {
  if (until === null) return "forever";
  const s = until - Date.now() / 1000;
  return s <= 0 ? "ending" : s < 3600 ? Math.ceil(s / 60) + " min left" : s < 86400 ? Math.ceil(s / 3600) + " h left" : Math.ceil(s / 86400) + " days left";
}
async function network() {
  const [c, peers, net, snap, bans] = await Promise.all([call("getblockchaininfo"), call("getpeerinfo"), call("getnetworkinfo"),
    call("getsnapshotinfo"), call("listbanned").catch(() => [])]);
  const up = peers.reduce((a, p) => a + p.bytes_out, 0), down = peers.reduce((a, p) => a + p.bytes_in, 0);
  const seeding = peers.filter((p) => p.syncing_from_us);
  view.innerHTML = `<h1>Network</h1><div class="stats" style="margin:12px 0 16px">
    <div class="stat"><span class="muted">Height</span><b>${c.height.toLocaleString()}</b></div>
    <div class="stat"><span class="muted">Peers</span><b>${peers.length}</b></div>
    <div class="stat"><span class="muted">Uploaded</span><b>${mb(net.bytes_out)}</b></div>
    <div class="stat"><span class="muted">Downloaded</span><b>${mb(net.bytes_in)}</b></div></div>
  ${seeding.length ? `<div class="notice" style="margin-bottom:16px">You're seeding the chain to ${seeding.length} new node${seeding.length > 1 ? "s" : ""}. If someone keeps re-downloading and wasting your bandwidth, ban them below.</div>` : ""}
  <div class="card" style="margin-bottom:16px"><div class="row between wrap"><h2 style="margin:0">Peers</h2>
      <div class="row"><input class="in mono" id="ip" placeholder="Add peer: IP or IP:port" style="width:260px"><button class="btn sm" id="add">Connect</button></div></div>
    <p class="faint" style="font-size:13px;margin:6px 0 10px">New nodes only need the network (same genesis); peers you add here are retried over and over until they answer.</p>
    ${peers.length ? `<div class="table-scroll"><table class="t"><thead><tr><th>Address</th><th>Client</th><th class="num">Height</th><th class="num">Ping</th>
      <th class="num">Sent to them</th><th class="num">From them</th><th class="num">Blocks sent</th><th>Ban</th></tr></thead><tbody>
      ${peers.map((p) => `<tr><td class="mono selectable">${esc(p.addr)} <span class="faint">${p.inbound ? "in" : "out"}</span>${p.syncing_from_us ? ` <span class="pill brand">syncing from you</span>` : ""}</td>
        <td class="faint">${esc(p.agent)}</td><td class="num">${p.height.toLocaleString()}</td><td class="num">${p.ping_ms >= 0 ? Math.round(p.ping_ms) + " ms" : "–"}</td>
        <td class="num">${mb(p.bytes_out)}</td><td class="num">${mb(p.bytes_in)}</td><td class="num">${p.blocks_sent.toLocaleString()}</td>
        <td><select class="in" data-ban="${esc(p.addr)}" style="min-height:32px;padding:4px 8px;width:auto"><option value="">Ban…</option><option>24h</option><option>7d</option><option>31d</option><option>forever</option></select></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">No peers yet. Looking on the DHT and your local network; add an IP above to connect directly.</p>`}</div>
  <div class="grid cols-2">
    <div class="card"><div class="row between"><h2 style="margin:0">Banned IPs</h2><span class="faint">${bans.length}</span></div>
      <div class="row wrap" style="margin:12px 0"><input class="in mono" id="bip" placeholder="IP to ban" style="flex:1 1 160px"><select class="in" id="bdur" style="width:auto"><option>24h</option><option>7d</option><option>31d</option><option>forever</option></select><button class="btn ghost sm" id="bgo">Ban</button></div>
      ${bans.length ? `<ul class="list">${bans.map((b) => `<li><div class="grow"><b class="mono selectable">${esc(b.ip)}</b><div class="faint" style="font-size:12px">${esc(b.reason)}</div></div>
        <span class="pill">${left(b.until)}</span><button class="btn line sm" data-unban="${esc(b.ip)}">Unban</button></li>`).join("")}</ul>` : `<p class="muted">Nobody is banned.</p>`}</div>
    <div class="card"><h2>This node</h2><dl class="kv"><dt>Network</dt><dd>${esc(c.network)}</dd><dt>Syncing</dt><dd>${c.syncing ? "yes" : "no"}</dd>
      <dt>Discovery</dt><dd>${esc(net.dht)}</dd><dt>Port mapping</dt><dd>${esc(net.upnp)}</dd><dt>Public address</dt><dd>${esc(net.external_address || "–")}</dd>
      <dt>Port</dt><dd>${net.port}</dd><dt>Signatures kept</dt><dd>${c.disk_signatures_mb.toFixed(1)} MB (pruned after a week)</dd>
      <dt>Next state snapshot</dt><dd>block ${snap.next_snapshot_height.toLocaleString()}</dd></dl>
      <button class="btn line sm" id="dd" style="margin-top:12px">Open data folder</button></div></div>`;
  $("#dd").onclick = () => app("openDataDir");
  $("#add").onclick = () => guard(async () => { await call("addnode", [$("#ip").value.trim()]); toast("Connecting… it keeps retrying until they answer"); setTimeout(network, 2500); }, $("#add"));
  $("#bgo").onclick = () => guard(async () => { await call("setban", [$("#bip").value.trim(), $("#bdur").value, "banned by you"]); toast("Banned"); setTimeout(network, 600); }, $("#bgo"));
  $$("[data-ban]").forEach((s) => (s.onchange = () => s.value && guard(async () => {
    const ip = s.dataset.ban.replace(/^\[(.*)\](:\d+)?$/, "$1").replace(/:\d+$/, "");
    await call("setban", [ip, s.value, "wasting bandwidth"]); toast(`Banned ${ip} (${s.value})`); setTimeout(network, 600);
  })));
  $$("[data-unban]").forEach((b) => (b.onclick = () => guard(async () => { await call("clearban", [b.dataset.unban]); setTimeout(network, 600); })));
}

// ---------------------------------------------------------------- settings
// ---------------------------------------------------------------- messages (on-chain chat + gifts)
const shortAddr = (a) => (a.length > 22 ? a.slice(0, 10) + "…" + a.slice(-8) : a);
const names = () => { try { return JSON.parse(prefGet("quant.names") || "{}"); } catch { return {}; } };
const nameOf = (a) => names()[a] || shortAddr(a);
function avatar(a) {
  let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="av" style="background:hsl(${h % 360} 65% 48%)">${esc((names()[a] || a.split("1").slice(1).join("1")).slice(0, 1).toUpperCase())}</span>`;
}
let chatTimer = null;
async function loadMessages() {
  const addrs = (await call("listaddresses")).map((a) => a.address);
  const mine = new Set(addrs);
  const lists = await Promise.all(addrs.map((a) => call("getmessages", [a, 500]).catch(() => [])));
  const seen = new Map();
  // The node lists newest first; walk oldest first so same-block messages keep their order.
  for (const l of lists) for (const m of [...l].reverse()) if (!seen.has(m.txid)) seen.set(m.txid, { ...m, me: mine.has(m.from), other: mine.has(m.from) ? m.to : m.from });
  const convos = new Map();
  for (const m of seen.values()) { if (!convos.has(m.other)) convos.set(m.other, []); convos.get(m.other).push(m); }
  const t = (m) => (m.pending ? Infinity : m.time);
  for (const v of convos.values()) v.sort((a, b) => t(a) - t(b));
  return [...convos.entries()].sort((a, b) => t(b[1][b[1].length - 1]) - t(a[1][a[1].length - 1]));
}
async function messages(peer) {
  clearInterval(chatTimer);
  let convos = await loadMessages();
  if (peer && !convos.some(([a]) => a === peer)) convos.unshift([peer, []]);
  const seenGifts = new Set(JSON.parse(prefGet("quant.seenGifts") || "[]"));
  const when = (m) => `<span class="when ${m.pending ? "pend" : ""}">${m.pending ? "" : new Date(m.time * 1000).toLocaleString()}</span>`;
  const paint = () => {
    const cur = convos.find(([a]) => a === peer);
    const preview = (m) => (m.gift ? `${m.me ? "You sent" : "Sent you"} a ${GIFTS[m.gift].label.toLowerCase()}` : (m.me ? "You: " : "") + m.text);
    view.innerHTML = `<div class="page-head"><div><h1>Messages</h1><span class="muted">Stored on the Quant chain, so anyone can read them. Gifts pay their price to the person you send them to.</span></div>
      <button class="btn" id="newc">New chat</button></div>
      <div class="chat card ${peer ? "open" : ""}">
        <div class="chat-list">${convos.length ? convos.map(([a, ms]) => `<a class="chat-item ${a === peer ? "on" : ""}" href="#/messages/${encodeURIComponent(a)}">${avatar(a)}
          <div class="meta"><div class="nm">${esc(nameOf(a))}</div><div class="last">${ms.length ? esc(preview(ms[ms.length - 1])) : "New chat"}</div></div></a>`).join("")
          : `<p class="muted" style="padding:12px">No messages yet. Start a chat with any Quant address.</p>`}</div>
        <div class="thread">${cur ? `
          <div class="thread-head"><a class="btn ghost sm" href="#/messages">←</a>${avatar(peer)}<div style="min-width:0"><div style="font-weight:700">${esc(nameOf(peer))}</div><div class="mono muted selectable" style="font-size:12px">${esc(peer)}</div></div>
            <div class="grow"></div><button class="btn ghost sm" id="nick">Rename</button></div>
          <div class="bubbles" id="bub">${cur[1].map((m) => m.gift
            ? `<div class="bubble giftb ${m.me ? "me" : ""}" data-g="${m.gift}">${giftArt(m.gift, true)}<span class="gname">${GIFTS[m.gift].label} · ${GIFTS[m.gift].price} QNT</span>${m.text ? `<span>${esc(m.text)}</span>` : ""}${when(m)}</div>`
            : `<div class="bubble selectable ${m.me ? "me" : ""}">${esc(m.text)}${when(m)}</div>`).join("") || `<p class="muted" style="text-align:center">Say hi — or send a gift.</p>`}</div>
          <div id="gsel"></div>
          <div class="composer"><button class="btn ghost" id="gbtn" title="Send a gift">🎁</button><textarea class="in" id="txt" maxlength="280" rows="1" placeholder="Message"></textarea><button class="btn" id="snd">Send</button></div>`
          : `<div class="muted" style="margin:auto;text-align:center">Pick a chat</div>`}</div>
      </div>`;
    $("#newc").onclick = () => {
      const m = modal(`<h2>New chat</h2><label class="f">Their Quant address</label><input class="in mono" id="a" spellcheck="false"><button class="btn block" id="go" style="margin-top:12px">Open chat</button>`);
      $("#go", m).onclick = () => guard(async () => {
        const a = $("#a", m).value.trim();
        if (!(await call("validateaddress", [a])).valid) throw new Error("That isn't a valid Quant address");
        m.remove(); location.hash = "#/messages/" + encodeURIComponent(a);
      });
    };
    if (!cur) return;
    const bub = $("#bub"); bub.scrollTop = bub.scrollHeight;
    $$(".bubble.giftb", bub).forEach((b) => (b.onclick = () => giftBurst(+b.dataset.g)));
    const fresh = cur[1].filter((m) => m.gift && !m.me && !m.pending && !seenGifts.has(m.txid));
    if (fresh.length) { giftBurst(fresh[fresh.length - 1].gift); fresh.forEach((m) => seenGifts.add(m.txid)); prefSet("quant.seenGifts", JSON.stringify([...seenGifts].slice(-500))); }
    $("#nick").onclick = () => {
      const m = modal(`<h2>Rename</h2><input class="in" id="n" maxlength="40" value="${esc(names()[peer] || "")}"><button class="btn block" id="ok" style="margin-top:12px">Save</button>`);
      $("#ok", m).onclick = () => { const all = names(), n = $("#n", m).value.trim(); if (n) all[peer] = n; else delete all[peer]; prefSet("quant.names", JSON.stringify(all)); m.remove(); paint(); };
    };
    let gift = 0;
    const showGift = () => {
      $("#gsel").innerHTML = gift ? `<div class="row" style="padding-top:10px"><span class="gift-chip">${giftArt(gift)}${GIFTS[gift].label} · ${GIFTS[gift].price} QNT</span><button class="btn ghost sm" id="gx">Remove</button></div>` : "";
      if (gift) $("#gx").onclick = () => { gift = 0; showGift(); };
    };
    $("#gbtn").onclick = () => {
      const m = modal(`<h2>Send a gift</h2><p class="muted" style="margin:0">The price goes to ${esc(nameOf(peer))}.</p>
        <div class="gift-pick">${GIFTS.filter(Boolean).map((g) => `<button class="gift-opt" data-id="${g.id}">${giftArt(g.id)}<b>${g.label}</b><span class="p">${g.price} QNT</span></button>`).join("")}</div>`);
      $$(".gift-opt", m).forEach((b) => (b.onclick = () => { gift = +b.dataset.id; m.remove(); showGift(); $("#txt").focus(); }));
    };
    const txt = $("#txt");
    txt.oninput = () => { txt.style.height = "auto"; txt.style.height = Math.min(txt.scrollHeight, 140) + "px"; };
    txt.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#snd").click(); } };
    $("#snd").onclick = (e) => guard(async () => {
      const text = txt.value.trim();
      if (!text && !gift) return;
      if (new TextEncoder().encode(text).length > 280) throw new Error("Messages are at most 280 bytes");
      await call("sendmessage", [peer, text, GIFTS[gift]?.name || "none"]);
      if (gift) giftBurst(gift);
      txt.value = ""; gift = 0;
      convos = await loadMessages();
      if (!convos.some(([a]) => a === peer)) convos.unshift([peer, []]);
      paint();
    }, e.target);
  };
  paint();
  chatTimer = setInterval(async () => {
    if (!location.hash.startsWith("#/messages")) return clearInterval(chatTimer);
    if ($("#txt")?.value) return;
    const next = await loadMessages().catch(() => null);
    if (!next || JSON.stringify(next) === JSON.stringify(convos.filter(([, m]) => m.length))) return;
    convos = next;
    if (peer && !convos.some(([a]) => a === peer)) convos.unshift([peer, []]);
    paint();
  }, 8000);
}

async function settings() {
  const theme = prefGet("quant.theme") || "system";
  const adv = prefGet("quant.adv") === "1" || theme === "amoled";
  view.innerHTML = `<div class="stack" style="max-width:560px"><h1>Settings</h1>
    <div class="card stack"><h2>Appearance</h2><div class="seg" id="th"><button data-t="system">System</button><button data-t="light">Light</button><button data-t="dark">Dark</button>${adv ? `<button data-t="amoled">AMOLED</button>` : ""}</div></div>
    ${status.wallet_loaded ? `<div class="card stack"><h2>Wallet</h2><button class="btn ghost" id="sd">Show seed words</button></div>` : ""}
    <div class="card stack"><h2>About</h2><p class="muted" style="margin:0">Quant ${esc(status.version)} · ${esc(status.network)}net · data in <span class="mono">${esc(status.datadir)}</span></p>
      <div class="row"><button class="btn line sm" id="wp">White paper</button><button class="btn line sm" id="web">Website</button></div></div>
    <p class="faint" id="ver" style="font-size:12px">Quant for Windows</p></div>`;
  $$("#th button").forEach((b) => { b.classList.toggle("on", b.dataset.t === theme); b.onclick = () => { prefSet("quant.theme", b.dataset.t); applyTheme(); settings(); }; });
  let taps = 0; $("#ver").onclick = () => { if (++taps === 5) { prefSet("quant.adv", "1"); toast("AMOLED theme unlocked"); settings(); } };
  $("#wp").onclick = () => app("openUrl", { url: "https://github.com/tehrealaju-svg/quant-core/raw/main/docs/quant-whitepaper.pdf" });
  $("#web").onclick = () => app("openUrl", { url: "https://tehrealaju-svg.github.io/quant-web/" });
  if ($("#sd")) $("#sd").onclick = () => guard(async () => {
    const w = await call("dumpseed", ["confirm"]);
    modal(`<h2>Seed words</h2><p class="muted">Never share these. Anyone with them can take your coins.</p><div class="words selectable">${w.split(" ").map((x) => `<span>${x}</span>`).join("")}</div>`);
  });
}

// ---------------------------------------------------------------- footer status
async function foot() {
  try { const c = await call("getblockchaininfo"); const p = await call("getpeerinfo");
    $("#foot").innerHTML = `<span class="net-dot ${p.length ? "ok" : ""}"></span>${p.length} peers<br>Block ${c.height.toLocaleString()}${c.syncing ? " · syncing" : ""}<br>${esc(c.network)}net`;
  } catch {}
}
(async () => {
  prefs = await app("prefs").catch(() => ({})) || {};
  applyTheme();
  await route(); foot(); setInterval(foot, 10000);
})();
