const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme, nativeImage, shell, net, powerMonitor, session } = require("electron");
const { spawn, execFile } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createPinterestApi } = require("./pinterest-api");
const wallpaper = require("./wallpaper");
const { createCalendar } = require("./calendar");
const { autoUpdater } = require("electron-updater");
const { createGoogle } = require("./google");
const { createCwa } = require("./cwa");
const { createPhonePush } = require("./phone-push");
const { createHue } = require("./hue");
const { createMatterHome } = require("./matter-home");

// Chromium 會判斷視窗「有沒有被擋住」，被擋住就不畫。我們的小組件視窗是放在桌面最底層的
// 全螢幕透明視窗，Windows 上常被誤判成「一直被擋住」，結果整個不畫、小組件全部不見。
// 關掉這個判斷；省電改由我們自己處理（鎖定、睡眠時暫停）。
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// 「使用 Google／Pinterest 帳號登入」需要的程式 ID，打包時由 GitHub 放進 oauth.json（不在原始碼裡）。
// 自己開發時也可以用環境變數 GW_GOOGLE_CLIENT_ID 等等。
function loadOAuthConfig() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(path.join(__dirname, "oauth.json"), "utf8")); } catch {}
  const e = process.env;
  // 去掉前後的空白和換行（貼到 GitHub Secrets 時常常多一個換行，Google 會說找不到用戶端）
  const t = (...v) => String(v.find((x) => x) || "").trim();
  return {
    google: {
      clientId: t(f.google?.clientId, e.GW_GOOGLE_CLIENT_ID),
      clientSecret: t(f.google?.clientSecret, e.GW_GOOGLE_CLIENT_SECRET),
    },
    pinterest: {
      appId: t(f.pinterest?.appId, e.GW_PINTEREST_APP_ID),
      appSecret: t(f.pinterest?.appSecret, e.GW_PINTEREST_APP_SECRET),
    },
  };
}
const OAUTH = loadOAuthConfig();

/* ───────── 設定檔（存在 %APPDATA%\Glass Widgets\settings.json）───────── */
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

// 診斷記錄：小組件視窗每一步的狀態寫在設定資料夾的 debug.log（每次啟動重新開始，最多 200 KB）
const DEBUG_LOG = path.join(app.getPath("userData"), "debug.log");
try { fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true }); fs.writeFileSync(DEBUG_LOG, ""); } catch {}
function log(...args) {
  try {
    if (fs.statSync(DEBUG_LOG).size > 200 * 1024) return;
    const line = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}
log("start", { version: app.getVersion(), os: os.release(), electron: process.versions.electron });
const DEFAULTS = {
  glass: "ios", // 大圓角＋模糊桌布（像 iPhone）
  tint: 30, // 玻璃的透明程度：0 = 最透明，100 = 顏色最深（像 iOS 的「透明 ↔ 不同色調」）
  widgets: { clock: true, weather: true, battery: true, audio: true, calendar: true, pinterest: true, aqi: false, home: false },
  sizes: { clock: "s", weather: "s", battery: "m", audio: "s", calendar: "m", pinterest: "l", aqi: "s", home: "m" }, // s 小、m 中、l 大
  positions: {},
  city: { name: "台北市", lat: 25.033, lon: 121.565 },
  weatherAuto: true, // 天氣自動定位
  // mode "rss"：讀公開網址；mode "api"：登入帳號（官方 API）
  pinterest: { mode: "rss", feed: "" },
  bluetooth: { notifyConnect: true, notifyLow: true, lowThreshold: 20, muted: {} },
  calendar: {}, // calendar.google：Google 登入資料（google.js，加密存）
  batteryWidget: { hidden: {}, order: [] }, // 電量小組件：哪些裝置不要顯示、排列順序
  audio: { auto: false, priority: [] }, // 音訊輸出：自動切換、優先順序（用裝置名稱）
  weatherSource: "openmeteo", // 天氣資料：openmeteo（免註冊）／cwa（中央氣象署，要授權碼）
  cwa: { key: "" },
  phonePush: { on: false, token: "" }, // iPhone 捷徑：充電器接上／拔掉時直接通知電腦
  // 大時鐘：世界時鐘的 4 個城市
  worldClocks: [
    { name: "台北", tz: "Asia/Taipei" }, { name: "東京", tz: "Asia/Tokyo" },
    { name: "倫敦", tz: "Europe/London" }, { name: "紐約", tz: "America/New_York" },
  ],
  pinInterval: 30, // Pinterest 小組件換圖間隔（分鐘，10～120）
  fontWeight: 600, // 小組件字體粗細：300（細）～ 800（粗），管理程式用滑桿調
  background: "glass", // 小組件背景：glass 透明玻璃／dark 深色／light 淺色
  desktopLayer: true, // 小組件固定在桌面那一層（其他視窗永遠蓋在上面）
  gameMode: "game", // 遊戲模式：game＝玩 Steam 遊戲時／steam＝Steam 開著就算／off＝不用
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
      calendar: { ...DEFAULTS.calendar, ...saved.calendar, sources: undefined }, // 舊版的 iCal 網址不再使用
      batteryWidget: { ...DEFAULTS.batteryWidget, ...saved.batteryWidget },
      audio: { ...DEFAULTS.audio, ...saved.audio },
      // 拿掉已經不存在的小組件（例如舊版的手機連結）
      stacks: (Array.isArray(saved.stacks) ? saved.stacks : [])
        .map((st) => ({ ...st, items: (st.items || []).filter((k) => ["battery", "clock", "weather", "aqi", "audio", "calendar", "pinterest", "home"].includes(k)) }))
        .filter((st) => st.items.length > 0),
      pinterest: { ...DEFAULTS.pinterest, ...saved.pinterest },
      bluetooth: { ...DEFAULTS.bluetooth, ...saved.bluetooth, muted: { ...saved.bluetooth?.muted } },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
let settings = loadSettings();
// 舊版存的是 "bold"／"light"
function fontWeightOf(v) {
  if (v === "light") return 400;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(800, Math.max(300, Math.round(n / 50) * 50)) : 600;
}
function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/* ───────── 小組件：全部放在「一個」透明視窗裡 ───────── */
// 以前一個小組件一個視窗（每個都是一份瀏覽器，很吃記憶體）。現在整個主螢幕只有一個
// 透明、點得穿的視窗，所有小組件都畫在裡面：記憶體少很多，拖動也只是畫面裡的移動，很順。
const KINDS = ["battery", "clock", "weather", "aqi", "audio", "calendar", "pinterest", "home"]; // 也是預設排列的順序
const SIZES = {
  s: { width: 170, height: 170, cols: 1, rows: 1 },
  m: { width: 356, height: 170, cols: 2, rows: 1 },
  l: { width: 356, height: 356, cols: 2, rows: 2 },
};
const CELL = 186; // 170 + 16 間距
const WIDGET_NAMES = { clock: "時鐘", weather: "天氣", battery: "電量", audio: "音訊輸出", calendar: "Google 日曆", pinterest: "Pinterest", aqi: "空氣品質", home: "家庭" };

// 小組件的 key：一般小組件就是種類名稱（"clock"），疊放是 "stack:<id>"
const stackOf = (key) => String(key).startsWith("stack:") ? (settings.stacks || []).find((st) => `stack:${st.id}` === key) : null;
const sizeOf = (key) => {
  const v = stackOf(key)?.size ?? settings.sizes[key];
  return SIZES[v] ? v : "s";
};
const widgetName = (key) => {
  const st = stackOf(key);
  return st ? `疊放：${st.items.map((k) => WIDGET_NAMES[k]).join("、")}` : WIDGET_NAMES[key];
};
const widgetKeys = () => [
  ...KINDS.filter((k) => settings.widgets[k]),
  ...(settings.stacks || []).map((st) => `stack:${st.id}`),
];

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

let hostWin = null;
let hostArea = null; // 視窗蓋住的範圍＝主螢幕扣掉工作列

// 給畫面的排版：每個小組件在視窗裡的位置（相對座標），超出螢幕的拉回來
function layoutItems() {
  const a = hostArea;
  return widgetKeys().map((key) => {
    const size = sizeOf(key);
    const { width, height } = SIZES[size];
    const p = settings.positions[key] || defaultPosition(key);
    const x = Math.min(Math.max(p.x - a.x, 0), a.width - width);
    const y = Math.min(Math.max(p.y - a.y, 0), a.height - height);
    const st = stackOf(key);
    // 舊版設定可能還留著已經拿掉的小組件（例如手機連結），只留現在有的
    const kinds = (st ? st.items : [key]).filter((k) => KINDS.includes(k));
    return { key, kinds, size, x, y, rotate: !!st?.rotate };
  }).filter((it) => it.kinds.length > 0);
}
function sendLayout() {
  if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send("host:layout", layoutItems());
}

// 桌布在螢幕上的範圍（「跨螢幕延伸」的桌布以全部螢幕合起來算）
function wallpaperArea() {
  const display = screen.getPrimaryDisplay();
  if (wallInfo?.mode !== "span") return { area: display.bounds, scale: display.scaleFactor };
  const all = screen.getAllDisplays().map((d) => d.bounds);
  const x = Math.min(...all.map((r) => r.x)), y = Math.min(...all.map((r) => r.y));
  return {
    area: { x, y, width: Math.max(...all.map((r) => r.x + r.width)) - x, height: Math.max(...all.map((r) => r.y + r.height)) - y },
    scale: display.scaleFactor,
  };
}
function sendHostInit() {
  if (!hostWin || hostWin.isDestroyed()) return;
  hostWin.webContents.send("host:init", { host: hostArea, wall: wallInfo, ...wallpaperArea(), tint: settings.tint, background: settings.background, fontWeight: fontWeightOf(settings.fontWeight), pinInterval: settings.pinInterval, worldClocks: settings.worldClocks });
  sendLayout();
}

function createHost() {
  hostArea = screen.getPrimaryDisplay().workArea;
  hostWin = new BrowserWindow({
    ...hostArea,
    transparent: true, frame: false, backgroundColor: "#00000000", hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, backgroundThrottling: true, spellcheck: false },
  });
  // 平常整個視窗點得穿；滑鼠移到小組件上時，畫面會請主程式暫時接收滑鼠
  hostWin.setIgnoreMouseEvents(true, { forward: true });
  log("host created", { area: hostArea, scale: screen.getPrimaryDisplay().scaleFactor, displays: screen.getAllDisplays().length });
  hostWin.loadFile(path.join(__dirname, "renderer", "host.html"));
  hostWin.webContents.on("did-finish-load", () => { log("host loaded"); sendHostInit(); });
  hostWin.webContents.on("did-fail-load", (_e, code, desc) => log("host load failed", code, desc));
  hostWin.webContents.on("console-message", (_e, level, message, line, source) => {
    if (level >= 1) log("host console", level, message, `${path.basename(String(source))}:${line}`);
  });
  const show = (why) => {
    if (!hostWin || hostWin.isDestroyed() || hostWin.isVisible()) return;
    log("host show", why);
    hostWin.showInactive();
    pinToDesktop(hostWin);
  };
  hostWin.once("ready-to-show", () => show("ready-to-show"));
  setTimeout(() => show("fallback after 4 s"), 4000); // 萬一 ready-to-show 沒來
  setTimeout(() => {
    if (!hostWin || hostWin.isDestroyed()) return log("host gone after 8 s");
    log("host state after 8 s", { visible: hostWin.isVisible(), bounds: hostWin.getBounds(), minimized: hostWin.isMinimized(), widgets: layoutItems().length });
    hostWin.webContents.executeJavaScript("({ cards: document.querySelectorAll('.card').length, api: typeof window.api, size: [innerWidth, innerHeight], visibility: document.visibilityState })")
      .then((r) => log("host page", r)).catch((err) => log("host page check failed", String(err)));
  }, 8000);
  // 點過小組件之後視窗會跑到最上面，點別的地方時就放回桌面那一層
  hostWin.on("blur", () => { hostWin.setIgnoreMouseEvents(true, { forward: true }); pinToDesktop(hostWin); });
  const win = hostWin;
  win.on("closed", () => { if (hostWin === win) hostWin = null; });
  // 畫面程式萬一當掉，自動重開，不會讓小組件整個消失
  hostWin.webContents.on("render-process-gone", (_e, d) => {
    log("host renderer gone", d);
    if (app.isQuitting || gaming) return;
    hostWin?.destroy();
    setTimeout(() => !gaming && createHost(), 1000);
  });
}

function fitHostToScreen() {
  if (!hostWin || hostWin.isDestroyed()) return;
  hostArea = screen.getPrimaryDisplay().workArea;
  hostWin.setBounds(hostArea);
  sendHostInit();
}

ipcMain.on("host:interactive", (_e, on) => hostWin?.setIgnoreMouseEvents(!on, { forward: true }));
ipcMain.on("host:move", (_e, key, x, y) => {
  if (!hostArea || !widgetKeys().includes(key)) return;
  settings.positions[key] = { x: Math.round(hostArea.x + Number(x)), y: Math.round(hostArea.y + Number(y)) };
  saveSettings();
});

// 傳資料給小組件（全部都在同一個視窗）
function sendToKind(_kind, channel, data) {
  if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send(channel, data);
}
function reloadKind(kind) {
  if (kind === "weather") sendToKind("weather", "weather:refresh");
}

// 拖動透明度滑桿時，桌面上的小組件即時跟著變
function setTint(value, save) {
  settings.tint = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  sendToKind(null, "glass:tint", settings.tint);
  if (save) saveSettings();
}
ipcMain.on("glass:tint-preview", (_e, v) => setTint(v, false));

function setWidgetSize(kind, size) {
  if (!SIZES[size]) return;
  const st = stackOf(kind);
  if (st) st.size = size; else settings.sizes[kind] = size;
  saveSettings();
  managerWin?.webContents.send("mgr:refresh");
  sendLayout();
}

// 在小組件上按右鍵
ipcMain.on("widget:menu", (e, key) => {
  key = String(key);
  if (!widgetKeys().includes(key)) return;
  const cur = sizeOf(key);
  Menu.buildFromTemplate([
    { label: widgetName(key), enabled: false },
    { type: "separator" },
    { label: "小", type: "radio", checked: cur === "s", click: () => setWidgetSize(key, "s") },
    { label: "中", type: "radio", checked: cur === "m", click: () => setWidgetSize(key, "m") },
    { label: "大", type: "radio", checked: cur === "l", click: () => setWidgetSize(key, "l") },
    { type: "separator" },
    ...(stackOf(key)
      ? [
          { label: "編輯這個疊放…", click: () => openManager("widgets") },
          { label: "移除這個疊放", click: () => { removeStack(key); managerWin?.webContents.send("mgr:refresh"); } },
        ]
      : [{ label: "移除這個小組件", click: () => { setWidgetEnabled(key, false); saveSettings(); managerWin?.webContents.send("mgr:refresh"); } }]),
    { label: "開啟 Glass Widgets", click: () => openManager("widgets") },
  ]).popup({ window: hostWin });
});

/* ───────── 小組件固定在「桌面那一層」───────── */
// Chrome 之類的視窗永遠蓋在小組件上面；按 Win+D 也不會把小組件藏起來
function pinToDesktop(win) {
  if (process.platform !== "win32" || !win || win.isDestroyed() || settings.desktopLayer === false) return;
  if (!pinToDesktop.logged) { pinToDesktop.logged = true; log("pin to desktop", { helper: !!helper }); }
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  helperSend(`pin ${hwnd}`);
}

/* ───────── 省電：螢幕鎖定、睡眠時小組件停止更新 ───────── */
function setPaused(paused) {
  sendToKind(null, "widget:paused", paused);
}

/* ───────── 圓角毛玻璃：把模糊的桌布貼在小組件後面 ───────── */
let wallInfo = null;
let wallPrint = "";

async function refreshWallpaper(force = false) {
  if (process.platform !== "win32") return;
  const fp = wallpaper.fingerprint();
  if (!force && fp === wallPrint) return;
  wallPrint = fp;
  wallInfo = await wallpaper.readWallpaper().catch(() => null);
  sendHostInit();
}

function rebuildWidgets() {
  sendLayout();
}

// 疊放改了：重新排版就好
function syncStacks() {
  sendLayout();
  syncPods();
}
function removeStack(key) {
  settings.stacks = (settings.stacks || []).filter((st) => `stack:${st.id}` !== key);
  delete settings.positions[key];
  saveSettings();
  sendLayout();
  syncPods();
}

function showAllWidgets() {
  if (!hostWin || hostWin.isDestroyed()) return createHost();
  hostWin.showInactive();
  pinToDesktop(hostWin);
}

/* ───────── 藍牙通知：MacBook 瀏海那樣，從螢幕正上方中間掉下來 ───────── */
const NOTCH_W = 440, NOTCH_H = 120; // 視窗大小（瀏海本身比較小，動畫在視窗裡面跑）
let popup = null;
let popupDevice = null;
let popupTimer = null;

// 通知視窗開程式時就建好，而且「一直開著」（完全透明、點得穿）。
// 以前每次通知才把視窗秀出來，Windows 會先播一段淡入動畫，看起來會閃一塊灰色；
// 現在視窗不藏也不秀，只有裡面的瀏海在動，就不會有那段多餘的動畫。
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
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  popup.setAlwaysOnTop(true, "screen-saver");
  popup.setIgnoreMouseEvents(true, { forward: true }); // 透明的地方點得穿，滑到瀏海上才接收
  popup.loadFile(path.join(__dirname, "renderer", "popup.html"));
  popup.webContents.once("did-finish-load", () => {
    popupReady = true;
    popup.showInactive();
    if (popupDevice) popup.webContents.send("popup:device", popupPayload(popupDevice));
  });
  popup.on("closed", () => { popup = null; popupReady = false; });
  return popup;
}

function placePopup() {
  if (!popup || popup.isDestroyed()) return;
  const { bounds } = screen.getPrimaryDisplay(); // 換過螢幕也對齊主螢幕正上方
  popup.setPosition(Math.round(bounds.x + (bounds.width - NOTCH_W) / 2), bounds.y);
}

// 彈窗跟著小組件背景：淺色＝白底，其他＝黑底
const popupPayload = (d) => ({ ...d, theme: settings.background === "light" ? "light" : "dark" });
function showPopup(device) {
  if (gaming) return; // 遊戲模式：通知視窗關掉了，也不要為了通知再開
  popupDevice = device;
  clearTimeout(popupTimer);
  const win = ensurePopup();
  if (popupReady) {
    placePopup();
    win.setAlwaysOnTop(true, "screen-saver"); // 全螢幕程式之後也要在最上面
    win.webContents.send("popup:device", popupPayload(device));
  }
  popupTimer = setTimeout(hidePopup, 15000); // 保險：畫面自己收不起來時
}

function hidePopup() {
  clearTimeout(popupTimer);
  popupDevice = null;
  if (popup && !popup.isDestroyed()) {
    popup.setIgnoreMouseEvents(true, { forward: true });
    popup.webContents.send("popup:close");
  }
}

ipcMain.on("popup:mouse", (_e, inside) => popup?.setIgnoreMouseEvents(!inside, { forward: true }));

/* ───────── 背景小幫手（一個 PowerShell 負責藍牙、音訊、固定到桌面）───────── */
// helper.ps1 會回報「bt <json>」「audio <json>」，也接受「pin <hwnd>」「audio-set <id>」
let helper = null;
let devices = [];
let firstSnapshot = true;
const pendingHelper = []; // 小幫手還沒準備好時先排隊

function startHelper() {
  if (process.platform !== "win32") return;
  const script = path.join(__dirname, "helper.ps1").replace("app.asar", "app.asar.unpacked");
  helper = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true });
  for (const line of pendingHelper.splice(0)) helper.stdin.write(line + "\n");
  let buf = "";
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/^﻿/, "").trim(); // PowerShell 有時會在最前面加 BOM
      buf = buf.slice(i + 1);
      const sp = line.indexOf(" ");
      if (sp < 0) continue;
      let data;
      try { data = JSON.parse(line.slice(sp + 1)); } catch { continue; }
      const kind = line.slice(0, sp);
      if (!reported.has(kind)) { reported.add(kind); log("helper first", kind, Array.isArray(data) ? data.length : "?"); }
      if (kind === "bt" && Array.isArray(data)) handleDevices(data);
      else if (kind === "audio" && Array.isArray(data)) handleAudio(data);
      else if (kind === "pods" && data && typeof data === "object") handlePods(data);
    }
  });
  helper.stderr.on("data", (d) => log("helper stderr", String(d).slice(0, 500)));
  let reported = new Set();
  const proc = helper;
  proc.on("exit", (code) => {
    log("helper exit", code);
    if (helper !== proc) return; // 已經換成新的小幫手了（例如遊戲模式結束後重開）
    helper = null;
    if (!app.isQuitting && !gaming) setTimeout(() => { if (!gaming && !helper) { startHelper(); syncPods(); if (hostWin) pinToDesktop(hostWin); } }, 5000); // 掛掉就重開（遊戲模式是故意關的）
  });
}

function helperSend(line) {
  if (helper && helper.stdin.writable) helper.stdin.write(line + "\n");
  else if (pendingHelper.length < 20) pendingHelper.push(line);
}

/* ───────── 音訊輸出：顯示目前用哪個、自動切換 ───────── */
let audioOutputs = [];
let audioNames = ""; // 上一次「有哪些裝置」，用來判斷有沒有裝置接上或拔掉

function setAudioOutput(id) {
  if (!audioOutputs.some((o) => o.id === id)) return false;
  helperSend(`audio-set ${id}`);
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

// AirPods 沒連這台電腦時，從它們的藍牙廣播讀到的電量（helper.ps1 的 pods）
let pods = null; // { name, left, right, case, chargeLeft, chargeRight, chargeCase, model, at }
const PODS_SHOW_MS = 3 * 3600e3; // 3 小時沒聽到就不顯示
function handlePods(p) {
  if (!pods || pods.model !== p.model) log("airpods seen", p.name, "model 0x" + Number(p.model).toString(16));
  pods = { ...p, at: Date.now() };
  if (!firstSnapshot) evaluateDevices(); // 藍牙清單第一次到之前先不算（不然開程式時會亂跳連線通知）
}
// 跟 iPhone 一樣分兩列：耳機（左右耳比較低的那個）、充電盒
function podsDevices(now, list) {
  if (!pods || now - pods.at > PODS_SHOW_MS) return [];
  // AirPods 真的連在這台電腦上、而且 Windows 讀得到電量，就用那個，不重複顯示
  if (list.some((d) => d.connected && d.battery != null && /airpods/i.test(d.name))) return [];
  const buds = [pods.left, pods.right].filter((v) => v != null);
  const out = [];
  const base = { connected: true, passive: true, cod: null, le: true };
  if (buds.length) out.push({ ...base, id: "airpods-adv", name: pods.name, battery: Math.min(...buds), charging: !!(pods.chargeLeft || pods.chargeRight) });
  if (pods.case != null) out.push({ ...base, id: "airpods-adv-case", name: pods.name + " 充電盒", battery: pods.case, charging: !!pods.chargeCase });
  return out;
}

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
  const pushed = phonePush.current(); // iPhone 捷徑傳來的充電狀態（有開才有）
  const next = rawDevices.map((d) => {
    const connected = d.connected || now - (lastSeen.get(d.id) ?? -Infinity) < DISCONNECT_GRACE;
    const out = { ...d, connected, battery: d.battery ?? (connected ? lastBattery.get(d.id) ?? null : null) };
    if (pushed && /iphone/i.test(d.name)) {
      if (pushed.level != null) out.battery = pushed.level;
      if (pushed.charging != null) out.charging = pushed.charging;
    }
    return out;
  });
  next.push(...podsDevices(now, next));

  const wasConnected = new Set(devices.filter((d) => d.connected).map((d) => d.id));
  devices = next;
  const json = JSON.stringify(devices);
  if (json !== lastBroadcast) { lastBroadcast = json; broadcast("devices", devices); }

  const first = firstSnapshot;
  firstSnapshot = false;
  const bt = settings.bluetooth;
  for (const d of next) {
    if (d.passive) continue; // 廣播讀到的 AirPods 不跳連線／低電量通知（它們沒連這台電腦）
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
      popup.webContents.send("popup:device", popupPayload(popupDevice));
    }
  }
}
// 斷線 45 秒後要把狀態改成「未連線」，所以定時再檢查一次
setInterval(() => (rawDevices.length || pods) && !firstSnapshot && evaluateDevices(), 15 * 1000);

function broadcast(channel, data) {
  for (const w of [hostWin, managerWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
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
  sendLayout();
  syncPods();
}
// AirPods 廣播監聽只在電量小組件有顯示時開著（沒顯示就不用一直收藍牙廣播）
function syncPods() {
  const shown = settings.widgets.battery || (settings.stacks || []).some((st) => st.items.includes("battery"));
  helperSend(`pods ${shown ? "on" : "off"}`);
}

function managerState() {
  const { pinterest, calendar: _cal, ...rest } = settings;
  return {
    settings: { ...rest, positions: undefined },
    devices,
    autostart: app.getLoginItemSettings().openAtLogin,
    desktopLayer: settings.desktopLayer !== false,
    gaming,
    weatherSource: settings.weatherSource || "openmeteo",
    cwaHasKey: cwa.hasKey(),
    locate: locateInfo,
    version: app.getVersion(),
    isWin11: IS_WIN11,
    dataFolder: app.getPath("userData"),
  };
}

ipcMain.handle("mgr:get", managerState);
ipcMain.handle("mgr:set", (_e, patch = {}) => {
  if (patch.widgets) for (const [k, v] of Object.entries(patch.widgets)) if (KINDS.includes(k)) setWidgetEnabled(k, !!v);
  // 現在只有「圓角毛玻璃」一種（Windows 毛玻璃沒辦法用在共用的大視窗上）
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
  if (Array.isArray(patch.worldClocks)) {
    const ok = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
    const list = patch.worldClocks.slice(0, 4)
      .map((c) => ({ name: String(c?.name || "").slice(0, 20), tz: String(c?.tz || "") }))
      .filter((c) => c.name && ok(c.tz));
    if (list.length === 4) { settings.worldClocks = list; sendHostInit(); }
  }
  if (Number.isFinite(patch.pinInterval)) {
    settings.pinInterval = Math.min(120, Math.max(10, Math.round(patch.pinInterval)));
    sendHostInit();
  }
  if (typeof patch.cwaKey === "string") cwa.setKey(patch.cwaKey);
  if (["openmeteo", "cwa"].includes(patch.weatherSource)) settings.weatherSource = patch.weatherSource;
  if (typeof patch.cwaKey === "string" || patch.weatherSource) reloadKind("weather");
  if (patch.fontWeight != null) {
    settings.fontWeight = fontWeightOf(patch.fontWeight);
    sendToKind(null, "glass:font", settings.fontWeight); // 只換字體，不用整個重來（拖滑桿時才順）
  }
  if (["glass", "dark", "light"].includes(patch.background)) {
    settings.background = patch.background;
    sendToKind(null, "glass:background", settings.background);
  }
  if ("autostart" in patch) app.setLoginItemSettings({ openAtLogin: !!patch.autostart });
  if (["game", "steam", "off"].includes(patch.gameMode)) {
    settings.gameMode = patch.gameMode;
    checkGame();
  }
  if ("desktopLayer" in patch) {
    settings.desktopLayer = !!patch.desktopLayer;
    log("desktopLayer", settings.desktopLayer);
    // 換設定時重開小組件視窗，才能把「固定在桌面」的效果拿掉或加回來
    if (hostWin && !hostWin.isDestroyed()) hostWin.destroy();
    createHost();
  }
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
  if (/^https:\/\/(calendar\.google\.com|opendata\.cwa\.gov\.tw)\//.test(String(url))) shell.openExternal(url);
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
  const r = await fetchPinsRaw();
  log("pins", { count: r.pins?.length || 0, error: r.error || "", sample: r.pins?.[0]?.img || "" });
  return r;
}
async function fetchPinsRaw() {
  if (settings.pinterest.mode !== "api") return fetchPinsRss();
  try {
    return await pinApi.fetchPins();
  } catch (e) {
    return { error: e.message, loginExpired: !!e.loginExpired, accessDenied: !!e.accessDenied };
  }
}
// 舊版的「首頁推薦」拿掉了：把它留在電腦裡的網頁登入資料清掉（只做一次）
function cleanupPinterestHome() {
  if (!("pinterestHome" in settings)) return;
  delete settings.pinterestHome;
  saveSettings();
  session.fromPartition("persist:pinterest-web").clearStorageData().catch(() => {});
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
// 中央氣象署：選了它而且有授權碼才用；回傳 null 代表用 Open-Meteo
const cwa = createCwa(settings, saveSettings, log);
// iPhone 捷徑：一收到就馬上更新電量小組件；接上充電器時也跳一下瀏海通知
const phonePush = createPhonePush(settings, saveSettings, (st) => {
  evaluateDevices();
  const phone = devices.find((d) => d.connected && /iphone/i.test(d.name));
  if (st.charging && settings.bluetooth.notifyConnect) showPopup(phone ? { ...phone, charging: true, battery: st.level ?? phone.battery } : { id: "iphone-push", name: "iPhone", connected: true, battery: st.level, charging: true });
  else if (phone && popupDevice?.id === phone.id && popup && !popup.isDestroyed()) popup.webContents.send("popup:device", popupPayload(phone));
}, log);
ipcMain.handle("phone:info", () => phonePush.info());
ipcMain.handle("phone:set", (_e, on) => { phonePush.setOn(on); return phonePush.info(); });
ipcMain.handle("phone:new-token", () => { phonePush.newToken(); return phonePush.info(); });
ipcMain.handle("weather:cwa", async () => {
  if (settings.weatherSource !== "cwa" || !cwa.hasKey()) return null;
  return cwa.weather(settings.city);
});
ipcMain.handle("weather:cwa-test", async (_e, key) => {
  if (typeof key === "string" && key.trim()) cwa.setKey(key);
  const r = await cwa.weather(settings.city);
  return r.error ? { ok: false, error: r.error } : { ok: true, place: r.place, temp: r.current.temperature_2m, desc: r.current.desc };
});
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
  google,
  onUpdate: (data) => {
    sendToKind("calendar", "cal:update", data);
    managerWin?.webContents.send("mgr:refresh");
  },
});
ipcMain.handle("cal:get", () => calendar.get());
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
ipcMain.on("popup:close", () => { clearTimeout(popupTimer); popupDevice = null; popup?.setIgnoreMouseEvents(true, { forward: true }); }); // 瀏海收回去了

/* ───────── 智慧家庭：Philips Hue（本機 Bridge） ───────── */
const hue = createHue(settings, saveSettings, log);
// Matter（Tapo 冷氣、電扇…）：配對過才啟動（matter.js 很大，沒用到就不要載）
let matter = null;
const matterHome = () => (matter ||= createMatterHome({ storageDir: path.join(app.getPath("userData"), "matter"), log }));
const matterOn = () => !!settings.matter?.paired;
async function matterItems() {
  if (!matterOn()) return [];
  try { return await matterHome().state(); } catch (e) { log("matter state failed", e.message); return []; }
}
ipcMain.handle("home:get", async () => {
  const [h, m] = await Promise.all([hue.state(), matterItems()]);
  const prefs = hue.info();
  if (!m.length) return { ...h, prefs };
  // 有 Matter 設備：Hue 沒設定也照樣顯示 Matter 的方塊
  return { items: [...m, ...(h.items || [])], prefs, hueError: h.items ? undefined : h.error };
});
ipcMain.handle("home:set", async (_e, id, on) => {
  const r = String(id).startsWith("m") ? await matterHome().set(String(id), { on: !!on }) : await hue.set(String(id), !!on);
  sendToKind("home", "home:changed");
  return r;
});
// 調整：燈＝{ bri }、冷氣＝{ setpoint }、電扇＝{ pct }
ipcMain.handle("home:adjust", async (_e, id, v = {}) => {
  id = String(id);
  if (id.startsWith("m")) return matterHome().set(id, {
    ...(typeof v.setpoint === "number" ? { setpoint: v.setpoint } : {}),
    ...(typeof v.pct === "number" ? { pct: v.pct } : {}),
    ...([1, 3, 4, 7, 8].includes(v.mode) ? { mode: v.mode } : {}),
  });
  if (v.color) return hue.setColor(id, v.color);
  return hue.setBri(id, Number(v.bri));
});
ipcMain.handle("matter:info", () => ({ paired: matterOn() }));
ipcMain.handle("matter:pair", async (_e, code) => {
  const r = await matterHome().pair(String(code || ""));
  if (r.ok) { settings.matter = { paired: true }; saveSettings(); sendToKind("home", "home:changed"); }
  return r;
});
ipcMain.handle("matter:unpair", async () => {
  if (matterOn()) await matterHome().unpairAll().catch(() => {});
  settings.matter = { paired: false };
  saveSettings();
  sendToKind("home", "home:changed");
  return { ok: true };
});
ipcMain.handle("home:bri", (_e, id, pct) => hue.setBri(String(id), Number(pct)));
ipcMain.handle("hue:info", () => hue.info());
ipcMain.handle("hue:discover", () => hue.discover());
ipcMain.handle("hue:pair", async (_e, ip) => {
  const r = await hue.pair(String(ip || "").trim());
  if (r.ok) sendToKind("home", "home:changed");
  return r;
});
ipcMain.handle("hue:unpair", () => { hue.unpair(); sendToKind("home", "home:changed"); return hue.info(); });
ipcMain.handle("hue:prefs", (_e, prefs) => { hue.setPrefs(prefs || {}); sendToKind("home", "home:changed"); return hue.info(); });

/* ───────── 遊戲模式：玩遊戲時把小組件整個關掉，省記憶體 ───────── */
// 玩全螢幕遊戲時桌面本來就看不到，所以把小組件畫面、瀏海通知、背景小幫手（PowerShell）都關掉，
// 只留主程式偵測什麼時候玩完；玩完自動全部開回來。
// 偵測方式：Steam 會在登錄檔 HKCU\Software\Valve\Steam 的 RunningAppID 寫「正在玩的遊戲編號」（沒在玩是 0）。
let gaming = false;
let gameChecking = false;
function runQuiet(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
}
async function detectGame() {
  const mode = settings.gameMode || "game";
  if (mode === "off" || process.platform !== "win32") return false;
  if (mode === "steam") {
    const out = await runQuiet("tasklist", ["/FI", "IMAGENAME eq steam.exe", "/NH", "/FO", "CSV"]);
    return /"steam\.exe"/i.test(out);
  }
  const out = await runQuiet("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "RunningAppID"]);
  const m = out.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  return !!m && parseInt(m[1], 16) !== 0;
}
async function checkGame() {
  if (gameChecking) return;
  gameChecking = true;
  try {
    const on = await detectGame();
    if (on !== gaming) setGaming(on);
  } finally { gameChecking = false; }
}
function setGaming(on) {
  gaming = on;
  log("game mode", on);
  tray?.setToolTip(on ? "Glass Widgets（遊戲模式：小組件暫停）" : "Glass Widgets");
  if (on) {
    hidePopup();
    for (const w of [hostWin, popup]) if (w && !w.isDestroyed()) w.destroy();
    hostWin = null; popup = null; popupReady = false;
    if (helper) { helper.kill(); helper = null; }
    session.defaultSession.clearCache().catch(() => {}); // 圖片、網頁快取也清掉
  } else {
    firstSnapshot = true; // 玩遊戲時接上的裝置不要一口氣跳一堆通知
    if (!helper) { startHelper(); syncPods(); }
    createHost();
    ensurePopup();
  }
  managerWin?.webContents.send("mgr:refresh");
}
function startGameWatch() {
  setTimeout(checkGame, 10 * 1000);
  setInterval(checkGame, 15 * 1000); // 每 15 秒看一次（只是讀一個登錄檔值，很輕）
}

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
    startHelper();
    syncPods();
    cleanupPinterestHome();
    phonePush.apply();
    createHost();
    refreshWallpaper(true);
    setInterval(refreshWallpaper, 30 * 1000); // 換桌布時跟著換（只看檔案時間，很省）
    for (const ev of ["display-metrics-changed", "display-added", "display-removed"]) screen.on(ev, fitHostToScreen);
    calendar.start();
    setupUpdater();
    startAutoLocate();
    startGameWatch();
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
    matter?.close();
    helper?.kill();
  });
  app.on("window-all-closed", () => {}); // 關掉所有小組件也不要結束，留在系統匣
}
