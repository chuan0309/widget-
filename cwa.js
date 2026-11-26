// 中央氣象署（CWA）開放資料：鄉鎮天氣預報
// - 需要使用者自己的「授權碼」（opendata.cwa.gov.tw 免費註冊），用 Windows 加密存在電腦上
// - 用座標找出在哪個縣市、哪個鄉鎮市區，抓那裡的「未來 3 天（逐 3 小時）」和「未來 1 週」預報
// - 轉成跟 Open-Meteo 一樣的格式，小組件不用改；抓不到時回傳錯誤，小組件會改用 Open-Meteo

const { net, safeStorage } = require("electron");

const API = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/";
// 每個縣市的資料編號（從氣象署 API 文件整理）：[未來 3 天, 未來 1 週]
const DATASETS = {
  宜蘭縣: ["F-D0047-001", "F-D0047-003"], 桃園市: ["F-D0047-005", "F-D0047-007"],
  新竹縣: ["F-D0047-009", "F-D0047-011"], 苗栗縣: ["F-D0047-013", "F-D0047-015"],
  彰化縣: ["F-D0047-017", "F-D0047-019"], 南投縣: ["F-D0047-021", "F-D0047-023"],
  雲林縣: ["F-D0047-025", "F-D0047-027"], 嘉義縣: ["F-D0047-029", "F-D0047-031"],
  屏東縣: ["F-D0047-033", "F-D0047-035"], 臺東縣: ["F-D0047-037", "F-D0047-039"],
  花蓮縣: ["F-D0047-041", "F-D0047-043"], 澎湖縣: ["F-D0047-045", "F-D0047-047"],
  基隆市: ["F-D0047-049", "F-D0047-051"], 新竹市: ["F-D0047-053", "F-D0047-055"],
  嘉義市: ["F-D0047-057", "F-D0047-059"], 臺北市: ["F-D0047-061", "F-D0047-063"],
  高雄市: ["F-D0047-065", "F-D0047-067"], 新北市: ["F-D0047-069", "F-D0047-071"],
  臺中市: ["F-D0047-073", "F-D0047-075"], 臺南市: ["F-D0047-077", "F-D0047-079"],
  連江縣: ["F-D0047-081", "F-D0047-083"], 金門縣: ["F-D0047-085", "F-D0047-087"],
};

const seal = (t) => (!t ? "" : safeStorage.isEncryptionAvailable()
  ? "enc:" + safeStorage.encryptString(t).toString("base64") : t);
const unseal = (t) => {
  if (!t || !t.startsWith("enc:")) return t || "";
  try { return safeStorage.decryptString(Buffer.from(t.slice(4), "base64")); } catch { return ""; }
};

const norm = (s) => String(s || "").replace(/台/g, "臺").trim();

// 不分大小寫拿欄位（氣象署的 JSON 欄位名稱大小寫改過不只一次）
function get(o, ...names) {
  if (!o || typeof o !== "object") return undefined;
  for (const n of names) {
    for (const k of Object.keys(o)) if (k.toLowerCase() === n.toLowerCase()) return o[k];
  }
  return undefined;
}
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ElementValue 裡的數字（溫度、降雨機率…），欄位名稱不確定就拿第一個是數字的
function num(ev) {
  for (const [k, v] of Object.entries(ev || {})) {
    if (/code/i.test(k)) continue;
    const n = Number(v);
    if (v !== "" && v != null && Number.isFinite(n)) return n;
  }
  return null;
}
// ElementValue 裡的天氣文字（「多雲時晴」）
function text(ev) {
  const w = get(ev, "Weather", "value");
  if (typeof w === "string" && w) return w;
  for (const [k, v] of Object.entries(ev || {})) if (!/code/i.test(k) && typeof v === "string" && Number.isNaN(Number(v))) return v;
  return "";
}

// 氣象署的天氣文字 → 小組件用的天氣代碼（跟 Open-Meteo 一樣的 WMO 代碼）
function wmo(t) {
  if (/雪/.test(t)) return 71;
  if (/雷/.test(t)) return 95;
  if (/雨/.test(t)) return /短暫|陣/.test(t) ? 80 : 61;
  if (/霧/.test(t)) return 45;
  if (/晴/.test(t)) return /雲/.test(t) ? (/^晴/.test(t) ? 1 : 2) : 0;
  return 3; // 多雲、陰
}

// 一個預報因子 → [{ start, end, ev }]
function series(location, name) {
  const el = arr(get(location, "WeatherElement")).find((e) => get(e, "ElementName", "elementName") === name);
  return arr(get(el, "Time")).map((t) => {
    const start = new Date(get(t, "DataTime", "StartTime") || 0).getTime();
    const end = get(t, "EndTime") ? new Date(get(t, "EndTime")).getTime() : start + 3 * 3600e3;
    return { start, end, ev: arr(get(t, "ElementValue"))[0] || {} };
  }).filter((x) => x.start).sort((a, b) => a.start - b.start);
}
const at = (s, time) => s.find((x) => x.start <= time && time < x.end) || null;

function createCwa(settings, saveSettings, log) {
  const C = () => (settings.cwa ||= { key: "" });
  let placeCache = null; // { lat, lon, county, towns: [] }

  // 座標在哪個縣市、鄉鎮（BigDataCloud 免費查，跟自動定位用同一個）
  async function place(lat, lon) {
    if (placeCache && Math.abs(placeCache.lat - lat) < 0.005 && Math.abs(placeCache.lon - lon) < 0.005) return placeCache;
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("localityLanguage", "zh-Hant");
    const d = await (await net.fetch(url.toString())).json();
    const names = [d.principalSubdivision, d.city, d.locality,
      ...(d.localityInfo?.administrative || []).map((a) => a.name)].map(norm).filter(Boolean);
    const county = names.find((n) => DATASETS[n]) || "";
    placeCache = { lat, lon, county, towns: names.filter((n) => n !== county) };
    return placeCache;
  }

  async function dataset(id, elements) {
    const url = new URL(API + id);
    url.searchParams.set("Authorization", unseal(C().key));
    url.searchParams.set("format", "JSON");
    url.searchParams.set("ElementName", elements.join(","));
    const r = await net.fetch(url.toString());
    if (r.status === 401 || r.status === 403) { const e = new Error("授權碼不對，請重新貼一次"); e.badKey = true; throw e; }
    if (!r.ok) throw new Error(`氣象署回應 ${r.status}`);
    const j = await r.json();
    const groups = arr(get(get(j, "records"), "Locations", "locations"));
    return groups.flatMap((g) => arr(get(g, "Location", "location")));
  }

  // 在縣市的鄉鎮清單裡找到這個位置：名稱對得上最好，不然找最近的
  function pickTown(locations, p, lat, lon) {
    const nameOf = (l) => norm(get(l, "LocationName", "locationName"));
    const byName = locations.find((l) => p.towns.includes(nameOf(l)));
    if (byName) return byName;
    let best = null, bestD = Infinity;
    for (const l of locations) {
      const la = Number(get(l, "Latitude", "lat")), lo = Number(get(l, "Longitude", "lon"));
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      const d = (la - lat) ** 2 + (lo - lon) ** 2;
      if (d < bestD) { bestD = d; best = l; }
    }
    return best || locations[0] || null;
  }

  async function fetchWeather(city) {
    if (!unseal(C().key)) return { error: "還沒設定氣象署授權碼" };
    const p = await place(city.lat, city.lon);
    const ids = DATASETS[p.county];
    if (!ids) return { error: "這個位置不在臺灣，氣象署沒有資料", outside: true };

    const [short, week] = await Promise.all([
      dataset(ids[0], ["溫度", "天氣現象", "3小時降雨機率"]),
      dataset(ids[1], ["最高溫度", "最低溫度", "天氣現象", "12小時降雨機率"]),
    ]);
    const town = pickTown(short, p, city.lat, city.lon);
    if (!town) throw new Error("氣象署沒有這個地區的預報");
    const townName = norm(get(town, "LocationName", "locationName"));
    const townWeek = week.find((l) => norm(get(l, "LocationName", "locationName")) === townName) || pickTown(week, p, city.lat, city.lon);

    const temp = series(town, "溫度");
    const wx = series(town, "天氣現象");
    if (!temp.length || !wx.length) throw new Error("氣象署的資料格式跟預期的不一樣");
    const now = Date.now();
    const isDay = (t) => { const h = new Date(t).getHours(); return h >= 6 && h < 18 ? 1 : 0; };

    // 逐 3 小時
    const hourly = { time: [], temperature_2m: [], weather_code: [], is_day: [] };
    for (const x of temp) {
      const w = at(wx, x.start) || wx[0];
      hourly.time.push(new Date(x.start).toISOString());
      hourly.temperature_2m.push(num(x.ev));
      hourly.weather_code.push(wmo(text(w.ev)));
      hourly.is_day.push(isDay(x.start));
    }
    const curT = [...temp].reverse().find((x) => x.start <= now) || temp[0];
    const curW = at(wx, now) || wx[0];
    const current = { temperature_2m: num(curT.ev), weather_code: wmo(text(curW.ev)), is_day: isDay(now), desc: text(curW.ev) };

    // 每天：一週預報的白天／晚上兩段合起來
    const days = new Map();
    const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const add = (name, fn) => {
      for (const x of series(townWeek, name)) {
        const k = dayKey(x.start);
        if (!days.has(k)) days.set(k, { max: null, min: null, code: null, pop: null, dayCode: null });
        fn(days.get(k), x);
      }
    };
    add("最高溫度", (d, x) => { const v = num(x.ev); if (v != null) d.max = d.max == null ? v : Math.max(d.max, v); });
    add("最低溫度", (d, x) => { const v = num(x.ev); if (v != null) d.min = d.min == null ? v : Math.min(d.min, v); });
    add("天氣現象", (d, x) => { const c = wmo(text(x.ev)); if (isDay(x.start)) d.dayCode = c; d.code ??= c; });
    add("12小時降雨機率", (d, x) => { const v = num(x.ev); if (v != null) d.pop = Math.max(d.pop ?? 0, v); });
    // 今天的高低溫也算進逐 3 小時的溫度（晚上時一週預報可能只剩今晚那段）
    const todayK = dayKey(now);
    for (const x of temp) if (dayKey(x.start) === todayK) {
      const v = num(x.ev); if (v == null) continue;
      const d = days.get(todayK) || { max: null, min: null, code: current.weather_code, pop: null };
      d.max = d.max == null ? v : Math.max(d.max, v); d.min = d.min == null ? v : Math.min(d.min, v);
      days.set(todayK, d);
    }
    const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [], precipitation_probability_max: [] };
    for (const [k, d] of [...days.entries()].sort()) {
      if (k < todayK || d.max == null || d.min == null) continue;
      daily.time.push(k);
      daily.temperature_2m_max.push(d.max);
      daily.temperature_2m_min.push(d.min);
      daily.weather_code.push(d.dayCode ?? d.code ?? 3);
      daily.precipitation_probability_max.push(d.pop);
    }
    if (!daily.time.length) throw new Error("氣象署的一週預報是空的");
    return { source: "cwa", place: townName, current, hourly, daily };
  }

  return {
    hasKey: () => !!unseal(C().key),
    setKey(key) { C().key = seal(String(key || "").trim()); saveSettings(); },
    async weather(city) {
      try { return await fetchWeather(city); }
      catch (e) { log("cwa error", e.message); return { error: e.message, badKey: !!e.badKey }; }
    },
  };
}

module.exports = { createCwa };
