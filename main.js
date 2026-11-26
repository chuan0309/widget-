const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme, nativeImage, shell, net } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { createPinterestApi } = require("./pinterest-api");
const wallpaper = require("./wallpaper");

/* ───────── 設定檔（存在 %APPDATA%\Glass Widgets\settings.json）───────── */
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const DEFAULTS = {
  // "ios"：大圓角＋模糊桌布（像 iPhone）；"acrylic"：Windows 11 內建毛玻璃（圓角比較小）
  glass: "ios",
  widgets: { clock: true, weather: true, battery: true, pinterest: true },
  positions: {},
  city: { name: "台北市", lat: 25.033, lon: 121.565 },
  // mode "rss"：讀公開網址；mode "api"：登入帳號（官方 API）
  pinterest: { mode: "rss", feed: "" },
  bluetooth: { notifyConnect: true, notifyLow: true, lowThreshold: 20, muted: {} },
};
const FIRST_RUN = !fs.existsSync(SETTINGS_FILE);
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    if (saved.glass === "transparent") saved.glass = "ios"; // 舊版設定
    return {
      ...DEFAULTS, ...saved,
      widgets: { ...DEFAULTS.widgets, ...saved.widgets },
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
const WIDGETS = {
  clock: { width: 170, height: 170 },
  weather: { width: 170, height: 170 },
  battery: { width: 356, height: 170 },
  pinterest: { width: 356, height: 356 },
};
const widgetWins = {};

function defaultPosition(kind) {
  const wa = screen.getPrimaryDisplay().workArea;
  const right = wa.x + wa.width - 24;
  const top = wa.y + 24;
  if (kind === "battery") return { x: right - 356, y: top };
  if (kind === "clock") return { x: right - 356, y: top + 186 };
  if (kind === "pinterest") return { x: right - 356, y: top + 372 };
  return { x: right - 170, y: top + 186 };
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

function createWidget(kind) {
  const saved = settings.positions[kind];
  const pos = saved && onSomeScreen(saved) ? saved : defaultPosition(kind);
  const win = new BrowserWindow({
    ...WIDGETS[kind],
    ...pos,
    ...glassOptions(),
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "widget.html"), {
    query: { kind, glass: settings.glass },
  });
  win.once("ready-to-show", () => win.showInactive());
  // 拖動時一直更新背景桌布的位置，玻璃後面的畫面才會對得上
  win.on("move", () => sendBackdrop(win));
  win.webContents.on("did-finish-load", () => sendBackdrop(win, true));
  win.on("moved", () => {
    const [x, y] = win.getPosition();
    settings.positions[kind] = { x, y };
    saveSettings();
  });
  win.on("closed", () => delete widgetWins[kind]);
  widgetWins[kind] = win;
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
  for (const kind of Object.keys(WIDGETS)) if (settings.widgets[kind]) createWidget(kind);
}

function showAllWidgets() {
  Object.values(widgetWins).forEach((w) => w.showInactive());
}

/* ───────── 藍牙連線通知視窗 ───────── */
let popup = null;
let popupTimer = null;
let popupDevice = null;

function showPopup(device) {
  popupDevice = device;
  clearTimeout(popupTimer);
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send("popup:device", device);
  } else {
    const W = 360, H = 400;
    const wa = screen.getPrimaryDisplay().workArea;
    const x = wa.x + wa.width - W - 16;
    const y = wa.y + wa.height - H - 16;
    popup = new BrowserWindow({
      width: W, height: H, x, y: y + 24,
      ...glassOptions(),
      resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true },
    });
    popup.setAlwaysOnTop(true, "screen-saver");
    popup.loadFile(path.join(__dirname, "renderer", "popup.html"), { query: { glass: settings.glass } });
    popup.once("ready-to-show", () => {
      popup.webContents.send("popup:device", popupDevice);
      popup.setOpacity(0);
      popup.showInactive();
      animate(popup, { fromY: y + 24, toY: y, fromO: 0, toO: 1 });
    });
    popup.on("closed", () => (popup = null));
  }
  popupTimer = setTimeout(hidePopup, 7000);
}

function hidePopup() {
  clearTimeout(popupTimer);
  if (!popup || popup.isDestroyed()) return;
  const win = popup;
  const [, y] = win.getPosition();
  animate(win, { fromY: y, toY: y + 24, fromO: 1, toO: 0 }, () => win.destroy());
}

// 視窗淡入/滑入的小動畫（Windows 視窗本身沒有 CSS 動畫可以用）
function animate(win, { fromY, toY, fromO, toO }, done) {
  const start = Date.now(), dur = 260;
  const [x] = win.getPosition();
  const t = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(t);
    const p = Math.min(1, (Date.now() - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    win.setPosition(x, Math.round(fromY + (toY - fromY) * e));
    win.setOpacity(fromO + (toO - fromO) * e);
    if (p === 1) { clearInterval(t); done?.(); }
  }, 16);
}

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
      const line = buf.slice(0, i).trim();
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

function handleDevices(raw) {
  const next = mergeSameDevice(raw);
  const wasConnected = new Set(devices.filter((d) => d.connected).map((d) => d.id));
  devices = next;
  broadcast("devices", devices);

  const first = firstSnapshot;
  firstSnapshot = false;
  const bt = settings.bluetooth;
  for (const d of next) {
    const muted = !!bt.muted[d.id]; // 在管理程式裡關掉這台的通知
    // 新連上的裝置 → 跳通知（開程式前就連著的不跳）
    if (!first && bt.notifyConnect && !muted && d.connected && !wasConnected.has(d.id)) showPopup(d);

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
  const { pinterest, ...rest } = settings;
  return {
    settings: { ...rest, positions: undefined },
    devices,
    autostart: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion(),
    isWin11: IS_WIN11,
    dataFolder: app.getPath("userData"),
  };
}

ipcMain.handle("mgr:get", managerState);
ipcMain.handle("mgr:set", (_e, patch = {}) => {
  if (patch.widgets) for (const [k, v] of Object.entries(patch.widgets)) if (k in WIDGETS) setWidgetEnabled(k, !!v);
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
  if (patch.city && typeof patch.city.lat === "number" && typeof patch.city.lon === "number") {
    settings.city = { name: String(patch.city.name || "").slice(0, 40), lat: patch.city.lat, lon: patch.city.lon };
    widgetWins.weather?.webContents.reload(); // 天氣小組件重新讀
  }
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
ipcMain.on("mgr:test-popup", () => showPopup({ id: "demo", name: "Aero Buds Pro", connected: true, battery: 85 }));
ipcMain.on("mgr:open-folder", () => shell.openPath(app.getPath("userData")));
ipcMain.on("mgr:quit", () => app.quit());
// 管理程式改了 Pinterest 設定 → 通知 Pinterest 小組件重新讀
ipcMain.on("mgr:pins-changed", () => widgetWins.pinterest?.webContents.send("pins:changed"));

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
}));
ipcMain.handle("pins:login", (_e, { clientId, clientSecret }) => pinApi.login(clientId, clientSecret));
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
ipcMain.handle("get-state", () => ({ devices, city: settings.city }));
ipcMain.on("popup:close", hidePopup);

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
    if (FIRST_RUN) { saveSettings(); openManager(); } // 第一次打開時順便打開管理程式
  });
  app.on("before-quit", () => {
    app.isQuitting = true;
    watcher?.kill();
  });
  app.on("window-all-closed", () => {}); // 關掉所有小組件也不要結束，留在系統匣
}
