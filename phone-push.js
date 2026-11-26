// iPhone 充電即時通知：iPhone「捷徑」App 的自動化（充電器接上／拔掉）直接通知這台電腦
// - 藍牙只會給電量數字，沒有「是不是在充電」；只能等電量變多才猜得到，所以會慢好幾分鐘
// - 捷徑的「充電器」自動化在接上的那一刻就會跑，發一個網址給電腦，電腦馬上知道
// - 只接受同一個區域網路（家裡 Wi-Fi）來的、而且帶著正確密碼（token）的請求

const http = require("http");
const os = require("os");
const crypto = require("crypto");

const PORT = 47833;
// 只接受區域網路來的連線（家裡 Wi-Fi、熱點）
const isLan = (ip) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|f[cd])/i.test(String(ip).replace(/^::ffff:/, ""));

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal && isLan(a.address) && !a.address.startsWith("169.254.")) out.push(a.address);
  }
  // 家裡 Wi-Fi 常見的 192.168 排前面
  return out.sort((a, b) => (b.startsWith("192.168.") ? 1 : 0) - (a.startsWith("192.168.") ? 1 : 0));
}

function createPhonePush(settings, saveSettings, onUpdate, log = () => {}) {
  const S = () => (settings.phonePush ||= { on: false, token: "" });
  let server = null, state = null, watch = null, status = "off";

  const token = () => {
    if (!S().token) { S().token = crypto.randomBytes(9).toString("base64url"); saveSettings(); }
    return S().token;
  };

  function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const send = (code, text) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }); res.end(text); };
    if (!isLan(req.socket.remoteAddress)) return send(403, "no");
    if (url.pathname !== "/phone") return send(404, "?");
    const t = url.searchParams.get("t") || "";
    const want = token();
    if (t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) return send(403, "密碼不對");
    const c = url.searchParams.get("charging");
    // 電量：捷徑的「電池電量」可能是 63、63.0 或 0.63
    let level = Number(String(url.searchParams.get("level") || "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(level) && level > 0 && level <= 1 && String(url.searchParams.get("level")).includes(".")) level *= 100;
    // device=watch：Apple Watch 自己的捷徑傳來的（手錶沒辦法自動傳，要在手錶上點一下）
    const isWatch = /^watch$/i.test(url.searchParams.get("device") || "");
    const prev = isWatch ? watch : state;
    const next = {
      charging: c == null ? prev?.charging ?? null : /^(1|true|yes|on)$/i.test(c),
      level: Number.isFinite(level) && level > 0 && level <= 100 ? Math.round(level) : prev?.level ?? null,
      at: Date.now(),
      watch: isWatch,
    };
    if (isWatch) watch = next; else state = next;
    log(isWatch ? "watch push" : "phone push", next.charging, next.level);
    onUpdate(next);
    send(200, "ok");
  }

  function start() {
    if (server) return;
    status = "starting";
    server = http.createServer(handle);
    server.on("error", (e) => { log("phone push error", e.code || e.message); status = e.code === "EADDRINUSE" ? "busy" : "error"; server = null; });
    server.listen(PORT, "0.0.0.0", () => { status = "on"; log("phone push listening", PORT); });
  }
  function stop() { if (server) server.close(); server = null; status = "off"; }

  function apply() { if (S().on) start(); else stop(); }

  return {
    apply,
    setOn(on) { S().on = !!on; saveSettings(); apply(); },
    newToken() { S().token = ""; token(); },
    // 給管理程式看的：開了沒、網址
    info() {
      const ips = lanAddresses();
      const base = `http://${ips[0] || "電腦的IP"}:${PORT}/phone?t=${token()}`;
      return { on: !!S().on, status, ips, port: PORT, plugUrl: `${base}&charging=1&level=`, unplugUrl: `${base}&charging=0&level=`, watchUrl: `${base}&device=watch&level=`, last: state, lastWatch: watch };
    },
    // 捷徑傳來的狀態：充電狀態 12 小時內有效（拔掉時捷徑會再通知），電量 15 分鐘內比藍牙新
    current() {
      if (!state) return null;
      const age = Date.now() - state.at;
      return {
        charging: age < 12 * 3600e3 ? state.charging : null,
        level: age < 15 * 60e3 ? state.level : null,
      };
    },
    // Apple Watch：6 小時內傳過才顯示（手錶是手動點的，太舊的電量沒意義）
    watch() {
      if (!watch || Date.now() - watch.at > 6 * 3600e3) return null;
      return { level: watch.level, charging: watch.charging, mins: Math.round((Date.now() - watch.at) / 60000) };
    },
  };
}

module.exports = { createPhonePush };
