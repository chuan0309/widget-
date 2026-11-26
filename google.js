// 「使用 Google 帳號登入」→ 讀 Google 日曆（官方 Calendar API，只讀）。
//
// 流程跟一般桌面程式一樣：
//   1. 打開瀏覽器到 Google 登入頁，使用者選帳號、按「允許」
//   2. Google 把瀏覽器導回 http://127.0.0.1:<隨機埠>/，這裡開一個只聽本機的小伺服器接住
//   3. 用拿到的 code 換 token（有 PKCE 保護，別人攔到 code 也沒用）
// 程式的 Google 用戶端 ID 是打包時放進去的（oauth.json），使用者不用填任何東西。
// refresh token 用 Windows 加密（safeStorage）存起來。

const { net, shell, safeStorage } = require("electron");
const http = require("http");
const crypto = require("crypto");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPES = "openid email https://www.googleapis.com/auth/calendar.readonly";
const LOGIN_TIMEOUT = 5 * 60 * 1000;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function createGoogle({ settings, save, config }) {
  const G = () => settings.calendar.google || (settings.calendar.google = {});
  const configured = () => !!(config.clientId && config.clientSecret);

  const seal = (t) => (!t ? "" : safeStorage.isEncryptionAvailable()
    ? "enc:" + safeStorage.encryptString(t).toString("base64") : t);
  const unseal = (t) => {
    if (!t?.startsWith("enc:")) return t || "";
    try { return safeStorage.decryptString(Buffer.from(t.slice(4), "base64")); } catch { return ""; }
  };

  class LoginExpired extends Error {
    constructor() { super("Google 登入過期了，請重新登入"); this.loginExpired = true; }
  }

  async function tokenRequest(form) {
    const res = await net.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...form }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      if (data.error === "invalid_grant") throw new LoginExpired();
      throw new Error(data.error_description || data.error || `Google 拒絕了登入（${res.status}）`);
    }
    const g = G();
    g.accessToken = seal(data.access_token);
    g.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    if (data.refresh_token) g.refreshToken = seal(data.refresh_token);
    if (data.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64").toString("utf8"));
        if (payload.email) g.email = payload.email;
      } catch {}
    }
    save();
  }

  async function accessToken() {
    const g = G();
    if (!unseal(g.refreshToken)) throw new LoginExpired();
    if (!unseal(g.accessToken) || (g.expiresAt || 0) - Date.now() < 60 * 1000) {
      await tokenRequest({ grant_type: "refresh_token", refresh_token: unseal(g.refreshToken) });
    }
    return unseal(G().accessToken);
  }

  async function get(path, retried = false) {
    const res = await net.fetch(API + path, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (res.status === 401 && !retried) { G().expiresAt = 0; return get(path, true); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Google 日曆回應錯誤（${res.status}）`);
    return data;
  }

  /* ───── 登入 ───── */
  let pending = null;
  function login() {
    if (!configured()) return Promise.resolve({ error: "這個版本沒有設定 Google 登入" });
    pending?.cancel("已經重新開始登入");
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    return new Promise((resolve) => {
      let finished = false;
      const server = http.createServer();
      const finish = (result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        server.close();
        pending = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ error: "等太久了，請再按一次登入" }), LOGIN_TIMEOUT);
      pending = { cancel: (why) => finish({ error: why }) };

      server.on("request", async (req, res) => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname !== "/") { res.writeHead(404).end(); return; }
        const reply = (ok, text) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(resultPage(ok, text));
        };
        if (url.searchParams.get("state") !== state) return reply(false, "登入驗證失敗，請回到 Glass Widgets 重新登入。");
        const code = url.searchParams.get("code");
        if (!code) { reply(false, "你沒有允許存取。"); return finish({ error: "沒有完成授權" }); }
        try {
          await tokenRequest({
            grant_type: "authorization_code", code, code_verifier: verifier,
            redirect_uri: `http://127.0.0.1:${server.address().port}/`,
          });
          reply(true, "登入成功！可以關掉這個分頁，回到 Glass Widgets。");
          finish({ ok: true, email: G().email || "" });
        } catch (e) {
          reply(false, e.message);
          finish({ error: e.message });
        }
      });
      server.on("error", () => finish({ error: "沒辦法在本機開啟登入用的連線" }));
      // 只聽本機、隨機埠（Google 的桌面程式允許任何本機埠）
      server.listen(0, "127.0.0.1", () => {
        const u = new URL(AUTH_URL);
        u.search = new URLSearchParams({
          client_id: config.clientId,
          redirect_uri: `http://127.0.0.1:${server.address().port}/`,
          response_type: "code",
          scope: SCOPES,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          access_type: "offline",
          prompt: "consent select_account",
        }).toString();
        shell.openExternal(u.href);
      });
    });
  }

  async function logout() {
    pending?.cancel("已登出");
    const rt = unseal(G().refreshToken);
    settings.calendar.google = {};
    save();
    if (rt) {
      try {
        await net.fetch(REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: rt }).toString(),
        });
      } catch {}
    }
  }

  const isLoggedIn = () => !!unseal(G().refreshToken);

  /* ───── 日曆 ───── */
  async function listCalendars() {
    const data = await get("/users/me/calendarList?minAccessRole=reader&maxResults=250");
    const chosen = G().chosen || {};
    return (data.items || [])
      .filter((c) => !c.deleted)
      .map((c) => ({
        id: c.id,
        name: c.summaryOverride || c.summary || c.id,
        color: c.backgroundColor || "#0a84ff",
        primary: !!c.primary,
        // 沒選過的話，跟 Google 日曆網頁上有勾的一樣
        on: c.id in chosen ? !!chosen[c.id] : c.selected !== false,
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  function chooseCalendar(id, on) {
    const g = G();
    g.chosen = { ...(g.chosen || {}), [id]: !!on };
    save();
  }

  const toMs = (t) => {
    if (t?.dateTime) return new Date(t.dateTime).getTime();
    if (t?.date) { const [y, m, d] = t.date.split("-").map(Number); return new Date(y, m - 1, d).getTime(); }
    return NaN;
  };

  async function fetchEvents(from, to) {
    if (!isLoggedIn()) return { events: [], sources: [] };
    const cals = (await listCalendars()).filter((c) => c.on);
    const q = new URLSearchParams({
      timeMin: from.toISOString(), timeMax: to.toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: "250",
    });
    const results = await Promise.all(cals.map(async (c) => {
      try {
        const data = await get(`/calendars/${encodeURIComponent(c.id)}/events?${q}`);
        return {
          info: { name: c.name, color: c.color },
          events: (data.items || []).filter((e) => e.status !== "cancelled").map((e) => ({
            title: e.summary || "（沒有標題）",
            start: toMs(e.start),
            end: toMs(e.end),
            allDay: !!e.start?.date,
            location: e.location || "",
            color: c.color,
          })).filter((e) => !Number.isNaN(e.start)),
        };
      } catch (err) {
        return { info: { name: c.name, color: c.color, error: err.message }, events: [] };
      }
    }));
    return { events: results.flatMap((r) => r.events), sources: results.map((r) => r.info) };
  }

  return { configured, login, logout, isLoggedIn, listCalendars, chooseCalendar, fetchEvents, email: () => G().email || "" };
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

module.exports = { createGoogle };
