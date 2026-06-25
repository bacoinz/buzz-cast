// platform.js — per-OS bits that aren't keyboard: open browser + cloudflared.

import { spawn } from "child_process";
import fs from "fs";

const P = process.platform;

// Open a URL in the user's default browser.
export function openBrowser(url) {
  if (P === "win32")      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  else if (P === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" });
  else                    spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
}

// Cloudflared download details per platform. macOS ships as a .tgz that must be
// extracted; the others are the raw binary.
export const CF = {
  filename: P === "win32" ? "cloudflared.exe" : "cloudflared",
  isTgz: P === "darwin",
  url: {
    win32:  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    linux:  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
    darwin: "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz",
  }[P] || "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
};

// Make a downloaded binary executable (no-op on Windows).
export function makeExecutable(file) {
  if (P === "win32") return;
  try { fs.chmodSync(file, 0o755); } catch {}
}

// Extract the cloudflared binary out of the macOS .tgz into `dest`.
export function extractTgz(tgzPath, dest) {
  return new Promise((resolve, reject) => {
    const dir = dest.slice(0, dest.lastIndexOf("/") + 1) || "./";
    const p = spawn("tar", ["-xzf", tgzPath, "-C", dir], { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`tar exited ${code}`));
      try { fs.unlinkSync(tgzPath); } catch {}
      makeExecutable(dest);
      resolve();
    });
  });
}
