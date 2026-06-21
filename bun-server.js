import QRCode from "qrcode";
import os from "os";
import fs from "fs";
import https from "https";
import http from "http";
import { spawn, exec } from "child_process";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = 3000;
const PLAYERS = 8;
const KEYMAP = {
  1: { buzzer: "Q", blue: "W", orange: "E", green: "R", yellow: "T" },
  2: { buzzer: "A", blue: "S", orange: "D", green: "F", yellow: "G" },
  3: { buzzer: "Z", blue: "X", orange: "C", green: "V", yellow: "B" },
  4: { buzzer: "Y", blue: "U", orange: "I", green: "O", yellow: "P" },
  5: { buzzer: "H", blue: "J", orange: "K", green: "L", yellow: "N" },
  6: { buzzer: "Num1", blue: "Num2", orange: "Num3", green: "Num4", yellow: "Num5" },
  7: { buzzer: "Num6", blue: "Num7", orange: "Num8", green: "Num9", yellow: "Num0" },
  8: { buzzer: "M", blue: "F", orange: "Comma", green: "Period", yellow: "Slash" },
};

// ── Static assets (embedded at compile time via Bun.file + new URL) ───────────
const ASSETS = new Map([
  ["/",                  Bun.file(new URL("./public/index.html",        import.meta.url))],
  ["/index.html",        Bun.file(new URL("./public/index.html",        import.meta.url))],
  ["/controller.html",   Bun.file(new URL("./public/controller.html",   import.meta.url))],
  ["/instructions.html", Bun.file(new URL("./public/instructions.html", import.meta.url))],
  ["/style.css",         Bun.file(new URL("./public/style.css",         import.meta.url))],
  ["/app.js",            Bun.file(new URL("./public/app.js",            import.meta.url))],
  ["/lang.js",           Bun.file(new URL("./public/lang.js",           import.meta.url))],
  ["/buzz-logo.png",     Bun.file(new URL("./public/buzz-logo.png",     import.meta.url))],
  ["/buzz-logo-black.svg", Bun.file(new URL("./public/buzz-logo-black.svg", import.meta.url))],
]);

// ── PowerShell keyboard (replaces nut-js) ─────────────────────────────────────
// SendKeys format mapping for each KEYMAP key name
const SK = {
  Q:"q", W:"w", E:"e", R:"r", T:"t",
  A:"a", S:"s", D:"d", F:"f", G:"g",
  Z:"z", X:"x", C:"c", V:"v", B:"b",
  Y:"y", U:"u", I:"i", O:"o", P:"p",
  H:"h", J:"j", K:"k", L:"l", N:"n", M:"m",
  Num0:"{NUMPAD0}", Num1:"{NUMPAD1}", Num2:"{NUMPAD2}", Num3:"{NUMPAD3}",
  Num4:"{NUMPAD4}", Num5:"{NUMPAD5}", Num6:"{NUMPAD6}", Num7:"{NUMPAD7}",
  Num8:"{NUMPAD8}", Num9:"{NUMPAD9}",
  Comma:",", Period:".", Slash:"/",
};

const psProc = spawn("powershell", [
  "-NoProfile", "-NonInteractive", "-Command",
  "Add-Type -Assembly System.Windows.Forms; $r=[Console]::In; while(($l=$r.ReadLine()) -ne $null){if($l){[System.Windows.Forms.SendKeys]::SendWait($l)}}",
], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
psProc.on("error", (e) => console.error("[ps]", e.message));

function tapKey(player, button) {
  const map = KEYMAP[player];
  if (!map) return;
  const sk = SK[map[button]];
  if (sk && psProc.stdin) psProc.stdin.write(sk + "\n");
}

// ── LAN IP ────────────────────────────────────────────────────────────────────
function getLanIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const isCgnat = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(iface.address);
      const isPrivateLan = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(iface.address);
      candidates.push({ addr: iface.address, isCgnat, isPrivateLan });
    }
  }
  const pick = candidates.find(c => c.isPrivateLan && !c.isCgnat)
            || candidates.find(c => !c.isCgnat)
            || candidates[0];
  return pick ? pick.addr : "127.0.0.1";
}

// ── Cloudflare Tunnel ─────────────────────────────────────────────────────────
const CF_LOCAL = path.join(import.meta.dir, "cloudflared.exe");
const CF_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

let tunnelUrl = null;
let cfFound = null;
let install = { running: false, progress: 0, error: null };

function startTunnel(cfPath) {
  if (!cfPath) cfPath = fs.existsSync(CF_LOCAL) ? CF_LOCAL : "cloudflared";
  tunnelUrl = null;
  const cf = spawn(cfPath, ["tunnel", "--url", `http://localhost:${PORT}`], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  cf.on("spawn", () => { cfFound = true; });
  cf.on("error", (err) => { if (err.code === "ENOENT") { cfFound = false; } });
  const onData = (d) => {
    const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnelUrl) { tunnelUrl = m[0]; console.log(`[tunnel] ${tunnelUrl}`); }
  };
  cf.stdout.on("data", onData);
  cf.stderr.on("data", onData);
}

startTunnel();

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const follow = (url, hops = 0) => {
      if (hops > 10) return reject(new Error("Too many redirects"));
      const mod = url.startsWith("https") ? https : http;
      mod.get(url, { headers: { "User-Agent": "BuzzCast" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); return follow(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const tmp = dest + ".tmp";
        const file = fs.createWriteStream(tmp);
        res.on("data", (chunk) => { received += chunk.length; if (total) onProgress(Math.round(received / total * 100)); });
        res.pipe(file);
        file.on("finish", () => file.close(() => fs.rename(tmp, dest, (e) => e ? reject(e) : resolve())));
        file.on("error", reject);
        res.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

// ── QR helper ─────────────────────────────────────────────────────────────────
function genQr(url) {
  return QRCode.toString(url, { type: "svg", width: 420, margin: 2, color: { dark: "#120821", light: "#ffffff" } });
}

// ── Host page HTML ────────────────────────────────────────────────────────────
async function hostPage() {
  const ip = getLanIp();
  const url = `http://${ip}:${PORT}`;
  const qrSvg = await genQr(url);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>BuzzCast — Host</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%; width: 100%; overflow: hidden;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 50% 0%, #2a1147 0%, #120821 60%, #0a0413 100%);
      color: #fff;
    }
    body { display: flex; align-items: center; justify-content: center; padding: 3vh 4vw; height: 100%; }
    .columns { display: flex; gap: 6vw; align-items: center; justify-content: center; width: 100%; height: 100%; }
    .left { display: flex; flex-direction: column; justify-content: center; gap: 2.5vh; flex: 1; max-width: 520px; }
    .logo { height: clamp(120px, 22vh, 200px); width: auto; align-self: flex-start; }
    .left h2 { font-size: clamp(1rem, 2vw, 1.5rem); color: #ffd23f; font-weight: 800; letter-spacing: 0.5px; }
    .steps { display: flex; flex-direction: column; gap: 1.6vh; }
    .step { display: flex; align-items: flex-start; gap: 1vw; }
    .step-num { flex-shrink: 0; width: clamp(26px, 2.8vw, 40px); height: clamp(26px, 2.8vw, 40px); border-radius: 50%; background: linear-gradient(180deg, #6a2cc9, #4a1a99); display: flex; align-items: center; justify-content: center; font-size: clamp(0.7rem, 1.2vw, 1rem); font-weight: 800; }
    .step-text { font-size: clamp(0.8rem, 1.4vw, 1.1rem); line-height: 1.4; opacity: 0.88; padding-top: 0.1em; }
    .lang-row { display: flex; gap: 8px; margin-top: 0.5vh; }
    .flag-btn { background: none; border: 2px solid transparent; cursor: pointer; font-size: clamp(1.1rem, 2vw, 1.6rem); padding: 3px 6px; border-radius: 8px; opacity: 0.4; transition: opacity 0.15s, border-color 0.15s; line-height: 1; }
    .flag-btn:hover { opacity: 0.8; }
    .flag-btn.active { opacity: 1; border-color: rgba(255,255,255,0.3); }
    .close-btn { position: fixed; top: 20px; right: 24px; width: clamp(48px, 5vw, 64px); height: clamp(48px, 5vw, 64px); border-radius: 50%; border: none; background: radial-gradient(circle at 50% 35%, #ff3b3b, #c1121f 65%, #8e0d18 100%); box-shadow: 0 5px 0 #6e0a12, 0 8px 18px rgba(0,0,0,0.5); color: #fff; font-size: clamp(1.4rem, 2.4vw, 2rem); font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.08s, box-shadow 0.08s; z-index: 100; line-height: 1; }
    .close-btn:active { transform: translateY(4px); box-shadow: 0 1px 0 #6e0a12, 0 3px 8px rgba(0,0,0,0.4); }
    .right { display: flex; flex-direction: column; align-items: center; gap: 2vh; flex-shrink: 0; }
    .tabs { display: flex; background: rgba(255,255,255,0.08); border-radius: 12px; padding: 4px; gap: 4px; }
    .tab { flex: 1; padding: clamp(6px,1vh,10px) clamp(16px,2.5vw,32px); border: none; border-radius: 9px; background: transparent; color: rgba(255,255,255,0.45); font-size: clamp(0.85rem, 1.4vw, 1.1rem); font-weight: 700; cursor: pointer; transition: background 0.15s, color 0.15s; white-space: nowrap; }
    .tab.active { background: linear-gradient(180deg, #6a2cc9, #4a1a99); color: #fff; }
    .tab-panel { display: none; flex-direction: column; align-items: center; gap: 2vh; }
    .tab-panel.visible { display: flex; }
    .qr-wrap { border-radius: 18px; padding: clamp(10px, 1.5vw, 20px); line-height: 0; min-width: clamp(180px, 30vw, 380px); min-height: clamp(180px, 30vw, 380px); display: flex; align-items: center; justify-content: center; transition: background 0.3s, box-shadow 0.3s; }
    .qr-wrap.has-qr { background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
    .qr-wrap svg { display: block; width: clamp(180px, 30vw, 380px); height: auto; }
    .remote-state { color: #ccc; font-size: clamp(0.8rem, 1.3vw, 1rem); text-align: center; padding: 16px; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
    .url { font-size: clamp(0.9rem, 1.8vw, 1.4rem); font-weight: 700; letter-spacing: 0.5px; color: #ffd23f; text-align: center; word-break: break-all; max-width: clamp(180px, 32vw, 420px); }
  </style>
</head>
<body>
  <button class="close-btn" onclick="shutdown()" title="Shut down BuzzCast">✕</button>
  <div class="columns">
    <div class="left">
      <img class="logo" src="/buzz-logo.png" alt="BuzzCast"/>
      <h2 id="host-title"></h2>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text" id="s1"></div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text" id="s2"></div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text" id="s3"></div></div>
        <div class="step"><div class="step-num">4</div><div class="step-text" id="s4"></div></div>
      </div>
      <div class="lang-row">
        <button class="flag-btn" data-lang="en" onclick="setLang('en')" title="English">🇬🇧</button>
        <button class="flag-btn" data-lang="pt" onclick="setLang('pt')" title="Português">🇵🇹</button>
      </div>
    </div>
    <div class="right">
      <div class="tabs">
        <button class="tab active" id="tab-local" onclick="switchTab('local')">Local</button>
        <button class="tab" id="tab-remote" onclick="switchTab('remote')">Remote</button>
      </div>
      <div class="tab-panel visible" id="panel-local">
        <div class="qr-wrap has-qr">${qrSvg}</div>
        <div class="url">${url}</div>
      </div>
      <div class="tab-panel" id="panel-remote">
        <div class="qr-wrap" id="remote-qr-wrap">
          <div id="remote-inner" class="remote-state" style="width:100%;height:100%"></div>
        </div>
        <div class="url" id="remote-url"></div>
        <button id="uninstall-btn" onclick="doUninstall()" style="display:none;background:rgba(200,30,30,0.75);border:none;border-radius:8px;color:#fff;font-size:clamp(0.65rem,1vw,0.85rem);font-weight:600;padding:5px 14px;cursor:pointer;opacity:0.8;transition:opacity 0.15s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.8">Uninstall cloudflared</button>
      </div>
    </div>
  </div>
  <script>
    const HOST_T = {
      en: { title:"How to join", s1:"Connect to the <strong>same WiFi</strong> as this PC.", s2:"Open your phone camera and scan the <strong>QR code →</strong>", s3:"Pick a free slot and enter your name.", s4:"Press the buttons and <strong>play!</strong>", tab_local:"Local", tab_remote:"Remote", tunnel_starting:"⏳ Starting tunnel…", not_found:"Cloudflared wasn't detected in your system, would you like to install? You can remove it later.", install_btn:"Install (≈35 MB)", installing:"Downloading cloudflared…", install_error:"Install failed:", retry_btn:"Retry" },
      pt: { title:"Como entrar", s1:"Liga-te à <strong>mesma rede WiFi</strong> que este PC.", s2:"Aponta a câmara do telemóvel ao <strong>código QR →</strong>", s3:"Escolhe o teu lugar e escreve o teu nome.", s4:"Carrega nos botões e <strong>joga!</strong>", tab_local:"Local", tab_remote:"Remoto", tunnel_starting:"⏳ A iniciar túnel…", not_found:"O Cloudflared não foi detetado no sistema. Deseja instalar? Pode removê-lo mais tarde.", install_btn:"Instalar (≈35 MB)", installing:"A transferir cloudflared…", install_error:"Erro na instalação:", retry_btn:"Tentar novamente" }
    };
    function getLang() { return localStorage.getItem("buzz_lang") || "en"; }
    function setLang(l) { localStorage.setItem("buzz_lang", l); location.reload(); }
    function tx(key) { const l = getLang(); return (HOST_T[l] || HOST_T.en)[key] || HOST_T.en[key]; }
    function applyHost() {
      const t = HOST_T[getLang()] || HOST_T.en;
      document.getElementById("host-title").textContent = t.title;
      document.getElementById("s1").innerHTML = t.s1;
      document.getElementById("s2").innerHTML = t.s2;
      document.getElementById("s3").innerHTML = t.s3;
      document.getElementById("s4").innerHTML = t.s4;
      document.getElementById("tab-local").textContent = t.tab_local;
      document.getElementById("tab-remote").textContent = t.tab_remote;
      document.querySelectorAll(".flag-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === getLang()));
    }
    function switchTab(name) {
      ["local","remote"].forEach(n => {
        document.getElementById("tab-"+n).classList.toggle("active", n===name);
        document.getElementById("panel-"+n).classList.toggle("visible", n===name);
      });
    }
    const inner = document.getElementById("remote-inner");
    const remoteUrl = document.getElementById("remote-url");
    let qrLoaded = false;
    function showLoading() { inner.innerHTML = \`⏳ \${tx("tunnel_starting")}\`; remoteUrl.textContent = ""; document.getElementById("uninstall-btn").style.display = "none"; }
    function showNotFound() {
      inner.innerHTML = \`<div style="text-align:center;padding:8px"><div style="font-size:clamp(0.78rem,1.25vw,1rem);opacity:0.85;margin-bottom:1.2em;line-height:1.5">\${tx("not_found")}</div><button onclick="doInstall()" style="background:linear-gradient(180deg,#6a2cc9,#4a1a99);border:none;border-radius:10px;color:#fff;font-size:clamp(0.85rem,1.4vw,1rem);font-weight:700;padding:10px 20px;cursor:pointer">\${tx("install_btn")}</button></div>\`;
      remoteUrl.textContent = ""; document.getElementById("uninstall-btn").style.display = "none";
    }
    function showInstalling(pct) {
      inner.innerHTML = \`<div style="text-align:center;width:clamp(140px,22vw,300px)"><div style="font-size:clamp(0.8rem,1.3vw,1rem);opacity:0.9;margin-bottom:1em">\${tx("installing")}</div><div style="background:rgba(255,255,255,0.12);border-radius:8px;height:10px;overflow:hidden"><div style="background:linear-gradient(90deg,#6a2cc9,#a855f7);height:100%;width:\${pct}%;border-radius:8px;transition:width 0.3s"></div></div><div style="font-size:clamp(0.75rem,1.1vw,0.9rem);opacity:0.6;margin-top:0.5em">\${pct}%</div></div>\`;
      remoteUrl.textContent = "";
    }
    function showError(msg) {
      inner.innerHTML = \`<div style="text-align:center"><div style="font-size:clamp(0.8rem,1.3vw,1rem);color:#ff5555;margin-bottom:0.4em">\${tx("install_error")}</div><div style="font-size:clamp(0.7rem,1.1vw,0.85rem);opacity:0.55;margin-bottom:1em">\${msg}</div><button onclick="doInstall()" style="background:rgba(255,255,255,0.12);border:none;border-radius:10px;color:#fff;font-size:clamp(0.8rem,1.2vw,0.95rem);font-weight:700;padding:8px 18px;cursor:pointer">\${tx("retry_btn")}</button></div>\`;
      remoteUrl.textContent = "";
    }
    async function showQR(qrUrl) {
      if (qrLoaded) return; qrLoaded = true;
      const res = await fetch("/api/qr?url=" + encodeURIComponent(qrUrl));
      inner.innerHTML = await res.text();
      document.getElementById("remote-qr-wrap").classList.add("has-qr");
      remoteUrl.textContent = qrUrl;
      document.getElementById("uninstall-btn").style.display = "inline-block";
    }
    async function doUninstall() {
      if (!confirm("Remove cloudflared from this computer?")) return;
      document.getElementById("uninstall-btn").style.display = "none";
      await fetch("/api/uninstall-cloudflared", { method: "POST" });
      qrLoaded = false; document.getElementById("remote-qr-wrap").classList.remove("has-qr"); pollRemote();
    }
    async function doInstall() { showInstalling(0); await fetch("/api/install-cloudflared", { method: "POST" }); }
    async function pollRemote() {
      try {
        const s = await fetch("/api/tunnel-status").then(r => r.json());
        if (s.tunnelUrl) { await showQR(s.tunnelUrl); return; }
        if (s.installError) showError(s.installError);
        else if (s.installing) showInstalling(s.installProgress);
        else if (s.cfFound === false) showNotFound();
        else showLoading();
      } catch { showLoading(); }
      setTimeout(pollRemote, 1500);
    }
    async function shutdown() { await fetch("/api/shutdown", { method: "POST" }).catch(()=>{}); window.close(); }
    applyHost(); showLoading(); pollRemote();
  </script>
</body>
</html>`;
}

// ── WebSocket state ───────────────────────────────────────────────────────────
const slots = {};
const names = {};
for (let p = 1; p <= PLAYERS; p++) { slots[p] = null; names[p] = null; }
const wsClients = new Set();

function takenMap() {
  const t = {};
  for (let p = 1; p <= PLAYERS; p++) t[p] = slots[p] !== null;
  return t;
}

function broadcastSlots() {
  const msg = JSON.stringify({ type: "slots", taken: takenMap(), names });
  for (const ws of wsClients) ws.send(msg);
}

// ── Bun.serve ─────────────────────────────────────────────────────────────────
Bun.serve({
  port: PORT,

  async fetch(req, server) {
    const { pathname, searchParams } = new URL(req.url);

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      server.upgrade(req, { data: { player: null } });
      return;
    }

    // ── API routes ────────────────────────────────────────────────────────
    if (pathname === "/host")
      return new Response(await hostPage(), { headers: { "Content-Type": "text/html;charset=utf-8" } });

    if (pathname === "/api/tunnel-status")
      return Response.json({ tunnelUrl, cfFound, cfInstalled: fs.existsSync(CF_LOCAL), installing: install.running, installProgress: install.progress, installError: install.error });

    if (pathname === "/api/install-cloudflared" && req.method === "POST") {
      if (install.running) return Response.json({ ok: false, reason: "already running" });
      install = { running: true, progress: 0, error: null };
      downloadFile(CF_URL, CF_LOCAL, (p) => { install.progress = p; })
        .then(() => { install.running = false; install.progress = 100; startTunnel(CF_LOCAL); })
        .catch((err) => { install.running = false; install.error = err.message; });
      return Response.json({ ok: true });
    }

    if (pathname === "/api/uninstall-cloudflared" && req.method === "POST") {
      try {
        if (fs.existsSync(CF_LOCAL)) fs.unlinkSync(CF_LOCAL);
        cfFound = false; tunnelUrl = null; install = { running: false, progress: 0, error: null };
        return Response.json({ ok: true });
      } catch (err) { return Response.json({ ok: false, error: err.message }); }
    }

    if (pathname === "/api/qr") {
      const target = searchParams.get("url");
      if (!target) return new Response("", { status: 400 });
      return new Response(await genQr(target), { headers: { "Content-Type": "image/svg+xml" } });
    }

    if (pathname === "/api/shutdown" && req.method === "POST") {
      setTimeout(() => process.exit(0), 300);
      return Response.json({ ok: true });
    }

    // ── Static files ──────────────────────────────────────────────────────
    const asset = ASSETS.get(pathname);
    if (asset) return new Response(asset);

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: "slots", taken: takenMap(), names }));
    },
    message(ws, raw) {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (data.type === "join") {
        const p = Number(data.player);
        if (!(p >= 1 && p <= PLAYERS)) {
          ws.send(JSON.stringify({ type: "join_result", ok: false, reason: "invalid slot" })); return;
        }
        if (slots[p] && slots[p] !== ws) {
          ws.send(JSON.stringify({ type: "join_result", ok: false, reason: "taken" })); return;
        }
        if (ws.data.player && ws.data.player !== p) {
          const old = ws.data.player;
          if (slots[old] === ws) { slots[old] = null; names[old] = null; }
        }
        ws.data.player = p;
        slots[p] = ws;
        names[p] = (typeof data.name === "string" && data.name.trim()) ? data.name.trim().slice(0, 20) : null;
        ws.send(JSON.stringify({ type: "join_result", ok: true, player: p, name: names[p] }));
        broadcastSlots();
      } else if (data.type === "press") {
        if (ws.data.player) tapKey(ws.data.player, data.button);
      } else if (data.type === "leave") {
        const p = ws.data.player;
        if (p && slots[p] === ws) { slots[p] = null; names[p] = null; ws.data.player = null; broadcastSlots(); }
      }
    },
    close(ws) {
      wsClients.delete(ws);
      const p = ws.data.player;
      if (p && slots[p] === ws) { slots[p] = null; names[p] = null; broadcastSlots(); }
    },
  },
});

exec(`cmd /c start http://localhost:${PORT}/host`);
console.log(`BuzzCast running on http://localhost:${PORT}`);
console.log(`Host: http://localhost:${PORT}/host`);
