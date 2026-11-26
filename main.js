const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme, nativeImage, shell, net, powerMonitor } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createPinterestApi } = require("./pinterest-api");
const wallpaper = require("./wallpaper");
const { createCalendar } = require("./calendar");
const { autoUpdater } = require("electron-updater");
const { createGoogle } = require("./google");

// 「使用 Google／Pinterest 帳號登入」需要的程式 ID，打包時由 GitHub 放進 oauth.json（不在原始碼裡）。
// 自己開發時也可以用環境變數 GW_GOOGLE_CLIENT_ID 等等。
function loadOAuthConfig() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(path.join(__dirname, "oauth.json"), "utf8")); } catch {}
  const e = process.env;
  return {
    google: {
      clientId: f.google?.clientId || e.GW_GOOGLE_CLIENT_ID || "",
      clientSecret: f.google?.clientSecret || e.GW_GOOGLE_CLIENT_SECRET || "",
    },
    pinterest: {
      appId: f.pinterest?.appId || e.GW_PINTEREST_APP_ID || "",
      appSecret: f.pinterest?.appSecret || e.GW_PINTEREST_APP_SECRET || "",
    },
  };
}
const OAUTH = loadOAuthConfig();

/* ───────── 設定檔（存在 %APPDATA%\Glass Widgets\settings.json）───────── */
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const DEFAULTS = {
  // "ios"：大圓角＋模糊桌布（像 iPhone）；"acrylic"：Windows 11 內建毛玻璃（圓角比較小）
  glass: "ios",
  tint: 30, // 玻璃的透明程度：0 = 最透明，100 = 顏色最深（像 iOS 的「透明 ↔ 不同色調」）
  widgets: { clock: true, weather: true, battery: true, audio: true, phone: true, calendar: true, pinterest: true },
  sizes: { clock: "s", weather: "s", battery: "m", audio: "s", phone: "m", calendar: "m", pinterest: "l" }, // s 小、m 中、l 大
  positions: {},
  city: { name: "台北市", lat: 25.033, lon: 121.565 },
  weatherAuto: true, // 天氣自動定位
  // mode "rss"：讀公開網址；mode "api"：登入帳號（官方 API）
  pinterest: { mode: "rss", feed: "" },
  bluetooth: { notifyConnect: true, notifyLow: true, lowThreshold: 20, muted: {} },
  calendar: { sources: [] }, // Google 日曆的 iCal 私人網址（加密存）
  batteryWidget: { hidden: {}, order: [] }, // 電量小組件：哪些裝置不要顯示、排列順序
  audio: { auto: false, priority: [] }, // 音訊輸出：自動切換、優先順序（用裝置名稱）
  stacks: [], // 疊放：[{ id, items: ["clock", "weather"], size: "s", rotate: false }]
};
const FIRST_RUN = !fs.existsSync(SETTINGS_FILE);
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    if (saved.glass === "transparent") saved.glass = "ios"; // 舊版設定
    return {
      ...DEFAULTS, ...saved,
      widgets: { ...DEFAULTS.widgets, ...saved.widgets },
      sizes: { ...DEFAULTS.sizes, ...saved.sizes },
      calendar: { ...DEFAULTS.calendar, ...saved.calendar },
      batteryWidget: { ...DEFAULTS.batteryWidget, ...saved.batteryWidget },
      audio: { ...DEFAULTS.audio, ...saved.audio },
      stacks: Array.isArray(saved.stacks) ? saved.stacks : [],
      pinterest: { ...DEFAULTS.pinterest, ...saved.pinterest },
      bluetooth: { ...DEFAULTS.bluetooth, ...saved.bluetooth, muted: { ...saved.bluetooth?.muted } },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
let settings = loadSettings();
function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/* ───────── 小組件視窗 ───────── */
const KINDS = ["battery", "clock", "weather", "audio", "phone", "calendar", "pinterest"]; // 也是預設排列的順序
const SIZES = {
  s: { width: 170, height: 170, cols: 1, rows: 1 },
  m: { width: 356, height: 170, cols: 2, rows: 1 },
  l: { width: 356, height: 356, cols: 2, rows: 2 },
};
const CELL = 186; // 170 + 16 間距
const widgetWins = {};
// 視窗的 key：一般小組件就是種類名稱（"clock"），疊放是 "stack:<id>"
const stackOf = (key) => String(key).startsWith("stack:") ? (settings.stacks || []).find((st) => `stack:${st.id}` === key) : null;
const sizeOf = (key) => {
  const v = stackOf(key)?.size ?? settings.sizes[key];
  return SIZES[v] ? v : "s";
};
const hostsKind = (key, kind) => key === kind || !!stackOf(key)?.items.includes(kind);
// 傳訊息給「有顯示某種小組件」的所有視窗（單獨的、或在疊放裡的）
function sendToKind(kind, channel, data) {
  for (const [key, w] of Object.entries(widgetWins)) if (hostsKind(key, kind) && !w.isDestroyed()) w.webContents.send(channel, data);
}
function reloadKind(kind) {
  for (const [key, w] of Object.entries(widgetWins)) if (hostsKind(key, kind) && !w.isDestroyed()) w.webContents.reload();
}
const widgetName = (key) => {
  const st = stackOf(key);
  return st ? `疊放：${st.items.map((k) => WIDGET_NAMES[k]).join("、")}` : WIDGET_NAMES[key];
};

// 沒存過位置的小組件：從螢幕右上角開始，像 iPhone 主畫面一樣兩欄往下排
function defaultPosition(kind) {
  const wa = screen.getPrimaryDisplay().workArea;
  const left = wa.x + wa.width - 24 - (CELL * 2 - 16);
  const top = wa.y + 24;
  const st = stackOf(kind);
  if (st) {
    const i = settings.stacks.indexOf(st);
    return { x: left - 16 - SIZES[sizeOf(kind)].width, y: top + i * (SIZES[sizeOf(kind)].height + 16) };
  }
  const used = new Set();
  for (const k of KINDS) {
    if (!settings.widgets[k] && k !== kind) continue;
    const { cols, rows } = SIZES[sizeOf(k)];
    for (let r = 0; ; r++) {
      for (let c = 0; c + cols <= 2; c++) {
        const cells = [];
        for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < cols; dc++) cells.push(`${r + dr},${c + dc}`);
        if (cells.some((x) => used.has(x))) continue;
        cells.forEach((x) => used.add(x));
        if (k === kind) return { x: left + c * CELL, y: top + r * CELL };
        r = Infinity; break;
      }
      if (r === Infinity) break;
    }
  }
  return { x: left, y: top };
}

function onSomeScreen({ x, y }) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    x >= a.x - 50 && y >= a.y - 50 && x < a.x + a.width - 50 && y < a.y + a.height - 50);
}

function glassOptions() {
  if (settings.glass === "acrylic") {
    // 讓 Windows 11 自己畫毛玻璃（真的會把桌布模糊）
    return { backgroundMaterial: "acrylic", titleBarStyle: "hidden", backgroundColor: "#00000000" };
  }
  return { transparent: true, frame: false, backgroundColor: "#00000000" };
}

function widgetQuery(key) {
  const base = { size: sizeOf(key), glass: settings.glass, tint: String(settings.tint) };
  const st = stackOf(key);
  if (st) return { ...base, kind: "stack", items: st.items.join(","), rotate: st.rotate ? "1" : "0" };
  return { ...base, kind: key };
}

// 拖動透明度滑桿時，桌面上的小組件即時跟著變
function setTint(value, save) {
  settings.tint = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  for (const w of Object.values(widgetWins)) if (!w.isDestroyed()) w.webContents.send("glass:tint", settings.tint);
  if (save) saveSettings();
}
ipcMain.on("glass:tint-preview", (_e, v) => setTint(v, false));

function createWidget(kind) {
  const saved = settings.positions[kind];
  const pos = saved && onSomeScreen(saved) ? saved : defaultPosition(kind);
  const { width, height } = SIZES[sizeOf(kind)];
  const win = new BrowserWindow({
    width, height,
    ...pos,
    ...glassOptions(),
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, backgroundThrottling: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "widget.html"), { query: widgetQuery(kind) });
  win.once("ready-to-show", () => { win.showInactive(); pinToDesktop(win); });
  // 拖動時一直更新背景桌布的位置，玻璃後面的畫面才會對得上
  win.on("move", () => sendBackdrop(win));
  win.webContents.on("did-finish-load", () => sendBackdrop(win, true));
  win.on("moved", () => {
    const [x, y] = win.getPosition();
    settings.positions[kind] = { x, y };
    saveSettings();
  });
  // 點過小組件之後它會跑到最上面，點別的地方時就把它放回桌面那一層
  win.on("blur", () => pinToDesktop(win));
  win.on("closed", () => delete widgetWins[kind]);
  widgetWins[kind] = win;
}

function setWidgetSize(kind, size) {
  if (!SIZES[size]) return;
  const st = stackOf(kind);
  if (st) st.size = size; else settings.sizes[kind] = size;
  saveSettings();
  managerWin?.webContents.send("mgr:refresh");
  const win = widgetWins[kind];
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: SIZES[size].width, height: SIZES[size].height });
  win.loadFile(path.join(__dirname, "renderer", "widget.html"), { query: widgetQuery(kind) });
}

const WIDGET_NAMES = { clock: "時鐘", weather: "天氣", battery: "電量", audio: "音訊輸出", phone: "手機連結", calendar: "Google 日曆", pinterest: "Pinterest" };

// 拖動小組件：畫面告訴主程式滑鼠移了多少，主程式移動視窗
const dragging = new Map(); // webContents id → 開始拖的時候視窗的位置
ipcMain.on("widget:drag-start", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) dragging.set(e.sender.id, win.getPosition());
});
ipcMain.on("widget:drag-move", (e, dx, dy) => {
  const start = dragging.get(e.sender.id);
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!start || !win || win.isDestroyed()) return;
  win.setPosition(Math.round(start[0] + Number(dx)), Math.round(start[1] + Number(dy)));
});
ipcMain.on("widget:drag-end", (e) => {
  dragging.delete(e.sender.id);
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.emit("moved"); // 存位置
});

// 在小組件上按右鍵
ipcMain.on("widget:menu", (e) => {
  const kind = Object.keys(widgetWins).find((k) => widgetWins[k].webContents === e.sender);
  if (!kind) return;
  const cur = sizeOf(kind);
  Menu.buildFromTemplate([
    { label: widgetName(kind), enabled: false },
    { type: "separator" },
    { label: "小", type: "radio", checked: cur === "s", click: () => setWidgetSize(kind, "s") },
    { label: "中", type: "radio", checked: cur === "m", click: () => setWidgetSize(kind, "m") },
    { label: "大", type: "radio", checked: cur === "l", click: () => setWidgetSize(kind, "l") },
    { type: "separator" },
    ...(stackOf(kind)
      ? [
          { label: "編輯這個疊放…", click: () => openManager("widgets") },
          { label: "移除這個疊放", click: () => { removeStack(kind); managerWin?.webContents.send("mgr:refresh"); } },
        ]
      : [{ label: "移除這個小組件", click: () => { setWidgetEnabled(kind, false); saveSettings(); managerWin?.webContents.send("mgr:refresh"); } }]),
    { label: "開啟 Glass Widgets", click: () => openManager("widgets") },
  ]).popup({ window: BrowserWindow.fromWebContents(e.sender) });
});

/* ───────── 小組件固定在「桌面那一層」───────── */
// Chrome 之類的視窗永遠蓋在小組件上面；按 Win+D 也不會把小組件藏起來
let pinner = null;
function pinToDesktop(win) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return;
  if (!pinner || pinner.exitCode !== null) {
    const script = path.join(__dirname, "desktop-pin.ps1").replace("app.asar", "app.asar.unpacked");
    pinner = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
    pinner.on("error", () => (pinner = null));
  }
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  pinner.stdin.write(hwnd.toString() + "\n");
}

/* ───────── 省電：螢幕鎖定、睡眠時小組件停止更新 ───────── */
function setPaused(paused) {
  for (const w of Object.values(widgetWins)) if (!w.isDestroyed()) w.webContents.send("widget:paused", paused);
}

/* ───────── 圓角毛玻璃：把模糊的桌布貼在小組件後面 ───────── */
let wallInfo = null;
let wallPrint = "";

function backdropFor(win) {
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  // 「跨螢幕延伸」的桌布是以全部螢幕合起來計算
  let area = display.bounds;
  if (wallInfo?.mode === "span") {
    const all = screen.getAllDisplays().map((d) => d.bounds);
    const x = Math.min(...all.map((r) => r.x)), y = Math.min(...all.map((r) => r.y));
    area = {
      x, y,
      width: Math.max(...all.map((r) => r.x + r.width)) - x,
      height: Math.max(...all.map((r) => r.y + r.height)) - y,
    };
  }
  return { win: b, area, scale: display.scaleFactor };
}

function sendBackdrop(win, withImage = false) {
  if (settings.glass !== "ios" || win.isDestroyed()) return;
  const payload = backdropFor(win);
  if (withImage) payload.wall = wallInfo;
  win.webContents.send("backdrop", payload);
}

async function refreshWallpaper(force = false) {
  if (process.platform !== "win32") return;
  const fp = await wallpaper.fingerprint().catch(() => "");
  if (!force && fp === wallPrint) return;
  wallPrint = fp;
  wallInfo = await wallpaper.readWallpaper().catch(() => null);
  for (const w of Object.values(widgetWins)) sendBackdrop(w, true);
}

function rebuildWidgets() {
  Object.values(widgetWins).forEach((w) => w.destroy());
  for (const kind of KINDS) if (settings.widgets[kind]) createWidget(kind);
  for (const st of settings.stacks || []) createWidget(`stack:${st.id}`);
}

// 疊放改了：把舊的疊放視窗關掉、照新的設定重開（位置會保留）
function syncStacks() {
  for (const [key, w] of Object.entries(widgetWins)) if (key.startsWith("stack:")) w.destroy();
  for (const st of settings.stacks || []) createWidget(`stack:${st.id}`);
}
function removeStack(key) {
  settings.stacks = (settings.stacks || []).filter((st) => `stack:${st.id}` !== key);
  delete settings.positions[key];
  saveSettings();
  widgetWins[key]?.destroy();
}

function showAllWidgets() {
  Object.values(widgetWins).forEach((w) => w.showInactive());
}

/* ───────── 藍牙通知：MacBook 瀏海那樣，從螢幕正上方中間掉下來 ───────── */
const NOTCH_W = 440, NOTCH_H = 120; // 視窗大小（瀏海本身比較小，動畫在視窗裡面跑）
let popup = null;
let popupDevice = null;
let popupTimer = null;

// 通知視窗開程式時就先建好（藏起來），要用時直接顯示，不用等它載入
let popupReady = false;
function ensurePopup() {
  if (popup && !popup.isDestroyed()) return popup;
  const { bounds } = screen.getPrimaryDisplay();
  popupReady = false;
  popup = new BrowserWindow({
    width: NOTCH_W, height: NOTCH_H,
    x: Math.round(bounds.x + (bounds.width - NOTCH_W) / 2), y: bounds.y,
    transparent: true, frame: false, backgroundColor: "#00000000",
    resizable: false, movable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, backgroundThrottling: false },
  });
  popup.setAlwaysOnTop(true, "screen-saver");
  popup.setIgnoreMouseEvents(true, { forward: true }); // 透明的地方點得穿，滑到瀏海上才接收
  popup.loadFile(path.join(__dirname, "renderer", "popup.html"));
  popup.webContents.once("did-finish-load", () => {
    popupReady = true;
    if (popupDevice) { popup.showInactive(); popup.webContents.send("popup:device", popupDevice); }
  });
  popup.on("closed", () => { popup = null; popupReady = false; });
  return popup;
}

function showPopup(device) {
  popupDevice = device;
  clearTimeout(popupTimer);
  const win = ensurePopup();
  if (popupReady) {
    // 螢幕可能換過（接外接螢幕），每次都對齊主螢幕正上方
    const { bounds } = screen.getPrimaryDisplay();
    win.setPosition(Math.round(bounds.x + (bounds.width - NOTCH_W) / 2), bounds.y);
    win.showInactive();
    win.webContents.send("popup:device", device);
  }
  popupTimer = setTimeout(hidePopup, 15000); // 保險：畫面自己收不起來時
}

function hidePopup() {
  clearTimeout(popupTimer);
  if (popup && !popup.isDestroyed()) popup.hide();
  popupDevice = null;
}

ipcMain.on("popup:mouse", (_e, inside) => popup?.setIgnoreMouseEvents(!inside, { forward: true }));

/* ───────── 偵測藍牙（背景跑 PowerShell）───────── */
let devices = [];
let watcher = null;
let firstSnapshot = true;

function startWatcher() {
  if (process.platform !== "win32") return;
  const script = path.join(__dirname, "bt-watch.ps1").replace("app.asar", "app.asar.unpacked");
  watcher = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
    windowsHide: true,
  });
  let buf = "";
  watcher.stdout.setEncoding("utf8");
  watcher.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/^\uFEFF/, "").trim(); // PowerShell 有時會在最前面加 BOM
      buf = buf.slice(i + 1);
      if (line.startsWith("[")) handleDevices(JSON.parse(line));
    }
  });
  watcher.stderr.on("data", (d) => console.error("[bt-watch]", String(d)));
  watcher.on("exit", (code) => {
    watcher = null;
    if (!app.isQuitting) setTimeout(startWatcher, 5000); // 掛掉就重開
  });
}

/* ───────── 音訊輸出：顯示目前用哪個、自動切換 ───────── */
// audio.ps1 每 1.5 秒回報一次「有哪些輸出裝置、哪個是預設」，也接受「set <id>」切換預設
let audioProc = null;
let audioOutputs = [];
let audioNames = ""; // 上一次「有哪些裝置」，用來判斷有沒有裝置接上或拔掉

function startAudio() {
  if (process.platform !== "win32") return;
  const script = path.join(__dirname, "audio.ps1").replace("app.asar", "app.asar.unpacked");
  audioProc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
  let buf = "";
  audioProc.stdout.setEncoding("utf8");
  audioProc.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/^\uFEFF/, "").trim(); // PowerShell 有時會在最前面加 BOM
      buf = buf.slice(i + 1);
      if (line.startsWith("[")) { try { handleAudio(JSON.parse(line)); } catch {} }
    }
  });
  audioProc.stderr.on("data", (d) => console.error("[audio]", String(d)));
  audioProc.on("exit", () => {
    audioProc = null;
    if (!app.isQuitting) setTimeout(startAudio, 5000);
  });
}

function setAudioOutput(id) {
  if (!audioProc || !audioOutputs.some((o) => o.id === id)) return false;
  audioProc.stdin.write(`set ${id}\n`);
  return true;
}

function handleAudio(list) {
  audioOutputs = list.map((o) => ({ id: String(o.id), name: String(o.name), default: !!o.default }));
  // 第一次看到的裝置，加到優先順序的最後面
  const a = settings.audio;
  let changed = false;
  for (const o of audioOutputs) if (!a.priority.includes(o.name)) { a.priority.push(o.name); changed = true; }
  if (changed) saveSettings();
  broadcast("audio", audioOutputs);

  // 只有「有裝置接上或拔掉」時才自動切換；自己手動切的不會被改回去
  const names = audioOutputs.map((o) => o.name).sort().join("\n");
  const devicesChanged = names !== audioNames;
  const firstTime = audioNames === "";
  audioNames = names;
  if (!a.auto || !devicesChanged || firstTime) return;
  const best = a.priority.map((n) => audioOutputs.find((o) => o.name === n)).find(Boolean);
  if (best && !best.default) setAudioOutput(best.id);
}

/* ───────── 手機連結：讀 Phone Link 轉過來的手機通知 ───────── */
// phone.ps1 每 4 秒看一次 Windows 通知中心的資料庫，有變化才回報
let phoneProc = null;
let phoneNotifs = [];
let phoneError = "";
const logoCache = new Map(); // 圖示路徑 → data URL
const PHONE_LINK_DIR = path.join(process.env.LOCALAPPDATA || "", "Packages", "Microsoft.YourPhone_8wekyb3d8bbwe").toLowerCase();

function phoneLogo(src) {
  if (!src) return "";
  let file = String(src).replace(/^ms-appdata:\/\/\/local\//i, "").replace(/^file:\/\/\/?/i, "");
  try { file = decodeURIComponent(file); } catch {}
  file = path.normalize(file);
  // 只讀 Phone Link 自己資料夾裡的圖，別的路徑一律不碰
  if (!file.toLowerCase().startsWith(PHONE_LINK_DIR)) return "";
  if (logoCache.has(file)) return logoCache.get(file);
  let url = "";
  try {
    const img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) url = img.resize({ width: 48, height: 48, quality: "good" }).toDataURL();
  } catch {}
  logoCache.set(file, url);
  return url;
}

function startPhone() {
  if (process.platform !== "win32") return;
  const script = path.join(__dirname, "phone.ps1").replace("app.asar", "app.asar.unpacked");
  phoneProc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
  let buf = "";
  phoneProc.stdout.setEncoding("utf8");
  phoneProc.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/^\uFEFF/, "").trim();
      buf = buf.slice(i + 1);
      let data;
      try { data = JSON.parse(line); } catch { continue; }
      if (Array.isArray(data)) {
        phoneError = "";
        phoneNotifs = data.map((n) => ({
          id: n.id, time: n.time, app: n.app || "",
          title: n.texts?.[0] || "", body: (n.texts || []).slice(1).join("\n"),
          logo: phoneLogo(n.logo),
        }));
      } else {
        phoneError = data.error || "error";
        phoneNotifs = [];
      }
      sendToKind("phone", "phone", { notifications: phoneNotifs, error: phoneError });
    }
  });
  phoneProc.on("exit", () => {
    phoneProc = null;
    if (!app.isQuitting) setTimeout(startPhone, 10000);
  });
}
ipcMain.handle("phone:get", () => ({ notifications: phoneNotifs, error: phoneError }));
// 點小組件 → 打開 Windows 的「手機連結」
ipcMain.on("phone:open", () => {
  if (process.platform === "win32") spawn("explorer.exe", ["shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App"], { detached: true });
});

ipcMain.handle("audio:get", () => ({ outputs: audioOutputs, auto: settings.audio.auto, priority: settings.audio.priority }));
ipcMain.handle("audio:set", (_e, id) => setAudioOutput(String(id)));

// 有些裝置（iPhone、部分耳機）在 Windows 裡會出現兩筆：傳統藍牙＋低功耗藍牙，合併成一筆
function mergeSameDevice(list) {
  const byName = new Map();
  for (const d of list) {
    const key = String(d.name).trim().toLowerCase();
    const prev = byName.get(key);
    if (!prev) { byName.set(key, { ...d }); continue; }
    prev.connected = prev.connected || d.connected;
    if (prev.battery == null) prev.battery = d.battery;
    prev.cod = prev.cod || d.cod;
    prev.le = prev.le || d.le;
  }
  return [...byName.values()];
}

const lowAlerted = new Set();

// 低功耗藍牙（手機、很多鍵盤滑鼠）閒置時會短暫斷線再自己連回來。
// 為了不要一直跳通知：
//   1. 斷線要持續 45 秒以上才算真的斷線（中間連回來就當作一直連著）
//   2. 同一台裝置的「已連線」通知，3 分鐘內最多一次
const DISCONNECT_GRACE = 45 * 1000;
const NOTIFY_COOLDOWN = 3 * 60 * 1000;
const lastSeen = new Map();     // 裝置 id → 最後一次看到「連著」的時間
const lastBattery = new Map();  // 裝置 id → 最後讀到的電量（短暫斷線時沿用）
const lastNotified = new Map(); // 裝置 id → 上次跳「已連線」通知的時間
let rawDevices = [];
let lastBroadcast = "";

function handleDevices(raw) {
  rawDevices = mergeSameDevice(raw);
  evaluateDevices();
}

function evaluateDevices() {
  const now = Date.now();
  for (const d of rawDevices) {
    if (d.connected) lastSeen.set(d.id, now);
    if (d.battery != null) lastBattery.set(d.id, d.battery);
  }
  const next = rawDevices.map((d) => {
    const connected = d.connected || now - (lastSeen.get(d.id) ?? -Infinity) < DISCONNECT_GRACE;
    return { ...d, connected, battery: d.battery ?? (connected ? lastBattery.get(d.id) ?? null : null) };
  });

  const wasConnected = new Set(devices.filter((d) => d.connected).map((d) => d.id));
  devices = next;
  const json = JSON.stringify(devices);
  if (json !== lastBroadcast) { lastBroadcast = json; broadcast("devices", devices); }

  const first = firstSnapshot;
  firstSnapshot = false;
  const bt = settings.bluetooth;
  for (const d of next) {
    const muted = !!bt.muted[d.id]; // 在管理程式裡關掉這台的通知
    // 真的新連上的裝置 → 跳通知（開程式前就連著的不跳）
    if (!first && d.connected && !wasConnected.has(d.id)) {
      const recently = now - (lastNotified.get(d.id) ?? -Infinity) < NOTIFY_COOLDOWN;
      if (bt.notifyConnect && !muted && !recently) { lastNotified.set(d.id, now); showPopup(d); }
    }

    // 電量低 → 跳一次提醒，充回門檻 +5% 以上才會再提醒
    if (d.connected && d.battery != null && d.battery <= bt.lowThreshold && !lowAlerted.has(d.id)) {
      lowAlerted.add(d.id);
      if (bt.notifyLow && !muted) showPopup({ ...d, alert: "low" });
    } else if (d.battery != null && d.battery > bt.lowThreshold + 5) {
      lowAlerted.delete(d.id);
    }

    // 通知還開著時，電量晚一點才讀到就順便更新
    if (popupDevice && d.id === popupDevice.id && popup && !popup.isDestroyed()) {
      popupDevice = { ...d, alert: popupDevice.alert };
      popup.webContents.send("popup:device", popupDevice);
    }
  }
}
// 斷線 45 秒後要把狀態改成「未連線」，所以定時再檢查一次
setInterval(() => rawDevices.length && evaluateDevices(), 15 * 1000);

function broadcast(channel, data) {
  for (const w of [...Object.values(widgetWins), managerWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
}

/* ───────── 管理程式視窗 ───────── */
let managerWin = null;
// Windows 11 22H2 以上才有 Mica / Acrylic 材質
const IS_WIN11 = process.platform === "win32" && Number(os.release().split(".")[2]) >= 22621;

function openManager(section) {
  if (managerWin && !managerWin.isDestroyed()) {
    if (managerWin.isMinimized()) managerWin.restore();
    managerWin.show();
    managerWin.focus();
    if (section) managerWin.webContents.send("mgr:goto", section);
    return;
  }
  managerWin = new BrowserWindow({
    width: 920, height: 640, minWidth: 780, minHeight: 520,
    title: "Glass Widgets",
    icon: path.join(__dirname, "assets", "icon.png"),
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: "#ffffff", height: 40 },
    ...(IS_WIN11 ? { backgroundMaterial: "mica", backgroundColor: "#00000000" } : { backgroundColor: "#1d1e26" }),
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true },
  });
  managerWin.loadFile(path.join(__dirname, "renderer", "manager.html"), {
    query: { mica: IS_WIN11 ? "1" : "0", section: section || "" },
  });
  managerWin.once("ready-to-show", () => managerWin.show());
  managerWin.on("closed", () => (managerWin = null)); // 關掉視窗不會結束程式，小組件繼續在桌面
}

function setWidgetEnabled(kind, on) {
  settings.widgets[kind] = on;
  if (on && !widgetWins[kind]) createWidget(kind);
  if (!on) widgetWins[kind]?.destroy();
}

function managerState() {
  const { pinterest, calendar: _cal, ...rest } = settings;
  return {
    settings: { ...rest, positions: undefined },
    // 行事曆網址是祕密，只給名稱和顏色
    calendars: (settings.calendar.sources || []).map((c, i) => ({ name: c.name || `行事曆 ${i + 1}`, color: c.color })),
    devices,
    autostart: app.getLoginItemSettings().openAtLogin,
    locate: locateInfo,
    version: app.getVersion(),
    isWin11: IS_WIN11,
    dataFolder: app.getPath("userData"),
  };
}

ipcMain.handle("mgr:get", managerState);
ipcMain.handle("mgr:set", (_e, patch = {}) => {
  if (patch.widgets) for (const [k, v] of Object.entries(patch.widgets)) if (KINDS.includes(k)) setWidgetEnabled(k, !!v);
  if (patch.glass && patch.glass !== settings.glass && ["ios", "acrylic"].includes(patch.glass)) {
    settings.glass = patch.glass;
    rebuildWidgets();
  }
  if (patch.bluetooth) {
    const b = patch.bluetooth;
    if ("notifyConnect" in b) settings.bluetooth.notifyConnect = !!b.notifyConnect;
    if ("notifyLow" in b) settings.bluetooth.notifyLow = !!b.notifyLow;
    if ("lowThreshold" in b) settings.bluetooth.lowThreshold = Math.min(50, Math.max(5, Number(b.lowThreshold) || 20));
    if (b.mute) for (const [id, m] of Object.entries(b.mute)) {
      if (m) settings.bluetooth.muted[id] = true; else delete settings.bluetooth.muted[id];
    }
  }
  if ("weatherAuto" in patch) {
    settings.weatherAuto = !!patch.weatherAuto;
    if (settings.weatherAuto) locateCity();
  }
  if (patch.city && typeof patch.city.lat === "number" && typeof patch.city.lon === "number") {
    settings.city = { name: String(patch.city.name || "").slice(0, 40), lat: patch.city.lat, lon: patch.city.lon };
    reloadKind("weather"); // 天氣小組件重新讀
  }
  if ("tint" in patch) setTint(patch.tint, false);
  if (Array.isArray(patch.stacks)) {
    settings.stacks = patch.stacks.slice(0, 10).map((st, i) => ({
      id: String(st.id || Date.now().toString(36) + i).replace(/[^\w-]/g, "").slice(0, 24) || `s${i}`,
      items: [...new Set((st.items || []).filter((k) => KINDS.includes(k)))].slice(0, 6),
      size: SIZES[st.size] ? st.size : "s",
      rotate: !!st.rotate,
    })).filter((st) => st.items.length > 0);
    syncStacks();
  }
  if (patch.audio) {
    if ("auto" in patch.audio) settings.audio.auto = !!patch.audio.auto;
    if (Array.isArray(patch.audio.priority)) settings.audio.priority = patch.audio.priority.map(String).slice(0, 100);
    if (settings.audio.auto) audioNames = ""; // 剛打開自動切換：下一次回報時照優先順序切一次
    if (settings.audio.auto && audioOutputs.length) {
      const best = settings.audio.priority.map((n) => audioOutputs.find((o) => o.name === n)).find(Boolean);
      if (best && !best.default) setAudioOutput(best.id);
    }
  }
  if (patch.batteryWidget) {
    const b = patch.batteryWidget;
    if (b.hide) for (const [id, h] of Object.entries(b.hide)) {
      if (h) settings.batteryWidget.hidden[id] = true; else delete settings.batteryWidget.hidden[id];
    }
    if (Array.isArray(b.order)) settings.batteryWidget.order = b.order.map(String).slice(0, 200);
    broadcast("battery:prefs", settings.batteryWidget);
  }
  if (patch.sizes) for (const [k, v] of Object.entries(patch.sizes)) if (KINDS.includes(k)) setWidgetSize(k, v);
  if ("autostart" in patch) app.setLoginItemSettings({ openAtLogin: !!patch.autostart });
  saveSettings();
  return managerState();
});
ipcMain.on("mgr:reset-positions", () => {
  settings.positions = {};
  saveSettings();
  rebuildWidgets();
});
ipcMain.on("mgr:show-widgets", showAllWidgets);
// 只開放打開 Google 日曆設定頁
ipcMain.on("mgr:open-url", (_e, url) => {
  if (String(url).startsWith("https://calendar.google.com/")) shell.openExternal(url);
});
ipcMain.on("mgr:open", (_e, section) => openManager(typeof section === "string" ? section : undefined));
ipcMain.on("mgr:test-popup", () => showPopup({ id: "demo", name: "Aero Buds Pro", connected: true, battery: 85 }));
ipcMain.on("mgr:open-folder", () => shell.openPath(app.getPath("userData")));
ipcMain.on("mgr:quit", () => app.quit());
// 管理程式改了 Pinterest 設定 → 通知 Pinterest 小組件重新讀
ipcMain.on("mgr:pins-changed", () => sendToKind("pinterest", "pins:changed"));

/* ───────── 自動更新（從 GitHub Releases 下載新版）───────── */
// 有新版時在背景下載，下載好之後：關掉程式時自動裝好；也可以在管理程式按「立即更新」。
let update = { state: "idle", version: "", progress: 0, error: "" };
function setUpdate(patch) {
  update = { ...update, ...patch };
  managerWin?.webContents.send("update:state", update);
}
function setupUpdater() {
  if (!app.isPackaged) return; // 開發模式（npm start）不檢查
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdate({ state: "checking", error: "" }));
  autoUpdater.on("update-available", (i) => setUpdate({ state: "downloading", version: i.version, progress: 0 }));
  autoUpdater.on("update-not-available", () => setUpdate({ state: "latest" }));
  autoUpdater.on("download-progress", (p) => setUpdate({ state: "downloading", progress: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => {
    setUpdate({ state: "ready", version: i.version });
    tray?.setToolTip(`Glass Widgets（新版 ${i.version} 已下載，重新開啟後就會更新）`);
  });
  autoUpdater.on("error", (e) => setUpdate({ state: "error", error: String(e?.message || e).split("\n")[0].slice(0, 200) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 30 * 1000);          // 開機 30 秒後檢查一次
  setInterval(check, 6 * 60 * 60 * 1000); // 之後每 6 小時
}
ipcMain.handle("update:get", () => ({ ...update, current: app.getVersion(), packaged: app.isPackaged }));
ipcMain.on("update:check", () => app.isPackaged && autoUpdater.checkForUpdates().catch(() => {}));
ipcMain.on("update:install", () => { if (update.state === "ready") { app.isQuitting = true; autoUpdater.quitAndInstall(true, true); } });

/* ───────── 系統匣圖示 ───────── */
let tray = null;
function buildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "開啟 Glass Widgets", click: () => openManager() },
    { label: "把小組件叫回來", click: showAllWidgets },
    { label: "顯示測試通知", click: () => showPopup({ id: "demo", name: "Aero Buds Pro", connected: true, battery: 85 }) },
    { type: "separator" },
    { label: "離開", click: () => app.quit() },
  ]));
}

/* ───────── Pinterest（讀公開的 RSS，不用登入也不用 API 金鑰）───────── */
// 把使用者貼的網址轉成 RSS 網址：
//   pinterest.com/帳號/        → pinterest.com/帳號/feed.rss（最新的 pin）
//   pinterest.com/帳號/圖版/   → pinterest.com/帳號/圖版.rss
function pinterestFeedFrom(input) {
  let text = String(input || "").trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) {
    if (/^[\w.-]+(\/[\w.%-]+)?\/?$/.test(text)) text = `https://www.pinterest.com/${text}`;
    else return null;
  }
  let url;
  try { url = new URL(text); } catch { return null; }
  if (!/(^|\.)pinterest\.[a-z.]+$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0 || parts[0] === "pin") return null;
  const enc = parts.map(encodeURIComponent);
  if (parts[parts.length - 1].endsWith(".rss")) return `https://www.pinterest.com/${enc.join("/")}`;
  if (parts.length === 1) return `https://www.pinterest.com/${enc[0]}/feed.rss`;
  return `https://www.pinterest.com/${enc[0]}/${enc[1]}.rss`;
}

const decodeXML = (s = "") => s
  .replace(/^<!\[CDATA\[|\]\]>$/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, "&");

async function fetchPinsRss() {
  const feed = settings.pinterest.feed;
  if (!feed) return { needSetup: true };
  try {
    const res = await net.fetch(feed, { headers: { "User-Agent": "Mozilla/5.0 GlassWidgets" } });
    if (res.status === 404) return { error: "找不到這個帳號或圖版，網址對嗎？", feed };
    if (!res.ok) return { error: `Pinterest 回應錯誤（${res.status}）`, feed };
    const xml = await res.text();
    const title = decodeXML(xml.match(/<channel>\s*<title>([\s\S]*?)<\/title>/)?.[1]?.trim()) || "Pinterest";
    const pins = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
      const desc = decodeXML(item.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
      const img = desc.match(/<img[^>]+src="([^"]+)"/)?.[1];
      return {
        img: img?.replace(/\/\d+x\//, "/474x/"), // RSS 給的是小圖，換成清楚一點的
        link: item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim(),
        title: decodeXML(item.match(/<title>([\s\S]*?)<\/title>/)?.[1]).trim().slice(0, 120),
      };
    }).filter((p) => p.img && /^https:\/\/i\.pinimg\.com\//.test(p.img));
    if (pins.length === 0) return { error: "這裡面還沒有 pin，或是不公開", feed, title };
    return { feed, title, pins };
  } catch {
    return { error: "連不到 Pinterest，等一下會再試", feed };
  }
}

const pinApi = createPinterestApi({ settings, save: saveSettings });

async function fetchPins() {
  if (settings.pinterest.mode !== "api") return fetchPinsRss();
  try {
    return await pinApi.fetchPins();
  } catch (e) {
    return { error: e.message, loginExpired: !!e.loginExpired, accessDenied: !!e.accessDenied };
  }
}

ipcMain.handle("pins:get", fetchPins);
ipcMain.handle("pins:status", () => ({
  loggedIn: pinApi.isLoggedIn(),
  username: settings.pinterest.username || "",
  clientId: settings.pinterest.clientId || "",
  source: settings.pinterest.source || null,
  redirectUri: pinApi.REDIRECT_URI,
  builtIn: !!(OAUTH.pinterest.appId && OAUTH.pinterest.appSecret), // 打包時就有 App 資料 → 只要按登入
}));
ipcMain.handle("pins:login", (_e, { clientId, clientSecret } = {}) =>
  pinApi.login(clientId || OAUTH.pinterest.appId, clientSecret || OAUTH.pinterest.appSecret));
ipcMain.handle("pins:boards", async () => {
  try { return { boards: await pinApi.listBoards() }; }
  catch (e) { return { error: e.message, loginExpired: !!e.loginExpired, accessDenied: !!e.accessDenied }; }
});
ipcMain.handle("pins:choose", (_e, source) => { pinApi.chooseSource(source); return fetchPins(); });
ipcMain.on("pins:logout", () => pinApi.logout());
ipcMain.handle("pins:set", async (_e, input) => {
  const feed = pinterestFeedFrom(input);
  if (!feed) return { needSetup: true, error: "請貼 Pinterest 的個人頁或圖版網址" };
  const prev = settings.pinterest.feed;
  settings.pinterest.feed = feed;
  const result = await fetchPinsRss();
  if (result.error) settings.pinterest.feed = prev; // 抓不到就不要存
  else { settings.pinterest.mode = "rss"; saveSettings(); }
  return result.error ? { ...result, needSetup: true } : result;
});
ipcMain.on("pins:reset", () => {
  settings.pinterest.feed = "";
  saveSettings();
});
ipcMain.on("open-pin", (_e, link) => {
  // 只開 Pinterest 自己的網址
  try {
    const u = new URL(link);
    if (u.protocol === "https:" && /(^|\.)pinterest\.[a-z.]+$/i.test(u.hostname)) shell.openExternal(u.href);
  } catch {}
});

/* ───────── IPC ───────── */
ipcMain.handle("get-state", () => ({ devices, city: settings.city, batteryPrefs: settings.batteryWidget }));

/* ───────── 天氣自動定位 ───────── */
// 1. 先問 Windows 定位服務（準，但要使用者在 Windows 設定裡允許桌面程式取用位置）
// 2. 不行的話用網路 IP 估大概在哪個城市
// 地名用 BigDataCloud 的免費反查（不用金鑰），中文是「臺北市」這種正式名稱
function windowsLocation() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve(null);
    const script = path.join(__dirname, "locate.ps1").replace("app.asar", "app.asar.unpacked");
    const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 20000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out.trim().split("\n").pop());
        resolve(r.ok && typeof r.lat === "number" ? r : null);
      } catch { resolve(null); }
    });
    p.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

let locating = null;
let locateInfo = { source: "", at: 0, error: "" };
async function locateCity() {
  if (locating) return locating;
  locating = (async () => {
    const pos = await windowsLocation();
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("localityLanguage", "zh-Hant");
    if (pos) { url.searchParams.set("latitude", pos.lat); url.searchParams.set("longitude", pos.lon); }
    const d = await (await net.fetch(url.href)).json();
    const lat = pos?.lat ?? d.latitude, lon = pos?.lon ?? d.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") throw new Error("定位失敗");
    const name = d.city || d.principalSubdivision || d.locality || "目前位置";
    const moved = Math.abs(lat - settings.city.lat) > 0.03 || Math.abs(lon - settings.city.lon) > 0.03 || name !== settings.city.name;
    settings.city = { name, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
    saveSettings();
    locateInfo = { source: pos ? "windows" : "ip", at: Date.now(), error: "" };
    if (moved) reloadKind("weather");
    managerWin?.webContents.send("mgr:refresh");
    return { ok: true, city: settings.city, source: locateInfo.source };
  })().catch((e) => {
    locateInfo = { ...locateInfo, error: e.message || "定位失敗" };
    return { error: locateInfo.error };
  }).finally(() => { locating = null; });
  return locating;
}
ipcMain.handle("weather:locate", () => locateCity());
function startAutoLocate() {
  const run = () => settings.weatherAuto && locateCity();
  setTimeout(run, 8000);                 // 開機後定位一次
  setInterval(run, 3 * 60 * 60 * 1000);  // 之後每 3 小時（帶筆電出門會跟著換）
}

/* ───────── Google 日曆 ───────── */
const google = createGoogle({ settings, save: saveSettings, config: OAUTH.google });
const calendar = createCalendar({
  settings, save: saveSettings, google,
  onUpdate: (data) => {
    sendToKind("calendar", "cal:update", data);
    managerWin?.webContents.send("mgr:refresh");
  },
});
ipcMain.handle("cal:get", () => calendar.get());
ipcMain.handle("cal:add", (_e, url) => calendar.add(url));
ipcMain.handle("cal:remove", (_e, i) => calendar.remove(Number(i)));
ipcMain.handle("cal:refresh", () => calendar.refresh());
ipcMain.handle("google:status", () => ({ configured: google.configured(), loggedIn: google.isLoggedIn(), email: google.email() }));
ipcMain.handle("google:login", async () => {
  const r = await google.login();
  if (r.ok) calendar.refresh().catch(() => {});
  return r;
});
ipcMain.handle("google:logout", async () => { await google.logout(); return calendar.refresh(); });
ipcMain.handle("google:calendars", async () => {
  try { return { calendars: await google.listCalendars() }; }
  catch (e) { return { error: e.message, loginExpired: !!e.loginExpired }; }
});
ipcMain.handle("google:choose", (_e, id, on) => { google.chooseCalendar(String(id), !!on); return calendar.refresh(); });
ipcMain.on("popup:close", hidePopup); // 瀏海收回去的動畫跑完了

/* ───────── 啟動 ───────── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 再點一次程式捷徑 → 打開管理程式
  app.on("second-instance", () => openManager());
  app.whenReady().then(() => {
    nativeTheme.themeSource = "dark"; // 讓毛玻璃是深色，白字才看得清楚
    app.setAppUserModelId("local.glasswidgets.app");
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")));
    tray.setToolTip("Glass Widgets");
    tray.on("click", () => openManager());
    buildTrayMenu();
    refreshWallpaper(true).finally(rebuildWidgets);
    setInterval(refreshWallpaper, 30 * 1000); // 換桌布時跟著換
    screen.on("display-metrics-changed", () => Object.values(widgetWins).forEach((w) => sendBackdrop(w)));
    startWatcher();
    startAudio();
    startPhone();
    calendar.start();
    setupUpdater();
    startAutoLocate();
    ensurePopup(); // 先把通知視窗建好
    // 鎖定螢幕、睡眠時小組件停止更新，省電
    powerMonitor.on("lock-screen", () => setPaused(true));
    powerMonitor.on("suspend", () => setPaused(true));
    powerMonitor.on("unlock-screen", () => setPaused(false));
    powerMonitor.on("resume", () => setPaused(false));
    if (FIRST_RUN) { saveSettings(); openManager(); } // 第一次打開時順便打開管理程式
  });
  app.on("before-quit", () => {
    app.isQuitting = true;
    watcher?.kill();
    pinner?.kill();
    audioProc?.kill();
    phoneProc?.kill();
  });
  app.on("window-all-closed", () => {}); // 關掉所有小組件也不要結束，留在系統匣
}
