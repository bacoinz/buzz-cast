// keyboard/macos.js — macOS keyboard injection via bun:ffi → CoreGraphics
//
// Uses CGEventCreateKeyboardEvent + CGEventPost to post key events to the focused
// app. Requires the user to grant the app **Accessibility** permission
// (System Settings → Privacy & Security → Accessibility); without it macOS
// silently drops the events.
//
// macOS posts events by *virtual keycode* (physical key position), so we map chars
// using a US ANSI layout table — which is fine here because PCSX2 is mapped by
// physical key anyway. Tokens: a single char or "#XX" = raw Win32 VK in hex.

// Char → US-ANSI virtual keycode (kVK_ANSI_*).
const CHAR_TO_KEY = {
  a:0, s:1, d:2, f:3, h:4, g:5, z:6, x:7, c:8, v:9, b:11, q:12, w:13, e:14, r:15,
  y:16, t:17, o:31, u:32, i:34, p:35, l:37, j:38, k:40, n:45, m:46,
  "1":18, "2":19, "3":20, "4":21, "6":22, "5":23, "9":25, "7":26, "8":28, "0":29,
  "-":27, "=":24, "[":33, "]":30, ";":41, "'":39, ",":43, ".":47, "/":44, "\\":42, "`":50,
  " ":49,
};

// Win32 VK ("#XX" tokens) → US-ANSI virtual keycode.
const VK_TO_KEY = {
  0x08:51, 0x09:48, 0x0d:36, 0x1b:53, 0x20:49, 0x2e:117,
  0x24:115, 0x23:119, 0x21:116, 0x22:121,
  0x25:123, 0x26:126, 0x27:124, 0x28:125,
};

let CG = null, CF = null;

export function init() {
  const { dlopen, FFIType } = require("bun:ffi");
  const cg = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
    CGEventCreateKeyboardEvent: { args: [FFIType.ptr, FFIType.u16, FFIType.bool], returns: FFIType.ptr },
    CGEventPost:                { args: [FFIType.u32, FFIType.ptr], returns: FFIType.void },
  });
  const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
    CFRelease: { args: [FFIType.ptr], returns: FFIType.void },
  });
  CG = cg.symbols; CF = cf.symbols;
}

const kCGHIDEventTap = 0;

function pressKey(code) {
  for (const down of [true, false]) {
    const ev = CG.CGEventCreateKeyboardEvent(null, code, down);
    if (!ev) continue;
    CG.CGEventPost(kCGHIDEventTap, ev);
    CF.CFRelease(ev);
  }
}

export function tap(token) {
  if (!CG) return;
  let code;
  if (token[0] === "#") code = VK_TO_KEY[parseInt(token.slice(1), 16)];
  else code = CHAR_TO_KEY[token.toLowerCase()];
  if (code !== undefined) pressKey(code);
}
