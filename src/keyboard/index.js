// keyboard/index.js — platform-agnostic keyboard backend selector.
//
// Each backend exposes init() (binds the OS library) and tap(token). Importing the
// backends has NO side effects — the OS library is only opened inside init() — so
// all three can be bundled into every compiled binary and only the matching one is
// ever activated at runtime.

import * as windows from "./windows.js";
import * as linux from "./linux.js";
import * as macos from "./macos.js";

const BACKENDS = { win32: windows, linux: linux, darwin: macos };

let backend = null;

export function initKeyboard() {
  const impl = BACKENDS[process.platform];
  if (!impl) {
    console.error(`[keyboard] unsupported platform: ${process.platform}`);
    return;
  }
  try {
    impl.init();
    backend = impl;
    console.log(`[keyboard] backend ready: ${process.platform}`);
  } catch (e) {
    console.error(`[keyboard] init failed (${process.platform}):`, e.message);
  }
}

export function tapToken(token) {
  if (backend && token) backend.tap(token);
}
