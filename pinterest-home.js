// Pinterest「首頁推薦」：讀網頁版 pinterest.com 首頁（依使用者興趣推薦的那些圖）
// - 官方 API 沒有提供首頁推薦，所以用網頁：使用者在程式的視窗裡登入一次 pinterest.com，
//   登入資料（cookie）只存在這台電腦、這個程式自己的瀏覽資料夾裡
// - 要抓圖時開一個看不到的視窗打開首頁、往下捲幾次、把 pin 的圖片和連結記下來，然後馬上關掉
// - 這不是官方 API，Pinterest 改網頁的話可能要再修

const { BrowserWindow, session } = require("electron");

const PARTITION = "persist:pinterest-web";
const HOME = "https://www.pinterest.com/";
const CACHE_MS = 50 * 60 * 1000;

function createPinterestHome(log = () => {}) {
  let cache = null, cacheAt = 0, busy = null, loginWin = null;

  const ses = () => {
    const s = session.fromPartition(PARTITION);
    // 用一般 Chrome 的瀏覽器識別（拿掉 Electron 字樣），網頁才會跟在 Chrome 裡一樣
    if (!s.__uaSet) {
      const os = process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
      s.setUserAgent(`Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
      s.__uaSet = true;
    }
    return s;
  };

  async function isLoggedIn() {
    try {
      const c = await ses().cookies.get({ name: "_auth" });
      return c.some((x) => x.value === "1");
    } catch { return false; }
  }

  // 打開一個看得到的視窗讓使用者登入；登入成功會自己關掉
  function login() {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return Promise.resolve(false); }
    return new Promise((resolve) => {
      loginWin = new BrowserWindow({
        width: 520, height: 760, title: "登入 Pinterest", autoHideMenuBar: true,
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true },
      });
      ses();
      loginWin.loadURL("https://www.pinterest.com/login/");
      let done = false;
      const timer = setInterval(async () => {
        if (await isLoggedIn()) {
          done = true;
          clearInterval(timer);
          cache = null;
          log("pinterest web login ok");
          if (loginWin && !loginWin.isDestroyed()) loginWin.close();
        }
      }, 1000);
      loginWin.on("closed", () => { clearInterval(timer); loginWin = null; resolve(done); });
    });
  }

  async function logout() {
    cache = null;
    await ses().clearStorageData().catch(() => {});
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 網頁裡跑的：找出所有 pin 的圖片和連結
  const COLLECT = `(() => {
    const out = [];
    for (const img of document.images) {
      let src = img.currentSrc || img.src || "";
      const set = (img.srcset || "").split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean);
      if (set.length) src = set[set.length - 1];
      if (!/^https:\\/\\/i\\.pinimg\\.com\\//.test(src)) continue;
      // 大頭貼、小圖示不要（只要 pin 的圖）
      const m = src.match(/\\/(\\d+)x\\d*\\//);
      if (m && Number(m[1]) < 170) continue;
      if (img.getBoundingClientRect().width < 100) continue;
      // 連結：外層的 /pin/ 連結，或 pin 卡片上的 id；都找不到就留空（點了開首頁）
      let link = img.closest('a[href*="/pin/"]')?.href || "";
      if (!link) {
        const card = img.closest('[data-test-id="pin"], [data-test-id="pinWrapper"], [data-test-pin-id], [role="listitem"]');
        link = card?.querySelector('a[href*="/pin/"]')?.href || "";
        const id = card?.getAttribute("data-test-pin-id");
        if (!link && id) link = "https://www.pinterest.com/pin/" + id + "/";
      }
      out.push({ img: src, link, title: (img.alt || "").slice(0, 120) });
    }
    return { url: location.href, pins: out };
  })()`;

  async function load() {
    if (!(await isLoggedIn())) return { loginExpired: true, error: "請先用網頁登入 Pinterest" };
    const win = new BrowserWindow({
      show: false, width: 1280, height: 1600,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: false },
    });
    ses();
    try {
      // 不等「完全載入完」（Pinterest 會一直在背景載東西），最多等 20 秒就開始讀
      await Promise.race([win.loadURL(HOME).catch(() => {}), sleep(20000)]);
      const seen = new Map();
      let lastUrl = HOME;
      for (let i = 0; i < 10 && seen.size < 150; i++) {
        await sleep(i === 0 ? 2500 : 1300);
        const r = await win.webContents.executeJavaScript(COLLECT, true);
        lastUrl = r.url;
        if (/\/login/.test(r.url)) break;
        for (const p of r.pins) {
          // 換成比較清楚的大小（736 寬）
          // 736 寬的版本一定是 .jpg（.png 換過去會 403）；原本的網址留著，載不到時用
          const img = p.img.replace(/\/(\d+x\d*|originals)\//, "/736x/").replace(/\.(png|gif|webp)$/i, ".jpg");
          if (!seen.has(img)) seen.set(img, { ...p, img, orig: p.img, link: p.link || HOME });
        }
        await win.webContents.executeJavaScript("window.scrollBy(0, window.innerHeight * 1.5)", true);
      }
      if (/\/login/.test(lastUrl)) return { loginExpired: true, error: "Pinterest 網頁登入過期了" };
      const pins = [...seen.values()];
      log("pinterest home", pins.length);
      if (!pins.length) return { error: "首頁沒有讀到圖（Pinterest 可能改了網頁）" };
      for (let i = pins.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pins[i], pins[j]] = [pins[j], pins[i]]; }
      return { title: "首頁推薦", pins };
    } catch (e) {
      log("pinterest home error", e.message);
      return { error: "讀不到 Pinterest 首頁：" + e.message };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  async function fetchHome(force = false) {
    if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    busy ||= load().finally(() => { busy = null; });
    const r = await busy;
    if (r.pins) { cache = r; cacheAt = Date.now(); }
    return r;
  }

  return { login, logout, isLoggedIn, fetchHome };
}

module.exports = { createPinterestHome };
