// Philips Hue：直接在家裡網路跟 Hue Bridge 溝通（不經過雲端、不用帳號）
// - 配對：按一下 Bridge 上的大按鈕，程式在 30 秒內向 Bridge 要一組「應用程式金鑰」，用 Windows 加密存起來
// - 用 Hue 的本機 API（http://Bridge位址/api/金鑰/...）讀燈、房間、開關燈
// - 找 Bridge：先問 Hue 官方的 discovery.meethue.com（只會回傳你家網路上 Bridge 的內部 IP），找不到可以手動輸入 IP

const { net, safeStorage } = require("electron");

const seal = (t) => (!t ? "" : safeStorage.isEncryptionAvailable() ? "enc:" + safeStorage.encryptString(t).toString("base64") : t);
const unseal = (t) => {
  if (!t || !t.startsWith("enc:")) return t || "";
  try { return safeStorage.decryptString(Buffer.from(t.slice(4), "base64")); } catch { return ""; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const validIp = (ip) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split(".").every((n) => Number(n) <= 255);

async function call(url, method = "GET", body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await net.fetch(url, {
      method, signal: ctrl.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await r.json();
  } finally { clearTimeout(t); }
}

function createHue(settings, saveSettings, log = () => {}) {
  const H = () => (settings.hue ||= { ip: "", key: "", hidden: {}, order: [] });
  const base = () => `http://${H().ip}/api/${unseal(H().key)}`;
  const paired = () => !!(H().ip && unseal(H().key));

  async function discover() {
    try {
      const list = await call("https://discovery.meethue.com/");
      return (Array.isArray(list) ? list : []).map((b) => ({ id: String(b.id || ""), ip: String(b.internalipaddress || "") })).filter((b) => validIp(b.ip));
    } catch (e) {
      log("hue discover failed", e.message);
      return [];
    }
  }

  // 使用者按了 Bridge 的大按鈕之後，30 秒內都可以要到金鑰
  async function pair(ip) {
    if (!validIp(ip)) return { error: "IP 格式不對（像 192.168.1.20 這樣）" };
    const until = Date.now() + 30000;
    let lastErr = "";
    while (Date.now() < until) {
      try {
        const r = await call(`http://${ip}/api`, "POST", { devicetype: "glass_widgets#windows" });
        const ok = r?.[0]?.success?.username;
        if (ok) {
          Object.assign(H(), { ip, key: seal(ok) });
          saveSettings();
          log("hue paired", ip);
          return { ok: true };
        }
        lastErr = r?.[0]?.error?.type === 101 ? "還沒按 Bridge 上的按鈕" : (r?.[0]?.error?.description || "Bridge 沒有回應");
      } catch (e) {
        lastErr = "連不到這個 IP 的 Bridge（電腦和 Bridge 要在同一個網路）";
      }
      await sleep(2000);
    }
    return { error: lastErr || "逾時" };
  }

  function unpair() {
    Object.assign(H(), { ip: "", key: "" });
    saveSettings();
  }

  // 房間（Hue App 裡的「房間」「區域」）和每一盞燈，統一成小組件用的格式
  async function state() {
    if (!paired()) return { needSetup: true };
    try {
      const [lights, groups] = await Promise.all([call(`${base()}/lights`), call(`${base()}/groups`)]);
      if (Array.isArray(lights) && lights[0]?.error?.type === 1) return { needSetup: true, error: "Bridge 的金鑰失效了，請重新配對" };
      const items = [];
      for (const [id, g] of Object.entries(groups || {})) {
        if (!["Room", "Zone"].includes(g.type)) continue;
        items.push({
          id: "g" + id, kind: "room", name: g.name, cls: g.class || "",
          on: !!g.state?.any_on, all: !!g.state?.all_on,
          bri: g.action?.bri != null ? Math.round((g.action.bri / 254) * 100) : null,
          count: (g.lights || []).length,
        });
      }
      for (const [id, l] of Object.entries(lights || {})) {
        items.push({
          id: "l" + id, kind: "light", name: l.name, cls: l.config?.archetype || "",
          on: !!l.state?.on, reachable: l.state?.reachable !== false,
          bri: l.state?.bri != null ? Math.round((l.state.bri / 254) * 100) : null,
        });
      }
      return { items };
    } catch (e) {
      return { error: "連不到 Hue Bridge", offline: true };
    }
  }

  // 開／關：id 是 g房間 或 l燈
  async function set(id, on) {
    if (!paired()) return { error: "還沒配對" };
    const m = String(id).match(/^([gl])(\d+)$/);
    if (!m) return { error: "不認得的裝置" };
    const url = m[1] === "g" ? `${base()}/groups/${m[2]}/action` : `${base()}/lights/${m[2]}/state`;
    try {
      const r = await call(url, "PUT", { on: !!on });
      return r?.some?.((x) => x.error) ? { error: r.find((x) => x.error).error.description } : { ok: true };
    } catch {
      return { error: "連不到 Hue Bridge" };
    }
  }

  return {
    discover, pair, unpair, state, set,
    info: () => ({ paired: paired(), ip: H().ip, hidden: H().hidden || {}, order: H().order || [] }),
    setPrefs({ hidden, order } = {}) {
      if (hidden && typeof hidden === "object") H().hidden = Object.fromEntries(Object.entries(hidden).filter(([, v]) => v).map(([k]) => [String(k).slice(0, 20), true]));
      if (Array.isArray(order)) H().order = order.map(String).slice(0, 200);
      saveSettings();
    },
  };
}

module.exports = { createHue };
