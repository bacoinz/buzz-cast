// build.js — generates _bundle.js with all static files embedded, then compiles BuzzCast.exe
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptDir, "..");          // repo root (scripts/ is one level down)
const pub = path.join(root, "public");
const srcDir = path.join(root, "src");
const assetsDir = path.join(root, "assets");

// ── Build target (version from package.json) ──────────────────────────────────
// Native build by default; override with BUILD_TARGET=windows|linux|macos to
// cross-compile from one machine. Icon embedding (Win32 UpdateResource) only runs
// for the Windows target AND only when building on Windows.
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const TARGETS = {
  windows: { flag: "bun-windows-x64", out: `BuzzCast v${version}.exe`,            icon: true  },
  linux:   { flag: "bun-linux-x64",   out: `BuzzCast-v${version}-linux-x86_64`,   icon: false },
  macos:   { flag: process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64",
             out: `BuzzCast-v${version}-macos`,                                    icon: false },
};
const which = process.env.BUILD_TARGET
  || (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux");
const TARGET = TARGETS[which];
if (!TARGET) { console.error(`Unknown BUILD_TARGET "${which}" (use windows|linux|macos)`); process.exit(1); }
const EXE_NAME = TARGET.out;

// ── Read static files ────────────────────────────────────────────────────────
const indexHtml        = fs.readFileSync(path.join(pub, "index.html"),           "utf8");
const controllerHtml   = fs.readFileSync(path.join(pub, "controller.html"),      "utf8");
const instructionsHtml = fs.readFileSync(path.join(pub, "instructions.html"),    "utf8");
const styleCss         = fs.readFileSync(path.join(pub, "style.css"),            "utf8");
const appJs            = fs.readFileSync(path.join(pub, "app.js"),               "utf8");
const langJs           = fs.readFileSync(path.join(pub, "lang.js"),              "utf8");
const logoPngB64       = fs.readFileSync(path.join(pub, "buzz-logo.png")).toString("base64");
const logoSvg          = fs.readFileSync(path.join(pub, "buzz-logo-black.svg"),  "utf8");

// ── Read bun-server.js source and patch it ───────────────────────────────────
let src = fs.readFileSync(path.join(srcDir, "bun-server.js"), "utf8");

// 1. Replace the ASSETS Map (Bun.file calls → embedded content)
const assetsBlock = `// ── Static assets (embedded at compile time via Bun.file + new URL) ───────────
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
]);`;

const assetsReplacement = `// ── Embedded static files ────────────────────────────────────────────────────
const __S = {
  index:        ${JSON.stringify(indexHtml)},
  controller:   ${JSON.stringify(controllerHtml)},
  instructions: ${JSON.stringify(instructionsHtml)},
  style:        ${JSON.stringify(styleCss)},
  appJs:        ${JSON.stringify(appJs)},
  langJs:       ${JSON.stringify(langJs)},
  logoPng:      Buffer.from(${JSON.stringify(logoPngB64)}, "base64"),
  logoSvg:      ${JSON.stringify(logoSvg)},
};

const ASSETS = new Map([
  ["/",                  {body:__S.index,        type:"text/html;charset=utf-8"}],
  ["/index.html",        {body:__S.index,        type:"text/html;charset=utf-8"}],
  ["/controller.html",   {body:__S.controller,   type:"text/html;charset=utf-8"}],
  ["/instructions.html", {body:__S.instructions, type:"text/html;charset=utf-8"}],
  ["/style.css",         {body:__S.style,        type:"text/css;charset=utf-8"}],
  ["/app.js",            {body:__S.appJs,        type:"application/javascript;charset=utf-8"}],
  ["/lang.js",           {body:__S.langJs,       type:"application/javascript;charset=utf-8"}],
  ["/buzz-logo.png",     {body:__S.logoPng,      type:"image/png"}],
  ["/buzz-logo-black.svg",{body:__S.logoSvg,     type:"image/svg+xml;charset=utf-8"}],
]);`;

if (!src.includes(assetsBlock)) {
  console.error("ERROR: Could not find ASSETS block in bun-server.js — did you edit it?");
  process.exit(1);
}
src = src.replace(assetsBlock, assetsReplacement);

// 2. Replace the static-file serving in the fetch handler
src = src.replace(
  "    const asset = ASSETS.get(pathname);\n    if (asset) return new Response(asset);",
  "    const asset = ASSETS.get(pathname);\n    if (asset) return new Response(asset.body, {headers:{\"Content-Type\":asset.type}});"
);

// 3. Write _bundle.js next to the source so its ./keyboard + ./platform imports resolve
const bundlePath = path.join(srcDir, "_bundle.js");
fs.writeFileSync(bundlePath, src, "utf8");
console.log("Generated src/_bundle.js");

// 4. Compile (per target) — outputs land in the repo root (cwd = root)
const onWindows = process.platform === "win32";
const icoPath = path.join(assetsDir, "buzz-logo.ico");
const useIcon = TARGET.icon && onWindows && fs.existsSync(icoPath);
const iconFlag = useIcon ? ` --icon "${icoPath}"` : "";
console.log(`Compiling ${EXE_NAME} (target ${TARGET.flag})…`);
execSync(`bun build --compile --target=${TARGET.flag} src/_bundle.js --outfile "${EXE_NAME}"${iconFlag}`, { stdio: "inherit", cwd: root });

// 5. Cleanup
fs.unlinkSync(bundlePath);

// 6. Embed icon via Win32 UpdateResource (Windows target, built on Windows only)
const exePath = path.join(root, EXE_NAME);
if (useIcon) {
  console.log("Embedding icon…");
  const ps1Path = path.join(root, "_embed-icon.ps1");
  fs.writeFileSync(ps1Path, `
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices;
public class IconEmbedder {
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)]
  public static extern IntPtr BeginUpdateResource(string f,bool d);
  [DllImport("kernel32.dll",SetLastError=true)]
  public static extern bool UpdateResource(IntPtr h,IntPtr t,IntPtr n,ushort l,byte[] d,uint s);
  [DllImport("kernel32.dll",SetLastError=true)]
  public static extern bool EndUpdateResource(IntPtr h,bool f);
  public static void Embed(string exe,string ico){
    byte[] icoData=File.ReadAllBytes(ico);
    int count=BitConverter.ToUInt16(icoData,4);
    IntPtr hU=BeginUpdateResource(exe,false);
    if(hU==IntPtr.Zero)throw new Exception("BeginUpdateResource: "+Marshal.GetLastWin32Error());
    for(int i=0;i<count;i++){
      int d=6+i*16;
      uint sz=BitConverter.ToUInt32(icoData,d+8),off=BitConverter.ToUInt32(icoData,d+12);
      byte[] img=new byte[sz];Array.Copy(icoData,off,img,0,sz);
      if(!UpdateResource(hU,(IntPtr)3,(IntPtr)(i+1),0,img,sz))throw new Exception("UpdateResource RT_ICON: "+Marshal.GetLastWin32Error());
    }
    int gs=6+count*14;byte[] grp=new byte[gs];
    BitConverter.GetBytes((ushort)0).CopyTo(grp,0);BitConverter.GetBytes((ushort)1).CopyTo(grp,2);BitConverter.GetBytes((ushort)count).CopyTo(grp,4);
    for(int i=0;i<count;i++){
      int d=6+i*16,g=6+i*14;
      grp[g]=icoData[d];grp[g+1]=icoData[d+1];grp[g+2]=icoData[d+2];grp[g+3]=0;
      grp[g+4]=icoData[d+4];grp[g+5]=icoData[d+5];grp[g+6]=icoData[d+6];grp[g+7]=icoData[d+7];
      BitConverter.GetBytes(BitConverter.ToUInt32(icoData,d+8)).CopyTo(grp,g+8);
      BitConverter.GetBytes((ushort)(i+1)).CopyTo(grp,g+12);
    }
    if(!UpdateResource(hU,(IntPtr)14,(IntPtr)1,0,grp,(uint)grp.Length))throw new Exception("UpdateResource RT_GROUP_ICON: "+Marshal.GetLastWin32Error());
    if(!EndUpdateResource(hU,false))throw new Exception("EndUpdateResource: "+Marshal.GetLastWin32Error());
  }
}
'@
[IconEmbedder]::Embed(${JSON.stringify(exePath)},${JSON.stringify(icoPath)})
Write-Host "Icon embedded"
`, "utf8");
  execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${ps1Path}"`,
    { stdio: "inherit", cwd: root });
  fs.unlinkSync(ps1Path);
}

console.log(`Done! ${EXE_NAME} is ready.`);
