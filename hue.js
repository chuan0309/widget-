// Philips Hue：直接在家裡網路跟 Hue Bridge 溝通（不經過雲端、不用帳號）
// - 配對：按一下 Bridge 上的大按鈕，程式在 30 秒內向 Bridge 要一組「應用程式金鑰」，用 Windows 加密存起來
// - 用 Hue 的本機 API（http://Bridge位址/api/金鑰/...）讀燈、房間、開關燈
// - 找 Bridge：先問 Hue 官方的 discovery.meethue.com（只會回傳你家網路上 Bridge 的內部 IP），找不到可以手動輸入 IP

const { net, safeStorage } = require("electron");
const https = require("https");

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

// Hue 的顏色（xy 色座標或色溫 mired）→ CSS rgb，給場景的圓形圖用
function xyToRgb(x, y, bri = 254) {
  const z = 1 - x - y, Y = Math.max(0.35, bri / 254), X = (Y / y) * x, Z = (Y / y) * z;
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  const m = Math.max(r, g, b, 1e-6);
  [r, g, b] = [r, g, b].map((v) => Math.max(0, v / m));
  const gam = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return `rgb(${[r, g, b].map((v) => Math.round(gam(v) * 255)).join(",")})`;
}
function ctToRgb(ct) {
  const k = 1e6 / ct / 100; // 色溫（百 K）
  const r = k <= 66 ? 255 : 329.7 * (k - 60) ** -0.1332;
  const g = k <= 66 ? 99.47 * Math.log(k) - 161.12 : 288.12 * (k - 60) ** -0.0755;
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  return `rgb(${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v)))).join(",")})`;
}
function stateColor(st = {}) {
  if (st.on === false) return null;
  if (Array.isArray(st.xy)) return xyToRgb(st.xy[0], st.xy[1], st.bri);
  if (st.ct) return ctToRgb(st.ct);
  return "rgb(255,214,150)";
}

// Hue 的新介面（CLIP v2）：智慧場景（自然光…）、哪個場景正在用，都只有這裡拿得到。
// 走 HTTPS，但 Bridge 的憑證是 Philips 自己簽的，一般瀏覽器不認得，所以只對「已配對的 Bridge IP」放寬檢查
function v2call(ip, key, path, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: ip, port: 443, path: `/clip/v2/resource/${path}`, method, rejectUnauthorized: false, timeout: 5000,
      headers: { "hue-application-key": key, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (res.statusCode === 404) return reject(new Error("no v2"));
        try { resolve(JSON.parse(buf)); } catch { reject(new Error("bad json")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}
const v2Color = (a = {}) => {
  if (a.on && a.on.on === false) return null;
  if (a.color?.xy) return xyToRgb(a.color.xy.x, a.color.xy.y, Math.round(((a.dimming?.brightness ?? 100) / 100) * 254));
  if (a.color_temperature?.mirek) return ctToRgb(a.color_temperature.mirek);
  return "rgb(255,214,150)";
};

function createHue(settings, saveSettings, log = () => {}) {
  const sceneColors = new Map(); // 場景 id → { at, colors }（場景很少改，一小時讀一次）
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

  // 新介面的場景＋智慧場景；Bridge 太舊沒有新介面時回傳 null，改用舊介面的場景
  async function scenesV2() {
    const key = unseal(H().key);
    try {
      const [sc, smart, rooms, zones] = await Promise.all(["scene", "smart_scene", "room", "zone"].map((t) => v2call(H().ip, key, t).catch((e) => (t === "scene" ? Promise.reject(e) : { data: [] }))));
      if (!Array.isArray(sc?.data)) return null;
      const names = new Map([...(rooms.data || []), ...(zones.data || [])].map((r) => [r.id, r.metadata?.name || ""]));
      const colorsOf = (scene) => {
        const fromActions = (scene.actions || []).map((x) => v2Color(x.action));
        const fromPalette = [...(scene.palette?.color || []).map((c) => v2Color({ color: c.color, dimming: c.dimming })),
          ...(scene.palette?.color_temperature || []).map((c) => v2Color({ color_temperature: c.color_temperature }))];
        return [...new Set([...fromPalette, ...fromActions].filter(Boolean))].slice(0, 3);
      };
      const byId = new Map(sc.data.map((x) => [x.id, x]));
      const items = [];
      // 智慧場景（自然光、大自然的色彩…）：照時間自動換；顏色拿它裡面各時段場景的顏色
      for (const z of smart.data || []) {
        const targets = (z.week_timeslots || []).flatMap((w) => (w.timeslots || []).map((t) => t.target?.rid)).filter(Boolean);
        const cols = [...new Set(targets.flatMap((rid) => (byId.get(rid) ? colorsOf(byId.get(rid)) : [])))].slice(0, 3);
        items.push({ id: "z" + z.id, kind: "scene", smart: true, name: z.metadata?.name || "智慧場景", room: names.get(z.group?.rid) || "Hue", on: z.state === "active", colors: cols });
      }
      for (const x of sc.data) {
        // 有色盤的場景才能「動態」（顏色在色盤裡流動）
        const canDynamic = (x.palette?.color?.length || 0) + (x.palette?.color_temperature?.length || 0) > 0;
        items.push({ id: "v" + x.id, kind: "scene", name: x.metadata?.name || "場景", room: names.get(x.group?.rid) || "Hue", on: !!x.status?.active && x.status.active !== "inactive", dynamicNow: x.status?.active === "dynamic_palette", canDynamic, colors: colorsOf(x) });
      }
      return items;
    } catch (e) {
      log("hue v2 unavailable", e.message);
      return null;
    }
  }

  // 房間（Hue App 裡的「房間」「區域」）和每一盞燈，統一成小組件用的格式
  async function state() {
    if (!paired()) return { needSetup: true };
    try {
      const [lights, groups, v2] = await Promise.all([call(`${base()}/lights`), call(`${base()}/groups`), scenesV2()]);
      const scenes = v2 ? {} : await call(`${base()}/scenes`).catch(() => ({}));
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
      if (v2) items.push(...v2);
      // （舊介面）場景：點一下就套用
      const roomName = (gid) => groups?.[gid]?.name || "";
      for (const [id, sc] of Object.entries(scenes && !Array.isArray(scenes) ? scenes : {})) {
        if (sc.recycle) continue; // Hue 自動產生的暫存場景
        const gid = sc.type === "GroupScene" ? String(sc.group || "0") : "0";
        const room = gid !== "0" ? roomName(gid) : "";
        items.push({ id: `s${id}@${gid}`, kind: "scene", name: sc.name, room: room || "全部的燈", sid: id, on: false });
      }
      // 每盞燈在哪個房間（小組件方塊上面那一行，像 iPhone「家庭」）
      const roomOf = {};
      for (const g of Object.values(groups || {})) if (g.type === "Room") for (const lid of g.lights || []) roomOf[lid] = g.name;
      for (const [id, l] of Object.entries(lights || {})) {
        items.push({
          id: "l" + id, kind: "light", name: l.name, room: roomOf[id] || "", cls: l.config?.archetype || "",
          on: !!l.state?.on, reachable: l.state?.reachable !== false,
          bri: l.state?.bri != null ? Math.round((l.state.bri / 254) * 100) : null,
        });
      }
      // 每個場景裡燈的顏色（要一個一個問，有快取）
      const need = items.filter((it) => it.sid && !(sceneColors.get(it.sid)?.at > Date.now() - 3600e3));
      await Promise.all(need.slice(0, 40).map(async (it) => {
        try {
          const d = await call(`${base()}/scenes/${it.sid}`);
          const cols = [...new Set(Object.values(d?.lightstates || {}).map(stateColor).filter(Boolean))].slice(0, 3);
          sceneColors.set(it.sid, { at: Date.now(), colors: cols });
        } catch {}
      }));
      for (const it of items) if (it.sid) it.colors = sceneColors.get(it.sid)?.colors || [];
      // 最後一格：全部關閉（跟 Hue 的小工具一樣）
      items.push({ id: "off", kind: "off", name: "全部關閉", room: "", on: false });
      return { items };
    } catch (e) {
      return { error: "連不到 Hue Bridge", offline: true };
    }
  }

  // 開／關：id 是 g房間 或 l燈；場景（s場景@房間）是「套用」
  async function set(id, on) {
    if (!paired()) return { error: "還沒配對" };
    if (id === "off") {
      try { await call(`${base()}/groups/0/action`, "PUT", { on: false }); return { ok: true }; }
      catch { return { error: "連不到 Hue Bridge" }; }
    }
    const vm = String(id).match(/^([vz])([0-9a-f-]{36})$/i);
    if (vm) {
      try {
        const key = unseal(H().key);
        if (vm[1] === "z") {
          const r = await v2call(H().ip, key, `smart_scene/${vm[2]}`, "PUT", { recall: { action: "activate" } });
          return r?.errors?.length ? { error: r.errors[0].description } : { ok: true };
        }
        // 一般場景：照使用者在管理程式選的「靜態／動態（慢、中、快）」套用
        const pref = H().sceneMode?.[id] || {};
        const dynamic = pref.mode === "dynamic";
        if (dynamic && typeof pref.speed === "number") await v2call(H().ip, key, `scene/${vm[2]}`, "PUT", { speed: pref.speed }).catch(() => {});
        const r = await v2call(H().ip, key, `scene/${vm[2]}`, "PUT", { recall: { action: dynamic ? "dynamic_palette" : "active" } });
        return r?.errors?.length ? { error: r.errors[0].description } : { ok: true };
      } catch { return { error: "連不到 Hue Bridge" }; }
    }
    const sm = String(id).match(/^s([\w-]+)@(\d+)$/);
    if (sm) {
      try {
        const r = await call(`${base()}/groups/${sm[2]}/action`, "PUT", { scene: sm[1] });
        return r?.some?.((x) => x.error) ? { error: r.find((x) => x.error).error.description } : { ok: true };
      } catch { return { error: "連不到 Hue Bridge" }; }
    }
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

  // 亮度 1～100%（會順便打開）：id 是 g房間 或 l燈
  async function setBri(id, pct) {
    if (!paired()) return { error: "還沒配對" };
    const m = String(id).match(/^([gl])(\d+)$/);
    if (!m) return { error: "這個不能調亮度" };
    const bri = Math.min(254, Math.max(1, Math.round((Number(pct) / 100) * 254)));
    const url = m[1] === "g" ? `${base()}/groups/${m[2]}/action` : `${base()}/lights/${m[2]}/state`;
    try {
      const r = await call(url, "PUT", { on: true, bri });
      return r?.some?.((x) => x.error) ? { error: r.find((x) => x.error).error.description } : { ok: true };
    } catch { return { error: "連不到 Hue Bridge" }; }
  }

  return {
    discover, pair, unpair, state, set, setBri,
    info: () => ({ paired: paired(), ip: H().ip, hidden: H().hidden || {}, order: H().order || [], sceneMode: H().sceneMode || {} }),
    setPrefs({ hidden, order, sceneMode } = {}) {
      // id 最長是 "v" + 36 字的 UUID，以前切到 20 字會對不上（藏不起來）
      if (hidden && typeof hidden === "object") H().hidden = Object.fromEntries(Object.entries(hidden).filter(([, v]) => v).map(([k]) => [String(k).slice(0, 64), true]));
      if (sceneMode && typeof sceneMode === "object") {
        H().sceneMode = Object.fromEntries(Object.entries(sceneMode).slice(0, 300).map(([k, v]) => [String(k).slice(0, 64), {
          mode: v?.mode === "dynamic" ? "dynamic" : "static",
          speed: Math.min(1, Math.max(0, Number(v?.speed) || 0.5)),
        }]));
      }
      if (Array.isArray(order)) H().order = order.map(String).slice(0, 200);
      saveSettings();
    },
  };
}

module.exports = { createHue };
