# BuzzCast

Turn any phone into a Buzz! quiz controller for PCSX2 — local or remote via Cloudflare Tunnel + Discord/Parsec streaming. Players open a browser, pick a slot (1–8) and tap the buttons — just like the real plastic buzzers. Supports up to **8 players**.

BuzzCast runs on the host PC, serves a web app on the local network, and emulates a **keyboard**. PCSX2 can't tell the difference from a real keyboard — you just map each Buzz pad to the keys below.

**Available for Windows, macOS and Linux** — a single standalone download per OS, no installs needed.

<img width="437" height="250" alt="imagem" src="https://github.com/user-attachments/assets/e0903380-6361-4574-a71b-a85bf7dc6c76" /> <img width="165" height="250" alt="imagem" src="https://github.com/user-attachments/assets/ec173812-8fc7-45ef-a14b-ae9235709bf4" /> <img width="119" height="250" alt="imagem" src="https://github.com/user-attachments/assets/1cc24d16-a335-4153-baa7-f4b8474e7f6b" />



---

## How it works

```
Phone (browser) ──WebSocket──► BuzzCast on PC ──keyboard emulation──► PCSX2
```

- **Up to 8 players** on their own phones — no apps, no pairing.
- **Local or remote** play (LAN QR code or Cloudflare Tunnel for online).
- **Low-latency keyboard injection**, layout-aware, native per OS (Windows `keybd_event`, Linux X11 `XTest`, macOS CoreGraphics).
- **Customisable keys** — change any pad's key from the host's **Keybinds** menu; defaults below.
- **Live latency indicator** per player, on both the controller and the host screen.
- **Auto-reconnect** with exponential backoff if WiFi drops.

---

## Requirements

- A **Windows, macOS or Linux PC** running PCSX2 with a Buzz! game.
- Phones on the **same WiFi** as the PC (for local play).
- No installs needed on phones — just a browser.
- Linux: an **X11** session (Wayland not yet supported) with `libxtst6` installed. macOS: grant **Accessibility** permission when asked.

> **No Node.js or Bun required.** The BuzzCast download is a standalone executable that includes its own runtime. Just run it and play.

---

## Getting started

### Option A — Download for your OS *(easiest)*

Grab the latest build from [Releases](https://github.com/bacoinz/buzzcast/releases) and run it — a browser tab opens automatically:

| OS | Download |
|---|---|
| **Windows** | `BuzzCast v<x.y>.exe` — double-click |
| **Linux** | `BuzzCast-v<x.y>-x86_64.AppImage` (`chmod +x`, then run) or the raw `BuzzCast-v<x.y>-linux-x86_64` binary |
| **macOS** | `BuzzCast-v<x.y>-macos.zip` — unzip, then right-click → **Open** (unsigned app) |

### Option B — Run from source

With [Bun](https://bun.sh) (recommended):
```sh
bun install
bun run src/bun-server.js     # or: bun run dev
```

Legacy Node.js fallback:
```sh
npm install
node legacy/server.js
```

### Build it yourself

Requires [Bun](https://bun.sh) installed. Builds for your current OS by default:

```sh
bun install
bun run build      # → scripts/build.js
```

Cross-compile a specific target from any OS:

```sh
BUILD_TARGET=windows bun run build
BUILD_TARGET=linux   bun run build
BUILD_TARGET=macos   bun run build
```

Outputs a standalone binary (~95 MB, version from `package.json`). All three are also built automatically by CI on each tagged release.

---

## Playing locally (same WiFi)

1. Run BuzzCast — the **Host** page opens automatically.
2. Players scan the **Local QR code** with their phone camera, or type the URL shown.
3. Each player picks a free slot and enters their name.
4. The controller screen appears — ready to play!

---

## Playing remotely (online / streaming)

BuzzCast supports **online multiplayer** via [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no account or port forwarding required.

This works great with any screen-sharing or streaming app:

| Scenario | How |
|---|---|
| **Discord / Parsec / Moonlight stream** | Host shares their screen. Remote players use their own phone to open the BuzzCast Remote URL. |
| **Playing across the internet** | Same as above — the Cloudflare tunnel gives remote players a public HTTPS link. |

### Setup

1. In the **Host** page, click the **Remote** tab.
2. If Cloudflare isn't detected, click **Install** — BuzzCast downloads it silently (~35 MB, no admin rights needed). You can uninstall it later from the same tab.
3. Once the tunnel starts, a QR code and a `https://…trycloudflare.com` URL appear.
4. Remote players open that URL on their phones — they join the **same lobby** as local players.

> The host streams their screen via Discord/Parsec/etc. while remote players control Buzz! from their own phones using the tunnel URL.

---

## PCSX2 key map

**Default** keys — 8 players × 5 buttons = 40 unique keys. You can change any of them from the **Keybinds** menu on the host page (and test each button live); whatever you set is what PCSX2 should be mapped to.

| Player | Buzzer (●) | Blue | Orange | Green | Yellow |
|-------:|:----------:|:----:|:------:|:-----:|:------:|
| 1 | Q | W | E | R | T |
| 2 | A | S | D | F | G |
| 3 | Z | X | C | V | B |
| 4 | Y | U | I | O | P |
| 5 | H | J | K | L | N |
| 6 | 1 | 2 | 3 | 4 | 5 |
| 7 | 6 | 7 | 8 | 9 | 0 |
| 8 | M | - | , | . | Backspace |

> Players 6 & 7 use the **top-row number keys** (not the numpad), and player 8's yellow is **Backspace** — chosen so every key works on all keyboard layouts without modifiers.

---

## Configuring PCSX2

1. Open **Settings → Controllers**.
2. For **4 players**: click **USB Port 1**, choose **Buzz! Controller**, map players 1–4.
3. For **8 players**: also click **USB Port 2**, choose **Buzz! Controller**, map players 5–8.
4. For each pad, map **Buzzer / Blue / Orange / Green / Yellow** to the keys shown in the host's **Keybinds** menu (defaults in the table above).
5. Save and start the game with the PCSX2 window in focus.

> The host page also has a **PCSX2 Instructions** popup with these same steps.

> ⚠️ **Buzz!: The Music Quiz** (the first game in the series) only supports 4 players.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Buttons do nothing in-game | PCSX2 window is not in focus, or key mapping doesn't match the table. |
| Phone can't open the page | Make sure the phone is on the same WiFi and your firewall allows port 3000. |
| Buttons do nothing (Linux) | Needs an **X11** session (not Wayland) with `libxtst6` installed. |
| Buttons do nothing (macOS) | Grant **Accessibility** permission: System Settings → Privacy & Security → Accessibility. |
| Remote tab shows "not found" | Click Install to download Cloudflare — or install it manually and restart BuzzCast. |
| Remote QR never appears | Check that port 3000 is not blocked by a firewall or antivirus. |

## WIP

RPCS3 integration.

---

## ⚠️ macOS & Linux builds are untested — feedback needed!

BuzzCast was developed and tested on **Windows**. The **macOS** and **Linux** builds compile and ship, but the keyboard injection on those platforms hasn't been verified on real hardware yet. If you try them, please [open an issue](https://github.com/bacoinz/buzzcast/issues) with your OS/version and whether the buttons worked — it's a huge help. 🙏

Known caveats: Linux is **X11-only** (Wayland not supported) and needs `libxtst6`; macOS needs **Accessibility** permission and the app is **unsigned** (right-click → Open).

---

Built with [Bun](https://bun.sh).
