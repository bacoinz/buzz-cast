# BuzzCast

Turn any phone into a Buzz! quiz controller for PCSX2 — local or remote via Cloudflare Tunnel + Discord/Parsec streaming. Players open a browser, pick a slot (1–8) and tap the buttons — just like the real plastic buzzers. Supports up to **8 players**.

BuzzCast runs on the host PC, serves a web app on the local network, and emulates a **keyboard**. PCSX2 can't tell the difference from a real keyboard — you just map each Buzz pad to the keys below.

> ⚠️ **The PCSX2 window must be in focus** to receive key presses.

---

## How it works

```
Phone (browser) ──WebSocket──► BuzzCast on PC ──keyboard emulation──► PCSX2
```

---

## Requirements

- **Windows PC** running PCSX2 with a Buzz! game.
- Phones on the **same WiFi** as the PC (for local play).
- No installs needed on phones — just a browser.

> **No Node.js or Bun required.** `BuzzCast.exe` is a standalone executable that includes its own runtime. Just double-click and play.

---

## Getting started

### Option A — Download the exe *(easiest)*

Download `BuzzCast.exe` from [Releases](https://github.com/bacoinz/buzz-cast/releases), double-click it and a browser tab opens automatically.

### Option B — Run from source

```sh
npm install
node server.js
```

Or with Bun:
```sh
bun run bun-server.js
```

### Build the exe yourself

Requires [Bun](https://bun.sh) installed:

```sh
bun run build.js
```

Outputs `BuzzCast.exe` (~95 MB standalone, no dependencies).

---

## Playing locally (same WiFi)

1. Run `BuzzCast.exe` — the **Host** page opens automatically.
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

Defined in [`config.js`](config.js). 8 players × 5 buttons = 40 unique keys.

| Player | Buzzer (●) | Blue | Orange | Green | Yellow |
|-------:|:----------:|:----:|:------:|:-----:|:------:|
| 1 | Q | W | E | R | T |
| 2 | A | S | D | F | G |
| 3 | Z | X | C | V | B |
| 4 | Y | U | I | O | P |
| 5 | H | J | K | L | N |
| 6 | Num1 | Num2 | Num3 | Num4 | Num5 |
| 7 | Num6 | Num7 | Num8 | Num9 | Num0 |
| 8 | M | F | , | . | / |

`Num1`–`Num0` = **numpad** keys.

---

## Configuring PCSX2

1. Open **Settings → Controllers**.
2. For **4 players**: click **USB Port 1**, choose **Buzz! Controller**, map players 1–4.
3. For **8 players**: also click **USB Port 2**, choose **Buzz! Controller**, map players 5–8.
4. For each pad, map **Buzzer / Blue / Orange / Green / Yellow** to the keys in the table above.
5. Save and start the game with the PCSX2 window in focus.

> ⚠️ **Buzz!: The Music Quiz** (the first game in the series) only supports 4 players.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Buttons do nothing in-game | PCSX2 window is not in focus, or key mapping doesn't match the table. |
| Phone can't open the page | Make sure the phone is on the same WiFi and Windows Firewall allows port 3000. |
| Remote tab shows "not found" | Click Install to download Cloudflare — or install it manually and restart BuzzCast. |
| Remote QR never appears | Check that port 3000 is not blocked by a firewall or antivirus. |

---

Built with [Bun](https://bun.sh).
