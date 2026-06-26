import QRCode from "qrcode";
import os from "os";
import fs from "fs";
import https from "https";
import http from "http";
import { spawn } from "child_process";
import path from "path";
import { initKeyboard, tapToken } from "./keyboard/index.js";
import { openBrowser, CF as CFINFO, makeExecutable, extractTgz } from "./platform.js";
import pkg from "../package.json";   // bundled at compile time → version embedded

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
const VERSION = pkg.version;
const REPO = "bacoinz/buzzcast";
const PLAYERS = 8;
const KEYMAP = {
  1: { buzzer: "Q", blue: "W", orange: "E", green: "R", yellow: "T" },
  2: { buzzer: "A", blue: "S", orange: "D", green: "F", yellow: "G" },
  3: { buzzer: "Z", blue: "X", orange: "C", green: "V", yellow: "B" },
  4: { buzzer: "Y", blue: "U", orange: "I", green: "O", yellow: "P" },
  5: { buzzer: "H", blue: "J", orange: "K", green: "L", yellow: "N" },
  6: { buzzer: "1", blue: "2", orange: "3", green: "4", yellow: "5" },
  7: { buzzer: "6", blue: "7", orange: "8", green: "9", yellow: "0" },
  8: { buzzer: "M", blue: "Minus", orange: "Comma", green: "Period", yellow: "Backspace" },
};

// ── Static assets (embedded at compile time via Bun.file + new URL) ───────────
const ASSETS = new Map([
  ["/",                  Bun.file(new URL("../public/index.html",        import.meta.url))],
  ["/index.html",        Bun.file(new URL("../public/index.html",        import.meta.url))],
  ["/controller.html",   Bun.file(new URL("../public/controller.html",   import.meta.url))],
  ["/instructions.html", Bun.file(new URL("../public/instructions.html", import.meta.url))],
  ["/style.css",         Bun.file(new URL("../public/style.css",         import.meta.url))],
  ["/app.js",            Bun.file(new URL("../public/app.js",            import.meta.url))],
  ["/lang.js",           Bun.file(new URL("../public/lang.js",           import.meta.url))],
  ["/buzz-logo.png",     Bun.file(new URL("../public/buzz-logo.png",     import.meta.url))],
  ["/buzz-logo-black.svg", Bun.file(new URL("../public/buzz-logo-black.svg", import.meta.url))],
]);

// ── Keyboard emulation (per-platform backend) ─────────────────────────────────
// The actual OS key injection lives in ./keyboard/{windows,linux,macos}.js, picked
// at runtime by ./keyboard/index.js. SK maps each KEYMAP key name to a "send token":
// a single char, or "#XX" = raw key code in hex (e.g. "#08" = Backspace).
const SK = {
  Q:"q", W:"w", E:"e", R:"r", T:"t",
  A:"a", S:"s", D:"d", F:"f", G:"g",
  Z:"z", X:"x", C:"c", V:"v", B:"b",
  Y:"y", U:"u", I:"i", O:"o", P:"p",
  H:"h", J:"j", K:"k", L:"l", N:"n", M:"m",
  "0":"0", "1":"1", "2":"2", "3":"3", "4":"4",
  "5":"5", "6":"6", "7":"7", "8":"8", "9":"9",
  Comma:",", Period:".", Minus:"-",
  // Named keys sent by raw virtual-key code (prefix "#", hex). Layout-independent.
  Backspace:"#08",
};

initKeyboard();

// ── Effective keymap (editable + persisted) ───────────────────────────────────
// player → button → "send token": a single char (typed via VkKeyScanW) or a raw
// virtual-key in hex prefixed with "#" (e.g. "#08" = Backspace). Defaults derive
// from KEYMAP + SK; the host "Keybinds" page can override and persist them.
const BUTTONS = ["buzzer", "blue", "orange", "green", "yellow"];
const KEYMAP_FILE = path.join(import.meta.dir, "keymap.json");

function defaultKeymap() {
  const km = {};
  for (let p = 1; p <= PLAYERS; p++) {
    km[p] = {};
    for (const b of BUTTONS) km[p][b] = SK[KEYMAP[p][b]];
  }
  return km;
}

function sanitizeKeymap(input) {
  const km = defaultKeymap();
  if (input && typeof input === "object") {
    for (let p = 1; p <= PLAYERS; p++) {
      const src = input[p];
      if (!src) continue;
      for (const b of BUTTONS) {
        const v = src[b];
        if (typeof v === "string" && v.length >= 1 && v.length <= 4) km[p][b] = v;
      }
    }
  }
  return km;
}

let keymap = defaultKeymap();
try {
  if (fs.existsSync(KEYMAP_FILE)) keymap = sanitizeKeymap(JSON.parse(fs.readFileSync(KEYMAP_FILE, "utf8")));
} catch (e) { console.error("[keymap] load failed:", e.message); }

function tapKey(player, button) {
  const km = keymap[player];
  if (!km) return;
  tapToken(km[button]);
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
const CF_LOCAL = path.join(import.meta.dir, CFINFO.filename);
const CF_URL = CFINFO.url;

let tunnelUrl = null;
let cfFound = null;
let install = { running: false, progress: 0, error: null };

function startTunnel(cfPath) {
  if (!cfPath) cfPath = fs.existsSync(CF_LOCAL) ? CF_LOCAL : "cloudflared";
  if (cfPath === CF_LOCAL) makeExecutable(cfPath);   // ensure +x on Linux/macOS
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

// ── Auto-update check (GitHub Releases) ───────────────────────────────────────
let updateInfo = { current: VERSION, latest: null, updateAvailable: false, url: `https://github.com/${REPO}/releases`, checkedAt: 0 };

function isNewer(a, b) {   // true if a > b ("1.3" > "1.2")
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function checkForUpdate() {
  return new Promise((resolve) => {
    https.get(`https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { "User-Agent": "BuzzCast", "Accept": "application/vnd.github+json" } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(updateInfo); }
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => {
          try {
            const tag = (JSON.parse(body).tag_name || "").replace(/^v/i, "");
            if (tag) updateInfo = {
              current: VERSION, latest: tag, updateAvailable: isNewer(tag, VERSION),
              url: `https://github.com/${REPO}/releases/latest`, checkedAt: Date.now(),
            };
          } catch {}
          resolve(updateInfo);
        });
      }).on("error", () => resolve(updateInfo));
  });
}
checkForUpdate();   // fire once at startup

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
    .players-ping { position: fixed; left: 20px; bottom: 18px; display: none; flex-direction: column; gap: 4px; font-size: clamp(0.65rem, 1vw, 0.8rem); z-index: 90; }
    .players-ping.show { display: flex; }
    .pp-row { display: flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.06); border-radius: 8px; padding: 3px 9px; }
    .pp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .pp-name { color: rgba(255,255,255,0.7); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp-ms { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; opacity: 0.85; }
    .host-footer { position: fixed; bottom: 12px; left: 0; right: 0; text-align: center; opacity: 0.35; font-size: clamp(0.7rem, 1.1vw, 0.85rem); z-index: 80; }
    .host-footer a { color: #fff; text-decoration: none; }
    .host-footer a:hover { opacity: 0.7; }
    /* Update banner */
    .update-banner { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); display: none; align-items: center; gap: 12px; background: linear-gradient(180deg,#6a2cc9,#4a1a99); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 9px 16px; font-size: clamp(0.75rem,1.2vw,0.95rem); font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,0.45); z-index: 150; }
    .update-banner.show { display: flex; }
    .update-banner a { background: #ffd23f; color: #2a1147; border-radius: 8px; padding: 4px 12px; text-decoration: none; font-weight: 800; white-space: nowrap; }
    .update-banner a:hover { opacity: 0.9; }
    .update-banner .ub-x { cursor: pointer; opacity: 0.7; font-weight: 700; }
    .update-banner .ub-x:hover { opacity: 1; }
    /* Pill buttons (Keybinds + Instructions) */
    .pill-btn { display: inline-flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; color: rgba(255,255,255,0.8); font-size: clamp(0.7rem,1.1vw,0.85rem); font-weight: 600; padding: 5px 12px; text-decoration: none; cursor: pointer; transition: background 0.15s; white-space: nowrap; font-family: inherit; }
    .pill-btn:hover { background: rgba(255,255,255,0.16); }
    /* Keybinds modal */
    .modal-overlay { position: fixed; inset: 0; background: rgba(5,2,12,0.82); backdrop-filter: blur(4px); display: none; align-items: center; justify-content: center; z-index: 200; padding: 3vh 2vw; }
    .modal-overlay.show { display: flex; }
    .modal { background: linear-gradient(180deg,#1c0d36,#100720); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); width: 100%; max-width: 1340px; max-height: 94vh; display: flex; flex-direction: column; }
    .modal.modal-narrow { max-width: 640px; }
    .instr-body { font-size: clamp(0.85rem,1.3vw,1rem); line-height: 1.5; color: rgba(255,255,255,0.88); }
    .instr-body h4 { color: #ffd23f; font-size: clamp(0.95rem,1.5vw,1.15rem); margin: 18px 0 6px; }
    .instr-body h4:first-child { margin-top: 0; }
    .instr-body ol { margin: 0 0 4px 1.2em; display: flex; flex-direction: column; gap: 5px; }
    .instr-body strong { color: #fff; }
    .instr-body .notice { background: rgba(193,18,31,0.18); border: 1px solid rgba(255,80,80,0.4); border-radius: 10px; padding: 9px 13px; margin-bottom: 12px; font-size: clamp(0.78rem,1.15vw,0.92rem); }
    .instr-body .tip { background: rgba(106,44,201,0.18); border: 1px solid rgba(168,85,247,0.4); border-radius: 10px; padding: 9px 13px; margin-top: 14px; font-size: clamp(0.78rem,1.15vw,0.92rem); }
    .modal-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 22px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .modal-head h3 { font-size: clamp(1.05rem,1.8vw,1.35rem); color: #ffd23f; font-weight: 800; }
    .modal-hint { font-size: clamp(0.68rem,1vw,0.82rem); color: rgba(255,255,255,0.5); }
    .modal-body { padding: 18px 22px; overflow: auto; }
    .kb-grid { display: flex; gap: 14px; width: 100%; justify-content: center; }
    .kb-player { flex: 1 1 0; min-width: 0; max-width: 116px; display: flex; flex-direction: column; align-items: center; gap: 9px; }
    .kb-col { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 12px; display: flex; flex-direction: column; align-items: center; gap: 11px; }
    .kb-pnum { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(180deg,#6a2cc9,#4a1a99); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.9rem; }
    .kb-ctrl { width: 100%; display: flex; justify-content: center; }
    .kb-shape { cursor: pointer; transition: background 0.1s, box-shadow 0.1s; user-select: none; display: flex; align-items: center; justify-content: center; }
    .kb-round { width: min(72px, 100%); aspect-ratio: 1; border-radius: 50%; border: 3px solid var(--c); }
    .kb-rect { width: 100%; height: 34px; border-radius: 9px; border: 3px solid var(--c); }
    .kb-shape.active { background: var(--c); box-shadow: 0 0 16px var(--c); }
    .kb-input { width: 44px; text-align: center; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.22); border-radius: 7px; color: #fff; font-size: 0.85rem; font-weight: 800; padding: 5px 2px; cursor: pointer; font-family: inherit; }
    .kb-input:focus, .kb-input.capturing { outline: none; border-color: #ffd23f; background: rgba(0,0,0,0.65); color: #ffd23f; box-shadow: 0 0 0 2px rgba(255,210,63,0.45); }
    .modal-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid rgba(255,255,255,0.1); }
    .modal-foot .reset { margin-right: auto; }
    .btn-primary, .btn-ghost { border: none; border-radius: 10px; font-size: clamp(0.8rem,1.2vw,0.95rem); font-weight: 700; padding: 9px 20px; cursor: pointer; font-family: inherit; transition: opacity 0.15s, background 0.15s; }
    .btn-primary { background: linear-gradient(180deg,#6a2cc9,#4a1a99); color: #fff; }
    .btn-ghost { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.85); }
    .btn-primary:hover { opacity: 0.9; } .btn-ghost:hover { background: rgba(255,255,255,0.18); }
  </style>
</head>
<body>
  <button class="close-btn" onclick="shutdown()" title="Shut down BuzzCast">✕</button>
  <div class="update-banner" id="update-banner">
    <span id="update-text"></span>
    <a id="update-link" href="https://github.com/bacoinz/buzzcast/releases/latest" target="_blank"></a>
    <span class="ub-x" onclick="document.getElementById('update-banner').classList.remove('show')">✕</span>
  </div>
  <div class="players-ping" id="players-ping"></div>
  <div class="host-footer"><a href="https://github.com/bacoinz/buzz-cast" target="_blank">GitHub</a></div>
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
        <button class="pill-btn" id="kb-btn" onclick="openKeybinds()">🎮 <span id="kb-btn-label"></span></button>
        <button class="pill-btn" id="instr-btn" onclick="openInstructions()">📋 <span id="instr-btn-label"></span></button>
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

  <div class="modal-overlay" id="kb-modal">
    <div class="modal">
      <div class="modal-head">
        <h3 id="kb-title"></h3>
        <span class="modal-hint" id="kb-hint"></span>
      </div>
      <div class="modal-body"><div class="kb-grid" id="kb-grid"></div></div>
      <div class="modal-foot">
        <button class="btn-ghost reset" id="kb-reset" onclick="resetKeybinds()"></button>
        <button class="btn-ghost" id="kb-back" onclick="closeKeybinds()"></button>
        <button class="btn-primary" id="kb-save" onclick="saveKeybinds()"></button>
      </div>
    </div>
  </div>

  <div class="modal-overlay" id="instr-modal">
    <div class="modal modal-narrow">
      <div class="modal-head"><h3 id="instr-title"></h3></div>
      <div class="modal-body instr-body" id="instr-content"></div>
      <div class="modal-foot">
        <button class="btn-primary" id="instr-close" onclick="closeInstructions()"></button>
      </div>
    </div>
  </div>

  <script>
    const HOST_T = {
      en: { title:"How to join", s1:"Connect to the <strong>same WiFi</strong> as this PC.", s2:"Open your phone camera and scan the <strong>QR code →</strong>", s3:"Pick a free slot and enter your name.", s4:"Press the buttons and <strong>play!</strong>", tab_local:"Local", tab_remote:"Remote", tunnel_starting:"⏳ Starting tunnel…", not_found:"Cloudflared wasn't detected in your system, would you like to install? You can remove it later.", install_btn:"Install (≈35 MB)", installing:"Downloading cloudflared…", install_error:"Install failed:", retry_btn:"Retry", kb_btn:"Keybinds", instr_btn:"PCSX2 Instructions", kb_title:"Keybinds", kb_hint:"Click a key field and press the key you want · click a button to test it", kb_save:"Save", kb_back:"Back", kb_reset:"Reset defaults", instr_title:"PCSX2 Setup", instr_close:"Close", update_text:v=>"New version "+v+" available!", update_btn:"Download" },
      pt: { title:"Como entrar", s1:"Liga-te à <strong>mesma rede WiFi</strong> que este PC.", s2:"Aponta a câmara do telemóvel ao <strong>código QR →</strong>", s3:"Escolhe o teu lugar e escreve o teu nome.", s4:"Carrega nos botões e <strong>joga!</strong>", tab_local:"Local", tab_remote:"Remoto", tunnel_starting:"⏳ A iniciar túnel…", not_found:"O Cloudflared não foi detetado no sistema. Deseja instalar? Pode removê-lo mais tarde.", install_btn:"Instalar (≈35 MB)", installing:"A transferir cloudflared…", install_error:"Erro na instalação:", retry_btn:"Tentar novamente", kb_btn:"Teclas", instr_btn:"Instruções PCSX2", kb_title:"Configurar Teclas", kb_hint:"Clica num campo e prime a tecla que queres · clica num botão para testar", kb_save:"Guardar", kb_back:"Voltar", kb_reset:"Repor predefinições", instr_title:"Configurar PCSX2", instr_close:"Fechar", update_text:v=>"Nova versão "+v+" disponível!", update_btn:"Transferir" }
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
      document.getElementById("kb-btn-label").textContent = t.kb_btn;
      document.getElementById("instr-btn-label").textContent = t.instr_btn;
      document.getElementById("kb-title").textContent = t.kb_title;
      document.getElementById("kb-hint").textContent = t.kb_hint;
      document.getElementById("kb-save").textContent = t.kb_save;
      document.getElementById("kb-back").textContent = t.kb_back;
      document.getElementById("kb-reset").textContent = t.kb_reset;
      document.getElementById("instr-title").textContent = t.instr_title;
      document.getElementById("instr-close").textContent = t.instr_close;
      document.querySelectorAll(".flag-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === getLang()));
    }

    // ── PCSX2 instructions (popup) ──
    const HOST_INSTR = {
      en: '<div class="notice">⚠️ Works only with <strong>PCSX2</strong>. <strong>Buzz!: The Music Quiz</strong> (the first game) supports only 4 players, not 8.</div>'
        + '<h4>1. Configure PCSX2 — up to 4 players</h4>'
        + '<ol><li>In PCSX2 open <strong>Settings → Controllers</strong>.</li><li>Select <strong>USB Port 1</strong> and choose <strong>Buzz! Controller</strong>.</li><li>Map each button to the key shown in the <strong>🎮 Keybinds</strong> menu.</li></ol>'
        + '<h4>2. For 5–8 players — add USB 2</h4>'
        + '<ol><li>Still in <strong>Settings → Controllers</strong>, select <strong>USB Port 2</strong>.</li><li>Choose <strong>Buzz! Controller</strong> again and map players 5–8.</li></ol>'
        + '<h4>3. Play</h4>'
        + '<ol><li>Start the game in PCSX2.</li><li>Keep the <strong>PCSX2 window in focus</strong> — required to receive button presses.</li></ol>'
        + '<div class="tip">💡 Open the <strong>🎮 Keybinds</strong> menu to see or change which keyboard key each button sends, then map the same keys in PCSX2.</div>',
      pt: '<div class="notice">⚠️ Funciona apenas com o <strong>PCSX2</strong>. O <strong>Buzz!: The Music Quiz</strong> (o primeiro jogo) suporta apenas 4 jogadores, não 8.</div>'
        + '<h4>1. Configurar o PCSX2 — até 4 jogadores</h4>'
        + '<ol><li>No PCSX2 abre <strong>Settings → Controllers</strong>.</li><li>Seleciona <strong>USB Port 1</strong> e escolhe <strong>Buzz! Controller</strong>.</li><li>Mapeia cada botão para a tecla indicada no menu <strong>🎮 Teclas</strong>.</li></ol>'
        + '<h4>2. Para 5–8 jogadores — adiciona USB 2</h4>'
        + '<ol><li>Ainda em <strong>Settings → Controllers</strong>, seleciona <strong>USB Port 2</strong>.</li><li>Escolhe novamente <strong>Buzz! Controller</strong> e mapeia os jogadores 5–8.</li></ol>'
        + '<h4>3. Jogar</h4>'
        + '<ol><li>Inicia o jogo no PCSX2.</li><li>Mantém a <strong>janela do PCSX2 em foco</strong> — necessário para receber os botões.</li></ol>'
        + '<div class="tip">💡 Abre o menu <strong>🎮 Teclas</strong> para ver ou alterar que tecla cada botão envia e mapeia as mesmas teclas no PCSX2.</div>'
    };
    function openInstructions() {
      document.getElementById("instr-content").innerHTML = HOST_INSTR[getLang()] || HOST_INSTR.en;
      document.getElementById("instr-modal").classList.add("show");
    }
    function closeInstructions() { document.getElementById("instr-modal").classList.remove("show"); }

    // ── Keybinds editor ──
    const KB_BUTTONS = [
      { key:"buzzer", color:"#ff3b3b", shape:"round" },
      { key:"blue",   color:"#2b6fd6", shape:"rect" },
      { key:"orange", color:"#ff8c1a", shape:"rect" },
      { key:"green",  color:"#33cc55", shape:"rect" },
      { key:"yellow", color:"#ffd23f", shape:"rect" },
    ];
    const KEY_TO_VK = { Backspace:"#08", Tab:"#09", Enter:"#0d", Escape:"#1b", Delete:"#2e", Insert:"#2d", Home:"#24", End:"#23", PageUp:"#21", PageDown:"#22", ArrowLeft:"#25", ArrowUp:"#26", ArrowRight:"#27", ArrowDown:"#28" };
    const VK_LABEL = { "#08":"⌫", "#09":"Tab", "#0d":"Enter", "#1b":"Esc", "#2e":"Del", "#2d":"Ins", "#24":"Home", "#23":"End", "#21":"PgUp", "#22":"PgDn", "#25":"←", "#26":"↑", "#27":"→", "#28":"↓" };
    let kbData = null;
    function flashShape(p, b) {
      const el = document.querySelector('.kb-shape[data-player="' + p + '"][data-btn="' + b + '"]');
      if (!el) return;
      el.classList.add("active");
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove("active"), 220);
    }
    function tokenLabel(tok) {
      if (!tok) return "—";
      if (tok[0] === "#") return VK_LABEL[tok] || ("VK" + tok.slice(1));
      return tok === " " ? "Space" : tok.toUpperCase();
    }
    function keyToToken(e) {
      if (e.key && e.key.length === 1) return e.key.toLowerCase();
      return KEY_TO_VK[e.key] || null;
    }
    function buildKbGrid() {
      const grid = document.getElementById("kb-grid");
      grid.innerHTML = "";
      for (let p = 1; p <= 8; p++) {
        const wrap = document.createElement("div");
        wrap.className = "kb-player";
        wrap.innerHTML = '<div class="kb-pnum">' + p + '</div>';
        const col = document.createElement("div");
        col.className = "kb-col";
        for (const b of KB_BUTTONS) {
          const ctrl = document.createElement("div");
          ctrl.className = "kb-ctrl";
          const shape = document.createElement("div");
          shape.className = "kb-shape " + (b.shape === "round" ? "kb-round" : "kb-rect");
          shape.style.setProperty("--c", b.color);
          shape.dataset.player = p; shape.dataset.btn = b.key;
          shape.onclick = () => flashShape(p, b.key);
          const inp = document.createElement("input");
          inp.className = "kb-input"; inp.readOnly = true; inp.value = tokenLabel(kbData[p][b.key]);
          inp.onclick = (e) => e.stopPropagation();
          inp.onfocus = () => inp.classList.add("capturing");
          inp.onblur = () => inp.classList.remove("capturing");
          inp.onkeydown = (e) => {
            e.preventDefault();
            const tok = keyToToken(e);
            if (!tok) return;
            kbData[p][b.key] = tok; inp.value = tokenLabel(tok); inp.blur();
          };
          shape.appendChild(inp); ctrl.appendChild(shape); col.appendChild(ctrl);
        }
        wrap.appendChild(col);
        grid.appendChild(wrap);
      }
    }
    async function openKeybinds() {
      kbData = await fetch("/api/keymap").then(r => r.json());
      buildKbGrid();
      document.getElementById("kb-modal").classList.add("show");
    }
    function closeKeybinds() { document.getElementById("kb-modal").classList.remove("show"); }
    async function resetKeybinds() { kbData = await fetch("/api/keymap?defaults=1").then(r => r.json()); buildKbGrid(); }
    async function saveKeybinds() {
      await fetch("/api/keymap", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(kbData) });
      closeKeybinds();
    }
    document.getElementById("kb-modal").addEventListener("click", (e) => { if (e.target.id === "kb-modal") closeKeybinds(); });
    document.getElementById("instr-modal").addEventListener("click", (e) => { if (e.target.id === "instr-modal") closeInstructions(); });
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

    // ── Live player latency (spectator WebSocket) ──
    const ppBox = document.getElementById("players-ping");
    function renderPings(taken, names, pings) {
      const rows = [];
      for (let p = 1; p <= 8; p++) {
        if (!taken || !taken[p]) continue;
        const ms = pings && pings[p] != null ? pings[p] : null;
        const color = ms == null ? "#888" : ms < 80 ? "#3ddc6d" : ms < 200 ? "#ffd23f" : "#ff5555";
        const nm = (names && names[p]) ? names[p] : ("P" + p);
        const msTxt = ms == null ? "…" : ms + "ms";
        rows.push('<div class="pp-row"><span class="pp-dot" style="background:'+color+'"></span><span class="pp-name">'+nm.replace(/</g,"&lt;")+'</span><span class="pp-ms" style="color:'+color+'">'+msTxt+'</span></div>');
      }
      ppBox.innerHTML = rows.join("");
      ppBox.classList.toggle("show", rows.length > 0);
    }
    function connectSpectator() {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sws = new WebSocket(proto + "//" + location.host);
      sws.onmessage = (ev) => {
        try { const m = JSON.parse(ev.data); if (m.type === "slots") renderPings(m.taken, m.names, m.pings); else if (m.type === "press") flashShape(m.player, m.button); } catch {}
      };
      sws.onclose = () => setTimeout(connectSpectator, 2000);
    }
    connectSpectator();

    async function checkUpdate() {
      try {
        const u = await fetch("/api/update-check").then(r => r.json());
        if (!u.updateAvailable) return;
        const tf = tx("update_text");
        document.getElementById("update-text").textContent = typeof tf === "function" ? tf(u.latest) : tf;
        const link = document.getElementById("update-link");
        link.textContent = tx("update_btn");
        if (u.url) link.href = u.url;
        document.getElementById("update-banner").classList.add("show");
      } catch {}
    }

    applyHost(); showLoading(); pollRemote(); checkUpdate();
  </script>
</body>
</html>`;
}

// ── WebSocket state ───────────────────────────────────────────────────────────
const slots = {};
const names = {};
const pings = {};
for (let p = 1; p <= PLAYERS; p++) { slots[p] = null; names[p] = null; pings[p] = null; }
const wsClients = new Set();

function takenMap() {
  const t = {};
  for (let p = 1; p <= PLAYERS; p++) t[p] = slots[p] !== null;
  return t;
}

function broadcastSlots() {
  const msg = JSON.stringify({ type: "slots", taken: takenMap(), names, pings });
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
      // macOS ships cloudflared as a .tgz: download it, then extract the binary.
      const dlTarget = CFINFO.isTgz ? CF_LOCAL + ".tgz" : CF_LOCAL;
      downloadFile(CF_URL, dlTarget, (p) => { install.progress = p; })
        .then(() => CFINFO.isTgz ? extractTgz(dlTarget, CF_LOCAL) : makeExecutable(CF_LOCAL))
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

    if (pathname === "/api/keymap" && req.method === "GET")
      return Response.json(searchParams.get("defaults") ? defaultKeymap() : keymap);

    if (pathname === "/api/keymap" && req.method === "POST") {
      try {
        keymap = sanitizeKeymap(await req.json());
        fs.writeFileSync(KEYMAP_FILE, JSON.stringify(keymap, null, 2));
        return Response.json({ ok: true });
      } catch (err) { return Response.json({ ok: false, error: err.message }); }
    }

    if (pathname === "/api/update-check") {
      // Re-check at most once an hour; otherwise serve the cached result.
      if (Date.now() - updateInfo.checkedAt > 3600_000) await checkForUpdate();
      return Response.json(updateInfo);
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
      ws.send(JSON.stringify({ type: "slots", taken: takenMap(), names, pings }));
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
          if (slots[old] === ws) { slots[old] = null; names[old] = null; pings[old] = null; }
        }
        ws.data.player = p;
        slots[p] = ws;
        names[p] = (typeof data.name === "string" && data.name.trim()) ? data.name.trim().slice(0, 20) : null;
        ws.send(JSON.stringify({ type: "join_result", ok: true, player: p, name: names[p] }));
        broadcastSlots();
      } else if (data.type === "press") {
        if (ws.data.player && BUTTONS.includes(data.button)) {
          tapKey(ws.data.player, data.button);
          const msg = JSON.stringify({ type: "press", player: ws.data.player, button: data.button });
          for (const c of wsClients) c.send(msg);
        }
      } else if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", t: data.t }));
      } else if (data.type === "latency") {
        const p = ws.data.player;
        const rtt = Number(data.rtt);
        if (p && slots[p] === ws && Number.isFinite(rtt)) {
          pings[p] = Math.max(0, Math.min(9999, Math.round(rtt)));
          broadcastSlots();
        }
      } else if (data.type === "leave") {
        const p = ws.data.player;
        if (p && slots[p] === ws) { slots[p] = null; names[p] = null; pings[p] = null; ws.data.player = null; broadcastSlots(); }
      }
    },
    close(ws) {
      wsClients.delete(ws);
      const p = ws.data.player;
      if (p && slots[p] === ws) { slots[p] = null; names[p] = null; pings[p] = null; broadcastSlots(); }
    },
  },
});

openBrowser(`http://localhost:${PORT}/host`);
console.log(`BuzzCast running on http://localhost:${PORT}`);
console.log(`Host: http://localhost:${PORT}/host`);
