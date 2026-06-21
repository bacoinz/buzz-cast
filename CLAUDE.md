# BuzzCast — CLAUDE.md

Virtual Buzz! quiz controllers on any phone for PCSX2. The app runs on the host PC, serves a web UI over the network, and emulates a keyboard so PCSX2 sees real keystrokes.

GitHub: https://github.com/bacoinz/buzzcast  
Distribution: `BuzzCast v<x.y>.exe` (version from `package.json`, e.g. `BuzzCast v1.1.exe`) — standalone ~95 MB, no installs needed (Bun runtime embedded).

---

## Architecture

```
Phone (browser) ──WebSocket──► bun-server.js ──PowerShell SendKeys──► PCSX2 (focused window)
                                     │
                              Cloudflare Tunnel ──► remote phones (same lobby)
```

---

## File map

| File | Purpose |
|------|---------|
| `bun-server.js` | **Production server** (Bun). HTTP + WebSocket + keyboard emulation + Cloudflare. Always edit this for feature changes. |
| `server.js` | Legacy Node.js + Express fallback. Uses nut.js for keyboard. Functionally equivalent but not the build target. |
| `config.js` | Shared KEYMAP, PORT, PLAYERS (imported by server.js only; bun-server.js has them inlined). |
| `build.js` | Build pipeline: reads public/ → patches bun-server.js source → writes _bundle.js → bun compile → embed icon. |
| `package.json` | npm deps for the Node fallback only (express, ws, @nut-tree-fork/nut-js, qrcode). |
| `public/index.html` | Lobby — 8-slot grid, real-time availability via WebSocket. |
| `public/controller.html` | Controller UI — buzzer + 4 colour buttons. |
| `public/instructions.html` | Bilingual instructions (EN/PT) + full key map table. |
| `public/app.js` | Client WS logic: join, press, leave, name prompt, reconnect. |
| `public/lang.js` | i18n system: T dict, getLang, setLang, t(), applyI18n(). |
| `public/style.css` | All UI CSS: lobby, controller, instructions, responsive. |
| `public/buzz-logo.png` | Logo (gitignored; must exist on disk to build exe). |
| `public/buzz-logo-black.svg` | SVG logo embossed on buzzer button (gitignored). |
| `controller-ico.png` | Source image for exe icon (gitignored). |
| `buzz-logo.ico` | Generated ICO used during build (gitignored, auto-created by build.js). |

---

## Running / building

```sh
# Standalone exe (production)
.\"BuzzCast v1.1.exe"            # double-click; auto-opens /host in browser

# Bun dev mode
bun run bun-server.js

# Node dev mode (needs images on disk)
npm install && node server.js

# Build exe (requires Bun installed + all images present on disk)
bun run build.js                 # outputs "BuzzCast v<x.y>.exe" (~95 MB)
```

---

## Key constants (bun-server.js, inlined)

| Constant | Value |
|----------|-------|
| `PORT` | `3000` |
| `PLAYERS` | `8` |
| `CF_LOCAL` | `path.join(import.meta.dir, "cloudflared.exe")` |
| `CF_URL` | `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe` |

localStorage keys: `buzz_lang` (default `"en"`), `buzz_name`.

---

## WebSocket protocol

All messages are JSON strings.

| Direction | Type | Shape |
|-----------|------|-------|
| C → S | `join` | `{type, player: 1-8, name: string}` |
| S → C | `join_result` | `{type, ok: true, player, name}` or `{type, ok: false, reason: "taken"\|"invalid slot"}` |
| C → S | `press` | `{type, button: "buzzer"\|"blue"\|"orange"\|"green"\|"yellow"}` |
| C → S | `ping` | `{type, t: epochMs}` — client RTT probe (every 2 s) |
| S → C | `pong` | `{type, t}` — echoes the `t` back so client computes RTT |
| C → S | `latency` | `{type, rtt: ms}` — client reports measured RTT so server can share it |
| C → S | `leave` | `{type}` |
| S → all | `slots` | `{type, taken: {1:bool,…}, names: {1:string\|null,…}, pings: {1:ms\|null,…}}` |

`slots` is broadcast on: new connection, join, leave, disconnect, latency update.

The host page opens a **spectator** WebSocket (never sends `join`) to read `slots`/`pings` and render the live per-player latency panel.

Server state:
```js
const slots = {};       // player(1-8) → ws | null
const names = {};       // player(1-8) → string | null
const pings = {};       // player(1-8) → RTT ms | null
const wsClients = new Set();
```

---

## API routes

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/` `/index.html` | Lobby page | HTML |
| GET | `/controller.html` | Controller UI | HTML |
| GET | `/instructions.html` | Instructions | HTML |
| GET | `/style.css` `/app.js` `/lang.js` `/buzz-logo.png` `/buzz-logo-black.svg` | Static assets | file |
| GET | `/host` | Host page (dynamic: LAN QR + tunnel UI) | HTML |
| GET | `/api/tunnel-status` | Tunnel state | `{tunnelUrl, cfFound, cfInstalled, installing, installProgress, installError}` |
| GET | `/api/qr?url=` | SVG QR for given URL | SVG |
| POST | `/api/install-cloudflared` | Start async cloudflared download | `{ok:true}` |
| POST | `/api/uninstall-cloudflared` | Delete cloudflared.exe, reset tunnel | `{ok:true}` |
| POST | `/api/shutdown` | `process.exit(0)` after 300 ms | `{ok:true}` |

---

## Keyboard emulation (bun-server.js)

A persistent PowerShell process is spawned at startup (`PS_KEY_SCRIPT`) with stdin piped. It reads one line per keypress and injects it via the Win32 **`keybd_event`** API (key-down + key-up, fire-and-forget — no blocking, low latency):

```js
const PS_KEY_SCRIPT = `Add-Type -Name K -Namespace W -MemberDefinition '... VkKeyScan, MapVirtualKey, keybd_event ...';
… while(ReadLine()) {
  if line starts with '#' → raw VK in hex (e.g. "#08" = Backspace), send by scancode
  else → VkKeyScan(char) → VK + shift state; replay Shift if the char needs it (layout-aware)
}`;
```

`tapKey(player, button)` → looks up `KEYMAP[player][button]` → maps via `SK` → writes `"q\n"` to stdin.

```js
const SK = {
  Q:"q", W:"w", …,                 // letters → lowercase char
  "0":"0", …, "9":"9",             // digits → char
  Comma:",", Period:".", Minus:"-",
  Backspace:"#08",                 // "#" prefix = raw virtual-key code (hex)
};
```

**Why `keybd_event` instead of `SendKeys`?** `SendKeys.Send` needs a WinForms message loop (fails silently in a console process) and `SendKeys.SendWait` blocks until each key is processed → cumulative lag under rapid multi-player input. `keybd_event` with scancodes is non-blocking, reliable for games, and layout-aware via `VkKeyScan`.

**Why VK-escape (`#`) for Backspace?** All 26 letters + 10 digits are consumed by the 40 keys; player 8's remaining keys must be non-alphanumeric. Every punctuation char needs Shift on *some* layout, so player 8 yellow uses Backspace sent by raw VK (`0x08`) — a single, Shift-free key present on all keyboards/layouts.

**Why PowerShell instead of nut.js?** Bun cannot load native `.node` modules. PowerShell has no external deps.

**Requirement:** PCSX2 window must be in focus when a button is pressed.

---

## KEYMAP (8 players × 5 buttons = 40 unique keys)

| Player | Buzzer | Blue | Orange | Green | Yellow |
|-------:|:------:|:----:|:------:|:-----:|:------:|
| 1 | Q | W | E | R | T |
| 2 | A | S | D | F | G |
| 3 | Z | X | C | V | B |
| 4 | Y | U | I | O | P |
| 5 | H | J | K | L | N |
| 6 | 1 | 2 | 3 | 4 | 5 |
| 7 | 6 | 7 | 8 | 9 | 0 |
| 8 | M | - | , | . | Backspace |

Avoids F1–F12, Tab, Space, Esc (PCSX2 hotkeys).

---

## Cloudflare tunnel

State variables (module-level globals):
```js
let tunnelUrl = null;   // null = not yet; string = active URL
let cfFound = null;     // null = unknown, true = running, false = ENOENT
let install = { running: false, progress: 0, error: null };
```

`startTunnel(cfPath?)`:
- Spawns `cloudflared tunnel --url http://localhost:3000`
- Regex-captures `https://[a-z0-9-]+\.trycloudflare\.com` from stdout/stderr
- Sets `tunnelUrl` on first match; sets `cfFound` on spawn/error

`downloadFile(url, dest, onProgress)`:
- Follows HTTP redirects (max 10 hops) using Node `http`/`https`
- Streams to `dest + ".tmp"`, renames on finish
- Calls `onProgress(0-100)` per chunk

Host page polls `/api/tunnel-status` every **1500 ms** and drives a state machine:
`loading` → `not_found` → `installing (%)` → `error` → `QR shown`

---

## Build pipeline (build.js)

1. Read all `public/` files into memory (PNG as base64)
2. Read `bun-server.js` source as string
3. **Patch ASSETS Map**: replace `Bun.file(new URL(...))` entries with `{body, type}` objects backed by embedded string/Buffer constants (`__S`)
4. **Patch fetch handler**: `new Response(asset)` → `new Response(asset.body, {headers:{"Content-Type":asset.type}})`
5. Write `_bundle.js`
6. Run `bun build --compile _bundle.js --outfile "BuzzCast v<x.y>.exe" --icon buzz-logo.ico` (name derived from `package.json` version)
7. Delete `_bundle.js`
8. **Embed icon via Win32 API**: write `_embed-icon.ps1` (uses `BeginUpdateResource` / `UpdateResource` / `EndUpdateResource`), run it via `powershell -File`, delete it

> **Why build.js exists:** `Bun.file(new URL("./public/...", import.meta.url))` in Bun 1.3.14 does **not** embed files at compile time — it tries to read from `B:\~BUN\root\...` at runtime and fails. All assets must be inlined as strings/buffers.

> **Why a temp PS1 file for icon embedding:** PowerShell here-strings (`@'...'@`) cannot be passed inline via `-Command` (the `'@` must be at column 0). A temp file avoids this.

---

## i18n system

### lang.js (used in public/ pages)

```js
const T = {
  en: {
    subtitle: "Choose your controller",
    player_slot: n => `Player ${n}`,     // function keys
    join_failed: r => `Could not join (${r}). Returning to menu.`,
    // …
  },
  pt: { /* Portuguese */ }
};

function getLang()           // localStorage.getItem("buzz_lang") || "en"
function setLang(lang)       // saves + location.reload()
function t(key, ...args)     // lookup; if value is function, calls it with args
function applyI18n()         // sets textContent on all [data-i18n]; activates .flag-btn
```

### Host page (bun-server.js)

Has its own embedded `HOST_T` dict and `tx(key)` function (same pattern, different keys: `title`, `s1`–`s4`, `tab_local`, `tab_remote`, `tunnel_starting`, `not_found`, `install_btn`, `installing`, `install_error`, `retry_btn`).

---

## LAN IP detection

```js
function getLanIp() {
  // Collects all non-internal IPv4 addresses
  // CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./   (avoid: unreliable for LAN)
  // Private = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/
  // Priority: private+non-CGNAT → non-CGNAT → first → "127.0.0.1"
}
```

---

## Gotchas

- **Always edit `bun-server.js`** for production changes. `server.js` is legacy (Node + nut.js).
- **Images are gitignored** (`*.png`, `*.svg`) but must exist on disk to run `build.js`. The exe has them embedded.
- **`buzz-logo.ico`** is auto-generated by `build.js` from `controller-ico.png` via PowerShell .NET (`System.Drawing`) — multi-size ICO (256/128/64/48/32/16 px).
- **WS protocol auto-detects transport:** `wss://` on HTTPS (Cloudflare tunnel), `ws://` on HTTP (local LAN).
- **Name stored in localStorage** (`buzz_name`, max 20 chars). Sent with every `join` message including name changes.
- **Slot re-join:** a client can re-join to change name or switch slots; old slot is freed automatically.
- **Shutdown flow:** browser calls `POST /api/shutdown` → server does `setTimeout(() => process.exit(0), 300)` to allow response to send → browser calls `window.close()`.

---

## Gitignore summary

Excluded: `node_modules/`, `BuzzCast.exe`, `BuzzCast v*.exe`, `cloudflared.exe`, `buzz-logo.ico`, `_bundle.js`, `_embed-icon.ps1`, `*.bun-build`, `.claude/`, `*.png`, `*.svg`
