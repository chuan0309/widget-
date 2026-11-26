// Pinterest 官方 API（v5）：用 OAuth 登入使用者自己的帳號，讀他的圖版和 pin。
// 流程：
//   1. 使用者在 developers.pinterest.com 建一個 App，拿到 App ID / App secret
//   2. 我們開瀏覽器到 Pinterest 的授權頁，使用者按「允許」
//   3. Pinterest 把瀏覽器導回 http://localhost:8085/?code=...，這裡開一個小伺服器接住它
//   4. 用 code 換 access token（30 天）＋ refresh token（60 天，每次更新會延長）
// 金鑰和 token 都用 Windows 的加密（DPAPI，透過 safeStorage）存起來，不會是明文。

const { net, shell, safeStorage } = require("electron");
const http = require("http");
const crypto = require("crypto");

const API = "https://api.pinterest.com/v5";
const AUTH_URL = "https://www.pinterest.com/oauth/";
const TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/`;
const SCOPES = "user_accounts:read,boards:read,boards:read_secret,pins:read,pins:read_secret";
const LOGIN_TIMEOUT = 5 * 60 * 1000;

function createPinterestApi({ settings, save }) {
  const P = () => settings.pinterest;

  const seal = (text) => {
    if (!text) return "";
    if (!safeStorage.isEncryptionAvailable()) return text;
    return "enc:" + safeStorage.encryptString(text).toString("base64");
  };
  const unseal = (text) => {
    if (!text?.startsWith("enc:")) return text || "";
    try { return safeStorage.decryptString(Buffer.from(text.slice(4), "base64")); } catch { return ""; }
  };

  /* ───── 換 token ───── */
  async function tokenRequest(form) {
    const { clientId } = P();
    const secret = unseal(P().clientSecret);
    const res = await net.fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(data.message || `Pinterest 拒絕了登入（${res.status}）`);
    }
    const now = Date.now();
    P().accessToken = seal(data.access_token);
    P().accessExpiresAt = now + (data.expires_in || 0) * 1000;
    if (data.refresh_token) {
      P().refreshToken = seal(data.refresh_token);
      P().refreshExpiresAt = now + (data.refresh_token_expires_in || 0) * 1000;
    }
    save();
  }

  async function refresh() {
    const rt = unseal(P().refreshToken);
    if (!rt) throw new LoginExpired();
    try {
      await tokenRequest({ grant_type: "refresh_token", refresh_token: rt });
    } catch {
      throw new LoginExpired();
    }
  }

  class LoginExpired extends Error {
    constructor() { super("登入過期了，請重新登入"); this.loginExpired = true; }
  }

  /* ───── 呼叫 API ───── */
  async function get(path, retried = false) {
    if (!unseal(P().accessToken)) throw new LoginExpired();
    // 還剩不到一天就先更新
    if (P().accessExpiresAt && P().accessExpiresAt - Date.now() < 24 * 3600 * 1000) await refresh();

    const res = await net.fetch(API + path, {
      headers: { Authorization: `Bearer ${unseal(P().accessToken)}`, Accept: "application/json" },
    });
    if (res.status === 401 && !retried) { await refresh(); return get(path, true); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(data.message || "");
      if (res.status === 403 && /PINNER_DATA_ACCESS_DENIED/i.test(msg + JSON.stringify(data))) {
        const e = new Error("Pinterest 不允許這個 App 讀取一般（非商業）帳號的資料，請看說明");
        e.accessDenied = true;
        throw e;
      }
      if (res.status === 401) throw new LoginExpired();
      throw new Error(msg || `Pinterest 回應錯誤（${res.status}）`);
    }
    return data;
  }

  /* ───── 登入 ───── */
  let pendingLogin = null;

  function login(clientId, clientSecret) {
    clientId = String(clientId || "").trim();
    clientSecret = String(clientSecret || "").trim();
    if (!/^\d+$/.test(clientId)) return Promise.resolve({ error: "App ID 應該是一串數字" });
    if (!clientSecret) return Promise.resolve({ error: "請填 App secret" });

    pendingLogin?.cancel("已經重新開始登入");
    P().clientId = clientId;
    P().clientSecret = seal(clientSecret);
    save();

    const state = crypto.randomBytes(16).toString("hex");
    return new Promise((resolve) => {
      const servers = [];
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        servers.forEach((s) => s.close());
        pendingLogin = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ error: "等太久了，請再按一次登入" }), LOGIN_TIMEOUT);
      pendingLogin = { cancel: (why) => finish({ error: why }) };

      const handler = async (req, res) => {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== "/") { res.writeHead(404).end(); return; }
        const reply = (ok, text) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(resultPage(ok, text));
        };
        if (url.searchParams.get("state") !== state) return reply(false, "登入驗證失敗，請回到小組件重新登入。");
        const code = url.searchParams.get("code");
        if (!code) {
          reply(false, "你沒有允許存取，或是 Pinterest 回傳錯誤。");
          return finish({ error: "沒有完成授權" });
        }
        try {
          await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
          const me = await get("/user_account").catch(() => ({}));
          P().mode = "api";
          P().username = me.username || "";
          save();
          reply(true, "登入成功！可以關掉這個分頁，回到桌面選圖版。");
          finish({ ok: true, username: P().username });
        } catch (e) {
          reply(false, e.message);
          finish({ error: e.message });
        }
      };

      // localhost 可能是 IPv4 也可能是 IPv6，兩個都聽；只綁本機，不會對外開放
      let listening = 0, failed = 0;
      for (const host of ["127.0.0.1", "::1"]) {
        const server = http.createServer(handler);
        server.on("error", () => {
          failed++;
          if (failed === 2) finish({ error: `本機 ${PORT} 埠被別的程式占用了` });
        });
        server.listen(PORT, host, () => {
          if (++listening === 1) {
            const url = new URL(AUTH_URL);
            url.search = new URLSearchParams({
              client_id: clientId,
              redirect_uri: REDIRECT_URI,
              response_type: "code",
              scope: SCOPES,
              state,
            }).toString();
            shell.openExternal(url.href);
          }
        });
        servers.push(server);
      }
    });
  }

  function logout() {
    pendingLogin?.cancel("已登出");
    Object.assign(P(), {
      mode: "rss", accessToken: "", refreshToken: "", accessExpiresAt: 0, refreshExpiresAt: 0,
      username: "", source: null,
    });
    save();
  }

  /* ───── 圖版和 pin ───── */
  async function listBoards() {
    const boards = [];
    let bookmark = "";
    for (let page = 0; page < 4; page++) {
      const q = new URLSearchParams({ page_size: "100", privacy: "PUBLIC_AND_SECRET" });
      if (bookmark) q.set("bookmark", bookmark);
      const data = await get(`/boards?${q}`);
      for (const b of data.items || []) {
        boards.push({
          id: b.id,
          name: b.name,
          secret: b.privacy === "SECRET",
          count: b.pin_count ?? null,
          cover: b.media?.image_cover_url || b.media?.pin_thumbnail_urls?.[0] || "",
        });
      }
      bookmark = data.bookmark;
      if (!bookmark) break;
    }
    return boards;
  }

  function pinImage(media = {}) {
    const pick = (images) => images?.["600x"]?.url || images?.["1200x"]?.url || images?.["400x300"]?.url;
    return pick(media.images) || pick(media.items?.find((i) => i.images)?.images) || media.cover_image_url || "";
  }

  async function fetchPins() {
    const src = P().source;
    if (!src) return { needBoard: true };
    const base = src.id === "all" ? "/pins" : `/boards/${encodeURIComponent(src.id)}/pins`;
    // 多抓一點（最多 500 張），小組件會隨機輪播
    const seen = new Set();
    const pins = [];
    let bookmark = "";
    for (let page = 0; page < 5; page++) {
      const q = new URLSearchParams({ page_size: "100" });
      if (bookmark) q.set("bookmark", bookmark);
      const data = await get(`${base}?${q}`);
      for (const p of data.items || []) {
        const img = pinImage(p.media);
        if (!/^https:\/\/i\.pinimg\.com\//.test(img) || seen.has(img)) continue;
        seen.add(img);
        pins.push({ img, link: `https://www.pinterest.com/pin/${p.id}/`, title: String(p.title || p.description || p.alt_text || "").slice(0, 120) });
      }
      bookmark = data.bookmark;
      if (!bookmark) break;
    }
    if (pins.length === 0) return { title: src.name, error: "這個圖版裡還沒有圖片" };
    // 洗牌：每次順序都不一樣
    for (let i = pins.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pins[i], pins[j]] = [pins[j], pins[i]]; }
    return { title: src.name, pins };
  }

  function chooseSource(source) {
    P().source = source && source.id ? { id: String(source.id), name: String(source.name || "") } : null;
    save();
  }

  const isLoggedIn = () => P().mode === "api" && !!unseal(P().accessToken);

  return { login, logout, listBoards, fetchPins, chooseSource, isLoggedIn, REDIRECT_URI };
}

function resultPage(ok, text) {
  const esc = String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><title>Glass Widgets</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:'Segoe UI','Microsoft JhengHei',sans-serif;
background:linear-gradient(160deg,#1b2a6b,#5b2a86 45%,#c2477a 80%,#f39a5c);color:#fff">
<div style="padding:36px 44px;border-radius:28px;text-align:center;background:rgba(255,255,255,.16);
backdrop-filter:blur(20px);box-shadow:inset 0 1px 1px rgba(255,255,255,.6),0 20px 50px rgba(0,0,0,.25)">
<div style="font-size:44px">${ok ? "✓" : "!"}</div><p style="font-size:18px;margin:12px 0 0">${esc}</p></div></body>`;
}

module.exports = { createPinterestApi };
