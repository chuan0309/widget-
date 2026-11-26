// 讀 Windows 目前的桌布，給小組件當「毛玻璃後面的東西」。
// 小組件會把桌布模糊後，對準自己在螢幕上的位置貼在背景，
// 看起來就像透過玻璃看到後面的桌布，而且可以有 iOS 那種大圓角
// （Windows 內建的毛玻璃只能有 8px 的小圓角）。

const { nativeImage } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const DESKTOP_KEY = "HKCU\\Control Panel\\Desktop";
// WallpaperStyle 的數字代表桌布的「調整方式」
const STYLE = { 0: "center", 2: "stretch", 6: "fit", 10: "fill", 22: "span" };

function regQuery(key, name) {
  return new Promise((resolve) => {
    execFile("reg", ["query", key, "/v", name], { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = String(out).match(new RegExp(`${name}\\s+REG_\\w+\\s+(.*)`));
      resolve(m ? m[1].trim() : null);
    });
  });
}

// 回傳一個「指紋」，用來判斷桌布有沒有換：只看 Windows 實際顯示的那張桌布檔案的修改時間
// （每 30 秒看一次，不用開任何程式，幾乎不花資源）
function fingerprint() {
  try { return String(fs.statSync(transcodedPath()).mtimeMs); } catch { return ""; }
}

function transcodedPath() {
  return path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
}

async function readWallpaper() {
  if (process.platform !== "win32") return null;
  const [file, styleNum, tile] = await Promise.all([
    regQuery(DESKTOP_KEY, "WallPaper"),
    regQuery(DESKTOP_KEY, "WallpaperStyle"),
    regQuery(DESKTOP_KEY, "TileWallpaper"),
  ]);
  const mode = tile === "1" ? "tile" : STYLE[Number(styleNum ?? 10)] || "fill";

  // TranscodedWallpaper 是 Windows 實際顯示的那張；登錄檔裡的路徑當備用
  for (const f of [transcodedPath(), file].filter(Boolean)) {
    try {
      const img = nativeImage.createFromBuffer(fs.readFileSync(f));
      if (img.isEmpty()) continue;
      const { width, height } = img.getSize();
      // 反正會被模糊，縮小一點，傳給畫面比較快
      const small = width > 960 ? img.resize({ width: 960, quality: "good" }) : img;
      return {
        url: "data:image/jpeg;base64," + small.toJPEG(82).toString("base64"),
        width, height, mode,
      };
    } catch {}
  }

  // 沒有桌布圖片（純色桌布）
  const bg = await regQuery("HKCU\\Control Panel\\Colors", "Background");
  if (bg) {
    const [r, g, b] = bg.split(/\s+/).map(Number);
    return { color: `rgb(${r}, ${g}, ${b})`, mode: "color" };
  }
  return null;
}

module.exports = { readWallpaper, fingerprint };
