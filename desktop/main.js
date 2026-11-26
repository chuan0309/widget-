const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme, nativeImage, shell, net } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

/* ───────── 設定檔（存在 %APPDATA%\Glass Widgets\settings.json）───────── */
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const DEFAULTS = {
  glass: "acrylic", // "acrylic" = Windows 11 毛玻璃；"transparent" = 透明圓角（不模糊）
  widgets: { clock: true, weather: true, battery: true, pinterest: true },
  positions: {},
  city: { name: "台北市", lat: 25.033, lon: 121.565 },
  pinterest: { feed: "" }, // 例如 https://www.pinterest.com/帳號/圖版.rss
};
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return {
      ...DEFAULTS, ...saved,
      widgets: { ...DEFAULTS.widgets, ...saved.widgets },
      pinterest: { ...DEFAULTS.pinterest, ...saved.pinterest },
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
  win.on("moved", () => {
    const [x, y] = win.getPosition();
    settings.positions[kind] = { x, y };
    saveSettings();
  });
  win.on("closed", () => delete widgetWins[kind]);
  widgetWins[kind] = win;
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

function handleDevices(next) {
  const wasConnected = new Set(devices.filter((d) => d.connected).map((d) => d.id));
  devices = next;
  broadcast("devices", devices);

  if (firstSnapshot) { firstSnapshot = false; return; } // 開程式前就連著的不跳通知
  for (const d of next) {
    if (d.connected && !wasConnected.has(d.id)) showPopup(d);
    // 通知還開著時，電量晚一點才讀到就順便更新
    if (popupDevice && d.id === popupDevice.id && popup && !popup.isDestroyed()) {
      popupDevice = d;
      popup.webContents.send("popup:device", d);
    }
  }
}

function broadcast(channel, data) {
  for (const w of Object.values(widgetWins)) if (!w.isDestroyed()) w.webContents.send(channel, data);
}

/* ───────── 系統匣圖示 ───────── */
let tray = null;
function buildTrayMenu() {
  const toggleWidget = (kind) => () => {
    settings.widgets[kind] = !settings.widgets[kind];
    saveSettings();
    if (settings.widgets[kind]) createWidget(kind);
    else widgetWins[kind]?.destroy();
  };
  const setGlass = (mode) => () => {
    settings.glass = mode;
    saveSettings();
    rebuildWidgets();
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "顯示測試通知", click: () => showPopup({ id: "demo", name: "Aero Buds Pro", connected: true, battery: 85 }) },
    { label: "把小組件叫回來", click: showAllWidgets },
    { type: "separator" },
    { label: "時鐘", type: "checkbox", checked: settings.widgets.clock, click: toggleWidget("clock") },
    { label: "天氣", type: "checkbox", checked: settings.widgets.weather, click: toggleWidget("weather") },
    { label: "電量", type: "checkbox", checked: settings.widgets.battery, click: toggleWidget("battery") },
    { label: "Pinterest", type: "checkbox", checked: settings.widgets.pinterest, click: toggleWidget("pinterest") },
    { type: "separator" },
    { label: "玻璃效果：毛玻璃（Win11）", type: "radio", checked: settings.glass === "acrylic", click: setGlass("acrylic") },
    { label: "玻璃效果：透明圓角", type: "radio", checked: settings.glass === "transparent", click: setGlass("transparent") },
    { type: "separator" },
    {
      label: "開機自動啟動", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: "開啟設定檔（改城市）", click: () => { saveSettings(); shell.openPath(SETTINGS_FILE); } },
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

async function fetchPins() {
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

ipcMain.handle("pins:get", fetchPins);
ipcMain.handle("pins:set", async (_e, input) => {
  const feed = pinterestFeedFrom(input);
  if (!feed) return { needSetup: true, error: "請貼 Pinterest 的個人頁或圖版網址" };
  const prev = settings.pinterest.feed;
  settings.pinterest.feed = feed;
  const result = await fetchPins();
  if (result.error) settings.pinterest.feed = prev; // 抓不到就不要存
  else saveSettings();
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
  app.on("second-instance", showAllWidgets);
  app.whenReady().then(() => {
    nativeTheme.themeSource = "dark"; // 讓毛玻璃是深色，白字才看得清楚
    app.setAppUserModelId("local.glasswidgets.app");
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")));
    tray.setToolTip("Glass Widgets");
    tray.on("click", showAllWidgets);
    buildTrayMenu();
    rebuildWidgets();
    startWatcher();
  });
  app.on("before-quit", () => {
    app.isQuitting = true;
    watcher?.kill();
  });
  app.on("window-all-closed", () => {}); // 關掉所有小組件也不要結束，留在系統匣
}
