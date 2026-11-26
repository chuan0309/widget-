// Google 日曆（或任何 iCal 行事曆）：讀「iCal 格式的私人網址」。
// 不用登入、不用開發者帳號；網址等於鑰匙，所以用 Windows 加密存起來。
// 重複行程（每週、每月…）和時區交給 Mozilla 的 ical.js 處理。

const ICAL = require("ical.js");
const { net, safeStorage } = require("electron");

const COLORS = ["#0a84ff", "#ff9f0a", "#30d158", "#bf5af2", "#ff375f", "#64d2ff"];
const REFRESH_MS = 15 * 60 * 1000;

const seal = (text) => (safeStorage.isEncryptionAvailable()
  ? "enc:" + safeStorage.encryptString(text).toString("base64") : text);
const unseal = (text) => {
  if (!text?.startsWith("enc:")) return text || "";
  try { return safeStorage.decryptString(Buffer.from(text.slice(4), "base64")); } catch { return ""; }
};

function normalizeUrl(input) {
  let s = String(input || "").trim();
  if (/^webcal:\/\//i.test(s)) s = "https://" + s.slice(9);
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  return u.href;
}

async function download(url) {
  const res = await net.fetch(url, { headers: { Accept: "text/calendar, */*" } });
  if (res.status === 404) throw new Error("找不到這個行事曆，網址對嗎？");
  if (!res.ok) throw new Error(`讀取失敗（${res.status}）`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("這不是行事曆網址（要 iCal 格式的）");
  return text;
}

// 把一份 iCal 文字展開成 [from, to] 之間的行程
function expand(text, from, to) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try { ICAL.TimezoneService.register(tz); } catch {}
  }
  const name = root.getFirstPropertyValue("x-wr-calname") || "";

  // 重複行程裡「被改過的那一次」要掛回原本的行程
  const masters = new Map();
  const exceptions = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(vevent);
    if (vevent.getFirstPropertyValue("status") === "CANCELLED" && !ev.isRecurrenceException()) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid + "", ev);
  }
  for (const ex of exceptions) masters.get(ex.uid + "")?.relateException(ex);

  const fromT = ICAL.Time.fromJSDate(from, true);
  const toT = ICAL.Time.fromJSDate(to, true);
  const out = [];
  const push = (summary, start, end, item) => {
    if (item?.component?.getFirstPropertyValue("status") === "CANCELLED") return;
    const allDay = start.isDate;
    out.push({
      title: summary || "（沒有標題）",
      start: start.toJSDate().getTime(),
      end: (end || start).toJSDate().getTime(),
      allDay,
      location: item?.location || "",
    });
  };

  for (const ev of masters.values()) {
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next, guard = 0;
        while ((next = it.next()) && guard++ < 50000) {
          if (next.compare(toT) > 0) break;
          const occ = ev.getOccurrenceDetails(next);
          if (occ.endDate.compare(fromT) <= 0) continue;
          push(occ.item.summary, occ.startDate, occ.endDate, occ.item);
        }
      } else if (ev.startDate) {
        const end = ev.endDate || ev.startDate;
        if (end.compare(fromT) > 0 && ev.startDate.compare(toT) <= 0) push(ev.summary, ev.startDate, end, ev);
      }
    } catch {}
  }
  return { name, events: out };
}

function createCalendar({ settings, save, onUpdate, google }) {
  const C = () => settings.calendar;
  let cache = { events: [], sources: [], at: 0 };
  let timer = null;

  function range() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1); // 這個月 1 號（月曆要用）
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 45);
    return [from, to];
  }

  const hasAny = () => (C().sources || []).length > 0 || !!google?.isLoggedIn();

  async function refresh() {
    const sources = C().sources || [];
    if (!hasAny()) {
      cache = { events: [], sources: [], at: Date.now() };
      onUpdate?.(snapshot());
      return snapshot();
    }
    const [from, to] = range();
    const results = await Promise.all(sources.map(async (s, i) => {
      const color = s.color || COLORS[i % COLORS.length];
      try {
        const { name, events } = expand(await download(unseal(s.url)), from, to);
        if (name && !s.name) { s.name = name; save(); }
        return { info: { name: s.name || name || `行事曆 ${i + 1}`, color }, events: events.map((e) => ({ ...e, color })) };
      } catch (e) {
        return { info: { name: s.name || `行事曆 ${i + 1}`, color, error: e.message || "讀取失敗" }, events: [] };
      }
    }));
    // 登入的 Google 帳號
    let g = { events: [], sources: [] };
    if (google?.isLoggedIn()) {
      try { g = await google.fetchEvents(from, to); }
      catch (e) { g = { events: [], sources: [{ name: "Google 日曆", color: "#0a84ff", error: e.message, loginExpired: !!e.loginExpired }] }; }
    }
    cache = {
      events: [...g.events, ...results.flatMap((r) => r.events)].sort((a, b) => a.start - b.start),
      sources: [...g.sources, ...results.map((r) => r.info)],
      at: Date.now(),
    };
    onUpdate?.(snapshot());
    return snapshot();
  }

  function snapshot() {
    return { needSetup: !hasAny(), events: cache.events, sources: cache.sources, at: cache.at };
  }

  async function get() {
    if (Date.now() - cache.at > REFRESH_MS || cache.at === 0) return refresh();
    return snapshot();
  }

  async function add(input) {
    const url = normalizeUrl(input);
    if (!url) return { error: "請貼上 https:// 開頭的 iCal 網址" };
    let name = "";
    try {
      const [from, to] = range();
      name = expand(await download(url), from, to).name;
    } catch (e) {
      return { error: e.message };
    }
    const list = C().sources || (C().sources = []);
    list.push({ url: seal(url), name, color: COLORS[list.length % COLORS.length] });
    save();
    await refresh();
    return { ok: true, name };
  }

  async function remove(index) {
    C().sources.splice(index, 1);
    save();
    return refresh();
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS);
    refresh().catch(() => {});
  }

  return { get, add, remove, refresh, start };
}

module.exports = { createCalendar, expand };
