// 整個主螢幕只有這一個透明視窗，所有小組件（和疊放）都畫在這裡。
// - 每個小組件是一個「實例」：自己的位置、大小、內容，用自己的元素，不靠全域 id
// - 內容只在真的有變的時候才重畫（以前每 6 秒整個重畫一次，入場動畫重播，看起來會閃）
// - 拖動只是在畫面裡移動，放開時自動對齊格子；不會再動到視窗本身
// - 視窗平常點得穿，滑鼠移到小組件上時才接收滑鼠

// window.api 由 preload 提供（不能再用 const api 宣告一次，會整個檔案出錯）
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SIZES = { s: [170, 170], m: [356, 170], l: [356, 356] };
const CELL = 186;   // 170 + 16 間距
const MARGIN = 24;  // 離螢幕邊緣
const BLEED = 48;   // 模糊的桌布多留的邊（不然邊緣會變淡）

// 只有內容真的變了才換（不重播動畫、不閃）
function setHTML(el, html) {
  if (el.__html === html) return false;
  el.innerHTML = html;
  el.__html = html;
  return true;
}

/* ───────── 透明度 ───────── */
const setTint = (v) => document.body.style.setProperty("--t", String(Math.min(100, Math.max(0, Number(v))) / 100));
setTint(30);
api.onTint?.(setTint);
// 背景：透明玻璃／深色／淺色
const setBackground = (b) => {
  document.body.classList.remove("bg-glass", "bg-dark", "bg-light");
  document.body.classList.add(`bg-${["dark", "light"].includes(b) ? b : "glass"}`);
};
setBackground("glass");
api.onBackground?.(setBackground);
const setFont = (w) => document.body.style.setProperty("--fw", String(w));
api.onFont?.(setFont);

/* ───────── 日期小工具 ───────── */
const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const WEEK_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const LUNAR_DAYS = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
const lunarFmt = (() => { try { return new Intl.DateTimeFormat("zh-TW-u-ca-chinese", { month: "long", day: "numeric" }); } catch { return null; } })();
function lunar(d) {
  if (!lunarFmt) return { month: "", day: "" };
  const parts = lunarFmt.formatToParts(d);
  return {
    month: parts.find((p) => p.type === "month")?.value || "",
    day: LUNAR_DAYS[Number(parts.find((p) => p.type === "day")?.value)] || "",
  };
}
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* ───────── 共用資料（從主程式來） ───────── */
const store = {
  devices: [], batteryPrefs: { hidden: {}, order: [] }, pc: null,
  audio: [], cal: null, pins: null, city: null, weather: null, weatherError: false,
};
const instances = new Map(); // key → 實例
let paused = false;

// 某種資料變了 → 重畫用到它的小組件
function refresh(...kinds) {
  if (paused) return;
  for (const inst of instances.values()) for (const [kind, pane] of inst.panes) {
    if (kinds.includes(kind)) try { WIDGETS[kind].render(pane, inst); } catch (err) { console.error(kind, err); }
  }
}

/* ───────── 桌布（毛玻璃後面那層） ───────── */
let hostRect = { x: 0, y: 0, width: 0, height: 0 };
let wall = null;
let wallRect = null; // 桌布在這個視窗裡的位置和大小

function computeWallRect(area, scale) {
  if (!wall || wall.mode === "color") return null;
  const iw = wall.width / scale, ih = wall.height / scale;
  let w = area.width, h = area.height;
  if (wall.mode === "fill" || wall.mode === "span") {
    const k = Math.max(area.width / iw, area.height / ih); w = iw * k; h = ih * k;
  } else if (wall.mode === "fit") {
    const k = Math.min(area.width / iw, area.height / ih); w = iw * k; h = ih * k;
  } else if (wall.mode === "center" || wall.mode === "tile") {
    w = iw; h = ih;
  }
  const x = (wall.mode === "tile" ? area.x : area.x + (area.width - w) / 2) - hostRect.x;
  const y = (wall.mode === "tile" ? area.y : area.y + (area.height - h) / 2) - hostRect.y;
  return { x, y, w, h };
}

function layoutBackdrop(inst, x = inst.x, y = inst.y) {
  const st = inst.backdrop.style;
  if (!wall) { st.display = "none"; return; }
  st.display = "";
  if (wall.mode === "color") { st.background = wall.color; return; }
  if (!wallRect) return;
  st.backgroundImage = `url("${wall.url}")`;
  st.backgroundRepeat = wall.mode === "tile" ? "repeat" : "no-repeat";
  st.backgroundSize = `${wallRect.w}px ${wallRect.h}px`;
  st.backgroundPosition = `${wallRect.x - x + BLEED}px ${wallRect.y - y + BLEED}px`;
}

api.onHostInit?.((d) => {
  hostRect = d.host;
  wall = d.wall;
  wallRect = computeWallRect(d.area, d.scale);
  if (d.tint != null) setTint(d.tint);
  if (d.background) setBackground(d.background);
  if (d.fontWeight != null) setFont(d.fontWeight);
  if (d.pinInterval) store.pinInterval = d.pinInterval;
  if (Array.isArray(d.worldClocks)) { store.worldClocks = d.worldClocks; refresh("clock"); }
  for (const inst of instances.values()) layoutBackdrop(inst);
});

/* ───────── 小組件實例 ───────── */
function createInstance(item) {
  const [w, h] = SIZES[item.size];
  const el = document.createElement("div");
  el.className = `card size-${item.size} enter`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  el.append(backdrop);

  const inst = { key: item.key, kinds: item.kinds.filter((k) => WIDGETS[k]), size: item.size, x: item.x, y: item.y, el, backdrop, panes: new Map(), timers: [] };
  const mountPane = (kind, parent) => {
    const pane = document.createElement("div");
    pane.className = `pane ${kind}`;
    parent.append(pane);
    inst.panes.set(kind, pane);
    // 一個小組件出錯不能讓其他小組件跟著不見
    try { WIDGETS[kind].mount?.(pane, inst); WIDGETS[kind].render(pane, inst); } catch (err) { console.error(kind, err); }
  };
  item = { ...item, kinds: item.kinds.filter((k) => WIDGETS[k]) };

  if (item.kinds.length > 1) {
    // 疊放：上下捲動換小組件，右邊小點點表示現在第幾個
    const scroll = document.createElement("div");
    scroll.className = "stack-scroll";
    const dots = document.createElement("div");
    dots.className = "stack-dots";
    el.append(scroll, dots);
    item.kinds.forEach((k) => {
      mountPane(k, scroll);
      const dot = document.createElement("i");
      dot.addEventListener("click", () => inst.panes.get(k).scrollIntoView({ behavior: "smooth" }));
      dots.append(dot);
    });
    const current = () => Math.round(scroll.scrollTop / Math.max(1, scroll.clientHeight));
    const mark = () => [...dots.children].forEach((d, i) => d.classList.toggle("on", i === current()));
    scroll.addEventListener("scroll", () => requestAnimationFrame(mark), { passive: true });
    requestAnimationFrame(mark);
    if (item.rotate) {
      inst.timers.push(setInterval(() => {
        if (paused || el.matches(":hover")) return;
        scroll.children[(current() + 1) % item.kinds.length].scrollIntoView({ behavior: "smooth" });
      }, 20000));
    }
  } else {
    mountPane(item.kinds[0], el);
  }

  placeInstance(inst);
  document.body.append(el);
  setTimeout(() => el.classList.remove("enter"), 700); // 入場動畫只播一次
  return inst;
}

function placeInstance(inst) {
  inst.el.style.transform = `translate(${inst.x}px, ${inst.y}px)`;
  layoutBackdrop(inst);
}

function destroyInstance(inst) {
  inst.timers.forEach(clearInterval);
  for (const [kind, pane] of inst.panes) WIDGETS[kind].unmount?.(pane, inst);
  inst.el.remove();
}

api.onHostLayout?.((items) => {
  const keep = new Set();
  for (const item of items) {
    keep.add(item.key);
    const old = instances.get(item.key);
    const same = old && old.size === item.size && old.kinds.join() === item.kinds.join();
    if (same) {
      if (old.x !== item.x || old.y !== item.y) { old.x = item.x; old.y = item.y; placeInstance(old); }
      continue;
    }
    if (old) destroyInstance(old);
    if (!item.kinds.some((k) => WIDGETS[k])) continue;
    try { instances.set(item.key, createInstance(item)); } catch (err) { console.error(item.key, err); }
  }
  for (const [key, inst] of instances) if (!keep.has(key)) { destroyInstance(inst); instances.delete(key); }
  untangle();
});

// 有小組件疊在一起時（例如改了大小、舊版存的位置），把後面的推到最近的空格並記住
function untangle() {
  if (!hostRect.width) return;
  const placed = [];
  for (const inst of instances.values()) {
    const [w, h] = SIZES[inst.size];
    const hit = placed.some((o) => {
      const [ow, oh] = SIZES[o.size];
      return inst.x < o.x + ow && o.x < inst.x + w && inst.y < o.y + oh && o.y < inst.y + h;
    });
    if (hit) {
      const spot = snapToGrid(inst, placed);
      inst.x = spot.x; inst.y = spot.y;
      placeInstance(inst);
      api.hostMove(inst.key, spot.x, spot.y);
    }
    placed.push(inst);
  }
}

/* ───────── 滑鼠：平常點得穿，在小組件上才接收 ───────── */
let interactive = false;
let dragging = null;
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  api.hostInteractive(on);
}
document.addEventListener("mousemove", (e) => {
  if (!dragging) setInteractive(!!e.target.closest?.(".card"));
}, { passive: true });
document.addEventListener("mouseleave", () => !dragging && setInteractive(false));

/* ───────── 拖動＋自動對齊 ───────── */
const NO_DRAG = "button, input, a, select, textarea, label, .stack-dots i";
function instOf(el) {
  const card = el.closest?.(".card");
  for (const inst of instances.values()) if (inst.el === card) return inst;
  return null;
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(NO_DRAG)) return;
  const inst = instOf(e.target);
  if (!inst) return;
  dragging = { inst, sx: e.clientX, sy: e.clientY, x: inst.x, y: inst.y, moved: false, target: e.target };
  e.target.setPointerCapture?.(e.pointerId);
  inst.el.classList.add("dragging");
});
document.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragging.sx, dy = e.clientY - dragging.sy;
  if (!dragging.moved && Math.hypot(dx, dy) < 4) return;
  dragging.moved = true;
  const { inst } = dragging;
  inst.x = dragging.x + dx;
  inst.y = dragging.y + dy;
  placeInstance(inst);
});
document.addEventListener("pointerup", (e) => {
  if (!dragging) return;
  const { inst, moved, target } = dragging;
  dragging = null;
  inst.el.classList.remove("dragging");
  if (!moved) { tap(inst, target); return; }
  const spot = snapToGrid(inst);
  inst.el.classList.add("snapping");
  inst.x = spot.x; inst.y = spot.y;
  placeInstance(inst);
  setTimeout(() => inst.el.classList.remove("snapping"), 300);
  api.hostMove(inst.key, inst.x, inst.y);
  setInteractive(!!document.elementFromPoint(e.clientX, e.clientY)?.closest(".card"));
});

// 格子：右上角對齊（跟預設排列一樣），每格 186px
function gridOrigin() {
  return {
    x: (((hostRect.width - MARGIN - SIZES.s[0]) % CELL) + CELL) % CELL,
    y: MARGIN,
  };
}
function snapToGrid(inst, others = [...instances.values()]) {
  const [w, h] = SIZES[inst.size];
  const o = gridOrigin();
  const maxCol = Math.floor((hostRect.width - w - o.x) / CELL);
  const maxRow = Math.floor((hostRect.height - h - o.y) / CELL);
  const col0 = Math.round((inst.x - o.x) / CELL), row0 = Math.round((inst.y - o.y) / CELL);
  const rect = (c, r) => ({ x: o.x + c * CELL, y: o.y + r * CELL, w, h });
  const overlaps = (a) => others.some((other) => {
    if (other === inst) return false;
    const [ow, oh] = SIZES[other.size];
    return a.x < other.x + ow && other.x < a.x + a.w && a.y < other.y + oh && other.y < a.y + a.h;
  });
  // 從放開的位置往外找最近的空格
  let best = null, bestD = Infinity;
  for (let c = 0; c <= maxCol; c++) for (let r = 0; r <= maxRow; r++) {
    const d = (c - col0) ** 2 + (r - row0) ** 2;
    if (d >= bestD) continue;
    const a = rect(c, r);
    if (!overlaps(a)) { best = a; bestD = d; }
  }
  if (!best) best = rect(Math.min(Math.max(col0, 0), maxCol), Math.min(Math.max(row0, 0), maxRow));
  return best;
}

// 點一下（沒有拖動）
function tap(inst, target) {
  const pane = target.closest(".pane");
  const kind = pane && [...inst.panes].find(([, p]) => p === pane)?.[0];
  if (kind) WIDGETS[kind].tap?.(pane, inst, target);
}

// 右鍵：大小、移除
document.addEventListener("contextmenu", (e) => {
  const inst = instOf(e.target);
  if (!inst) return;
  e.preventDefault();
  api.widgetMenu(inst.key);
});

/* ───────── 省電：被蓋住、鎖定螢幕時停下來 ───────── */
let mainPaused = false;
function updatePaused() {
  const p = mainPaused || document.visibilityState === "hidden";
  if (p === paused) return;
  paused = p;
  document.body.classList.toggle("paused", p);
  if (!p) { tick(); refresh(...Object.keys(WIDGETS)); loadWeather(); }
}
document.addEventListener("visibilitychange", updatePaused);
api.onPaused?.((p) => { mainPaused = p; updatePaused(); });

/* ════════════════════ 各種小組件 ════════════════════ */
const WIDGETS = {};

/* ───────── 時鐘 ───────── */
// 錶面（白天白色、晚上深色），中、小時鐘和世界時鐘共用
const faceHTML = () => `<div class="analog">${Array.from({ length: 12 }, (_, i) => {
  const a = ((i + 1) * 30 - 90) * Math.PI / 180;
  return `<span class="num" style="left:${50 + 36 * Math.cos(a)}%;top:${50 + 36 * Math.sin(a)}%">${i + 1}</span>`;
}).join("")}<i class="hand h"></i><i class="hand m"></i><i class="hand s"></i><i class="pin"></i></div>`;
function setHands(face, h, m, s) {
  const [hh, mm, ss] = face.__hands ||= [".hand.h", ".hand.m", ".hand.s"].map((q) => face.querySelector(q));
  hh.style.transform = `rotate(${(h % 12) * 30 + m * 0.5}deg)`;
  mm.style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
  ss.style.transform = `rotate(${s * 6}deg)`;
}

// 世界時鐘：某個時區現在的時、分、秒、日期（用瀏覽器內建的時區資料）
const tzFormat = new Map();
function zoned(tz, now) {
  if (!tzFormat.has(tz)) tzFormat.set(tz, new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }));
  const p = Object.fromEntries(tzFormat.get(tz).formatToParts(now).map((x) => [x.type, Number(x.value)]));
  return p; // { year, month, day, hour, minute, second }
}
// 「今天，+1 小時」這種說明（跟這台電腦的時間比）
function zoneNote(z, now) {
  const there = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
  const here = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  const diff = Math.round((there - here) / 36e5 * 2) / 2;
  const dayDiff = Math.round((Date.UTC(z.year, z.month - 1, z.day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  const day = dayDiff > 0 ? "明天" : dayDiff < 0 ? "昨天" : "今天";
  return `${day}，${diff === 0 ? "同一時間" : `${diff > 0 ? "+" : ""}${diff} 小時`}`;
}
const DEFAULT_WORLD = [
  { name: "台北", tz: "Asia/Taipei" }, { name: "東京", tz: "Asia/Tokyo" },
  { name: "倫敦", tz: "Europe/London" }, { name: "紐約", tz: "America/New_York" },
];

WIDGETS.clock = {
  mount(pane, inst) {
    if (inst.size === "l") return; // 大的是世界時鐘，render 時才建
    pane.innerHTML = `${faceHTML()}
      <div class="clock-info"><div class="digital"></div>
        <div class="clock-meta"><span class="cm-week"></span><b class="cm-day"></b></div>
        <div class="clock-date"></div><div class="lunar"></div></div>`;
  },
  render(pane, inst) {
    const now = new Date();
    if (inst.size === "l") return WIDGETS.clock.world(pane, now);
    setHands(pane.querySelector(".analog"), now.getHours(), now.getMinutes(), now.getSeconds());
    const set = (sel, text) => { const el = pane.querySelector(sel); if (el.textContent !== text) el.textContent = text; };
    set(".digital", hhmm(now));
    set(".cm-week", WEEK[now.getDay()]);
    set(".cm-day", String(now.getDate()));
    set(".clock-date", `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`);
    const l = lunar(now);
    set(".lunar", l.day ? `農曆${l.month}${l.day}` : "");
  },
  // 大：像 iPhone 的世界時鐘，4 個城市 2×2；那個城市晚上時錶面變深色
  world(pane, now) {
    const cities = (store.worldClocks || DEFAULT_WORLD).slice(0, 4);
    const sig = cities.map((c) => c.tz + c.name).join("|");
    if (pane.__world !== sig) {
      pane.__world = sig;
      pane.__html = null;
      pane.innerHTML = `<div class="world">${cities.map((c) => `<div class="wc">${faceHTML()}<b>${esc(c.name)}</b><small></small></div>`).join("")}</div>`;
    }
    pane.querySelectorAll(".wc").forEach((cell, i) => {
      const z = zoned(cities[i].tz, now);
      setHands(cell.querySelector(".analog"), z.hour, z.minute, z.second);
      cell.classList.toggle("night", z.hour < 6 || z.hour >= 18);
      const note = zoneNote(z, now);
      const small = cell.querySelector("small");
      if (small.textContent !== note) small.textContent = note;
    });
  },
};
function tick() { if (!paused) refresh("clock"); }
setInterval(tick, 1000);

/* ───────── 天氣 ───────── */
function weatherLook(code) {
  if (code === 0) return ["晴天", "sunny", "#ffd60a"];
  if (code <= 2) return ["晴時多雲", "partly_cloudy", "#fff"];
  if (code === 3) return ["陰天", "cloud", "#fff"];
  if (code <= 48) return ["起霧", "foggy", "#fff"];
  if (code <= 67 || (code >= 80 && code <= 82)) return ["下雨", "rainy", "#64d2ff"];
  if (code <= 77 || code === 85 || code === 86) return ["下雪", "snowy", "#fff"];
  return ["雷雨", "storm", "#ffd60a"];
}
// 「晚上7時」這種說法（跟 iPhone 一樣）
function hourLabel(h) {
  const part = h < 6 ? "凌晨" : h < 12 ? "上午" : h === 12 ? "中午" : h < 18 ? "下午" : "晚上";
  return `${part}${h % 12 || 12}時`;
}
// 溫度條的顏色：冷的偏藍綠、熱的偏橘紅（像 Apple 天氣）
function tempColor(t) {
  // 照 iPhone 天氣的顏色：零下藍、10 度青綠、20 度黃、28 度以上橘
  const stops = [[-5, "#4f9be8"], [0, "#5ab4e8"], [5, "#6cc6dc"], [10, "#78d0c2"], [15, "#a2d38a"], [19, "#dccf4a"], [23, "#f3c23c"], [27, "#f39c37"], [32, "#ef6f39"]];
  for (const [v, c] of stops) if (t <= v) return c;
  return "#ff453a";
}
// 天氣背景：像 Apple 天氣一樣，依天氣、白天晚上、日出日落換天空的顏色
function skyClass(code, isDay, data) {
  const night = isDay === 0;
  // 日出、日落前後 40 分鐘：藍色漸漸轉成粉紫（晴天、少雲時）
  const now = Date.now();
  const edges = [data?.daily?.sunrise?.[0], data?.daily?.sunset?.[0]].filter(Boolean).map((t) => new Date(t).getTime());
  if (code <= 2 && edges.some((t) => Math.abs(now - t) <= 40 * 60 * 1000)) return "sky-sunset";
  if (code <= 2) return night ? (code <= 1 ? "sky-clear-night" : "sky-cloud-night") : code <= 1 ? "sky-clear" : "sky-clear";
  if (code === 3) return night ? "sky-overcast-night" : "sky-cloud";
  if (code <= 48) return night ? "sky-overcast-night" : "sky-cloud";
  if (code <= 67 || (code >= 80 && code <= 82)) return night ? "sky-rain-night" : "sky-rain";
  if (code <= 77 || code === 85 || code === 86) return "sky-snow";
  return "sky-storm";
}
const wIcon = (code, night = false) => wxIcon(wxKind(code), night);

let weatherAt = 0;
async function loadWeather(force = false) {
  const needed = [...instances.values()].some((i) => i.panes.has("weather"));
  if (!needed || paused || (!force && Date.now() - weatherAt < 20 * 60 * 1000)) return;
  weatherAt = Date.now();
  const { city } = await api.getState();
  store.city = city;
  try {
    // 選了中央氣象署就先用氣象署；抓不到（沒網路、授權碼錯、不在臺灣）就改用 Open-Meteo
    const cwa = await api.weatherCwa?.().catch(() => null);
    if (cwa && !cwa.error) {
      store.weather = cwa;
      store.weatherError = false;
      refresh("weather");
      return;
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=6";
    store.weather = await (await fetch(url)).json();
    store.weatherError = false;
  } catch {
    store.weatherError = true;
    weatherAt = Date.now() - 18 * 60 * 1000; // 沒網路：2 分鐘後再試
  }
  refresh("weather");
}
setInterval(() => loadWeather(), 60 * 1000);
api.onWeatherRefresh?.(() => loadWeather(true));

WIDGETS.weather = {
  render(pane, inst) {
    const city = store.city, data = store.weather;
    if (!data) {
      setHTML(pane, `<div class="wt"><div class="wt-city">${esc(city?.name || "天氣")}</div>
        <div class="wt-desc" style="margin-top:auto;text-align:left">${store.weatherError ? "沒有網路" : "讀取中…"}</div></div>`);
      loadWeather();
      return;
    }
    const cur = data.current;
    let [desc, iconName, color] = weatherLook(cur.weather_code);
    if (cur.is_day === 0 && cur.weather_code === 0) desc = "晴朗";
    const bigIcon = wIcon(cur.weather_code, cur.is_day === 0);
    if (cur.desc) desc = esc(cur.desc); // 氣象署的說法（例如「多雲時晴」）
    pane.className = `pane weather ${skyClass(cur.weather_code, data.current.is_day, data)}`;
    const range = `最高 ${Math.round(data.daily.temperature_2m_max[0])}° 最低 ${Math.round(data.daily.temperature_2m_min[0])}°`;
    if (inst.size === "s") {
      setHTML(pane, `<div class="wt">
        <div class="wt-top"><div class="wt-city">${esc(data.place || city.name)}</div><span class="wt-icon">${bigIcon}</span></div>
        <div class="wt-temp">${Math.round(cur.temperature_2m)}°</div>
        <div class="wt-desc"><span>${desc}</span><small>${range}</small></div></div>`);
      return;
    }
    const nowIdx = Math.max(0, data.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1);
    const hours = data.hourly.time.slice(nowIdx, nowIdx + 5).map((t, i) => {
      const k = nowIdx + i;
      return `<div class="wt-hour"><small>${i === 0 ? "現在" : hourLabel(new Date(t).getHours())}</small>
        ${wIcon(data.hourly.weather_code[k], data.hourly.is_day?.[k] === 0)}<span>${Math.round(data.hourly.temperature_2m[k])}°</span></div>`;
    }).join("");
    let days = "";
    if (inst.size === "l") {
      const min = Math.min(...data.daily.temperature_2m_min), max = Math.max(...data.daily.temperature_2m_max);
      days = `<div class="wt-days">${data.daily.time.slice(0, 5).map((t, i) => {
        const a = data.daily.temperature_2m_min[i], b = data.daily.temperature_2m_max[i];
        const pos = (v) => ((v - min) / (max - min || 1)) * 100;
        const left = pos(a), width = pos(b) - pos(a);
        // 今天：白點標出現在幾度（跟 iPhone 一樣）
        const dot = i === 0 ? `<b class="wt-now" style="left:${Math.min(100, Math.max(0, pos(cur.temperature_2m)))}%"></b>` : "";
        const rain = data.daily.precipitation_probability_max?.[i];
        const rainTag = rain >= 30 ? `<small class="wt-rain">${rain}%</small>` : "";
        const night = i === 0 && cur.is_day === 0;
        return `<div class="wt-day"><span>${i === 0 ? "今天" : "週" + WEEK_SHORT[new Date(t).getDay()]}</span>
          <span class="wt-dicon">${wIcon(data.daily.weather_code[i], night)}${rainTag}</span><span class="lo">${Math.round(a)}°</span>
          <span class="wt-bar"><i style="left:${left}%;width:${Math.max(width, 4)}%;background:linear-gradient(90deg,${tempColor(a)},${tempColor(b)})"></i>${dot}</span><span class="hi">${Math.round(b)}°</span></div>`;
      }).join("")}</div>`;
    }
    setHTML(pane, `<div class="wt">
      <div class="wt-top">
        <div><div class="wt-city">${esc(data.place || city.name)}</div><div class="wt-temp">${Math.round(cur.temperature_2m)}°</div></div>
        <div class="wt-desc right"><span class="wt-icon">${bigIcon}</span><span>${desc}</span><small>${range}</small></div>
      </div>
      <div class="wt-hours">${hours}</div>${days}</div>`);
  },
};

/* ───────── 空氣品質（美國 AQI，資料來自 Open-Meteo，免註冊） ───────── */
// 等級、顏色、健康說明（跟 iPhone 天氣的空氣品質一樣用美國 AQI）
const AQI_LEVELS = [
  [50, "良好", "#34c759", "空氣品質令人滿意，空氣污染幾乎不會造成風險。"],
  [100, "普通", "#ffcc00", "空氣品質尚可，但污染程度可能會對極少數人的健康造成輕度影響。對臭氧或懸浮微粒特別敏感的人可能會出現呼吸道症狀。"],
  [150, "對敏感族群不健康", "#ff9500", "敏感族群（孩童、長者、有呼吸道疾病的人）可能會受到健康影響，一般大眾比較不容易受影響。"],
  [200, "不健康", "#ff3b30", "每個人都可能開始出現健康影響，敏感族群可能比較嚴重。建議減少戶外活動。"],
  [300, "非常不健康", "#af52de", "健康警報：每個人都可能出現比較嚴重的健康影響。"],
  [Infinity, "危害", "#8e1b3a", "緊急健康警告：所有人都比較容易受到影響，請避免戶外活動。"],
];
const aqiLevel = (v) => AQI_LEVELS.find(([max]) => v <= max);
const AQI_POLLUTANTS = [
  ["pm2_5", "PM2.5", "2.5µm 以下的微粒"], ["pm10", "PM10", "10µm 以下的微粒"],
  ["ozone", "O₃", "臭氧"], ["nitrogen_dioxide", "NO₂", "二氧化氮"],
];
// 色條上的位置（0～500）
const aqiPos = (v) => Math.min(100, Math.max(0, (v / 500) * 100));

let aqiAt = 0;
async function loadAqi(force = false) {
  const needed = [...instances.values()].some((i) => i.panes.has("aqi"));
  if (!needed || paused || (!force && Date.now() - aqiAt < 30 * 60 * 1000)) return;
  aqiAt = Date.now();
  const city = store.city || (await api.getState()).city;
  store.city = city;
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone,us_aqi_nitrogen_dioxide,pm2_5,pm10,ozone,nitrogen_dioxide" +
      "&hourly=us_aqi&past_days=1&forecast_days=1&timezone=auto";
    store.aqi = await (await fetch(url)).json();
    store.aqiError = false;
  } catch {
    store.aqiError = true;
    aqiAt = Date.now() - 28 * 60 * 1000; // 沒網路：2 分鐘後再試
  }
  refresh("aqi");
}
setInterval(() => loadAqi(), 60 * 1000);
api.onWeatherRefresh?.(() => loadAqi(true));

WIDGETS.aqi = {
  render(pane, inst) {
    const d = store.aqi, cur = d?.current;
    const head = `<div class="aq-head">${AQI_DOTS}<span>空氣品質</span></div>`;
    if (!cur || cur.us_aqi == null) {
      setHTML(pane, `<div class="aq">${head}<div class="aq-desc" style="margin-top:auto">${store.aqiError ? "沒有網路" : "讀取中…"}</div></div>`);
      loadAqi();
      return;
    }
    const v = Math.round(cur.us_aqi);
    const [, name, color, health] = aqiLevel(v);
    const bar = `<div class="aq-bar"><b style="left:${aqiPos(v)}%"></b></div>`;
    // 跟昨天這個時候比
    let compare = "";
    const times = d.hourly?.time || [];
    const idx = times.findIndex((t) => new Date(t) > new Date()) - 1;
    const y = idx >= 24 ? d.hourly.us_aqi[idx - 24] : null;
    if (y != null) compare = Math.abs(v - y) <= 10 ? "，與昨天此時相近" : v < y ? "，比昨天此時好" : "，比昨天此時差";
    // 主要污染物：子指標最高的那個
    const main = AQI_POLLUTANTS.map(([k, label, full]) => [cur["us_aqi_" + k] ?? -1, label, full, k]).sort((a, b) => b[0] - a[0])[0];
    if (inst.size === "s") {
      setHTML(pane, `<div class="aq">${head}<div class="aq-num">${v}</div><div class="aq-name" style="color:${color}">${name}</div>${bar}</div>`);
      return;
    }
    const sentence = `<div class="aq-desc">空氣品質指標為 ${v}${compare}。</div>`;
    if (inst.size === "m") {
      setHTML(pane, `<div class="aq">${head}<div class="aq-row"><span class="aq-num">${v}</span><span class="aq-name" style="color:${color}">${name}</span></div>${sentence}${bar}</div>`);
      return;
    }
    const list = AQI_POLLUTANTS.map(([k, label]) => cur[k] == null ? "" :
      `<div class="aq-pol ${k === main[3] ? "main" : ""}"><span>${label}</span><b>${Math.round(cur[k])}</b><small>µg/m³</small></div>`).join("");
    setHTML(pane, `<div class="aq">${head}<div class="aq-row"><span class="aq-num">${v}</span><span class="aq-name" style="color:${color}">${name}</span></div>
      ${sentence}${bar}
      <div class="aq-health">${health}</div>
      <div class="aq-sub">主要污染物：${main[1]}（${main[2]}）</div>
      <div class="aq-pols">${list}</div></div>`);
  },
};
// 跟 iPhone 一樣的小點點圖示
const AQI_DOTS = `<svg class="aq-dots" viewBox="0 0 16 16" aria-hidden="true">${[[8, 2], [4.5, 4], [11.5, 4], [2.5, 8], [8, 6], [13.5, 8], [5.5, 8], [10.5, 8], [8, 10], [4.5, 12], [11.5, 12], [8, 14]]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1"/>`).join("")}</svg>`;

/* ───────── 電量 ───────── */
// 藍牙只會回報電量，不會說有沒有在充電；電量往上升就當作在充電（下降或 15 分鐘沒再升就取消）
const battTrend = new Map(); // id -> { level, chargingUntil }
function chargingGuess(id, level) {
  if (level == null) return false;
  const now = Date.now();
  const t = battTrend.get(id);
  if (!t) { battTrend.set(id, { level, chargingUntil: 0 }); return false; }
  if (level > t.level) t.chargingUntil = now + 15 * 60 * 1000;
  else if (level < t.level) t.chargingUntil = 0;
  t.level = level;
  return now < t.chargingUntil || level === 100 && t.chargingUntil > 0;
}
function batteryList() {
  const list = [];
  if (store.pc) list.push({ id: "pc", name: "這台電腦", type: "laptop", battery: Math.round(store.pc.level * 100), charging: store.pc.charging });
  for (const d of store.devices.filter((d) => d.connected)) {
    // iPhone 捷徑有傳充電狀態就用那個（即時），不然用「電量有沒有變多」來猜
    const guess = chargingGuess(d.id, d.battery);
    const charging = typeof d.charging === "boolean" ? d.charging : guess;
    list.push({ id: d.id, name: d.name, type: deviceType(d.name, d.cod), battery: d.battery, charging });
  }
  // 有自己排過順序的照順序；沒排過的放後面，電量低的在前面
  const order = store.batteryPrefs.order || [];
  const rank = (it) => { const i = order.indexOf(it.id); return i < 0 ? 1e6 + (it.battery ?? 101) : i; };
  return list.filter((it) => !store.batteryPrefs.hidden?.[it.id]).sort((a, b) => rank(a) - rank(b));
}
const ringHTML = (it) => {
  const state = it.battery == null ? "unknown" : it.battery <= 20 ? "low" : "";
  const bolt = it.charging ? `<svg class="bolt" viewBox="0 0 12 18"><path d="M7.2 0 0 10.2h4.6L3.6 18 12 7.2H7.1z"/></svg>` : "";
  return `<div class="ring ${state} ${it.charging ? "charging" : ""}" style="--p:${it.battery ?? 100}">${deviceIcon(it.type)}${bolt}</div>`;
};

// 一頁放幾台：中 4 台；大的照實際放得下的數量（最多 6 台）
const battPer = (inst) => inst.size === "l" ? 6 : 4;

WIDGETS.battery = {
  mount(pane, inst) {
    inst.battPage = 0;
    // 裝置太多時每 6 秒翻頁（滑鼠在上面時不翻）
    inst.timers.push(setInterval(() => {
      if (paused || inst.el.matches(":hover")) return;
      const per = battPer(inst);
      const pages = Math.ceil(batteryList().length / per);
      if (pages > 1) { inst.battPage = (inst.battPage + 1) % pages; WIDGETS.battery.render(pane, inst); }
    }, 6000));
  },
  render(pane, inst) {
    const list = batteryList();
    if (list.length === 0) {
      setHTML(pane, `<div class="setup-msg"><span class="ring unknown" style="--p:0;--size:46px">${icon("other")}</span><small>沒有連線中的藍牙裝置</small></div>`);
      return;
    }
    const per = battPer(inst);
    const pages = Math.ceil(list.length / per);
    if (inst.battPage >= pages) inst.battPage = 0;
    const show = list.slice(inst.battPage * per, (inst.battPage + 1) * per);
    // 大：跟 iPhone／Mac 的「電池」大組件一樣——圖示、名稱（一行，太長用…）、百分比、橫的電池圖；
    // 固定 6 列，沒裝置的列也留著分隔線
    const glyph = (it) => it.battery == null ? "" : `<span class="bglyph ${it.charging ? "charging" : it.battery <= 20 ? "low" : ""}"><i style="width:${Math.max(6, it.battery)}%"></i>${it.charging ? `<svg viewBox="0 0 12 18"><path d="M7.2 0 0 10.2h4.6L3.6 18 12 7.2H7.1z"/></svg>` : ""}</span>`;
    const body = inst.size === "l"
      ? show.map((it) => `<div class="batt-row" title="${esc(it.name)}"><span class="bicon">${deviceIcon(it.type)}</span>
          <b>${esc(it.name)}</b>
          <span class="pct ${it.battery == null ? "none" : ""}">${it.battery != null ? it.battery + "%" : "已連線"}</span>${glyph(it)}</div>`).join("")
        + `<div class="batt-row empty"></div>`.repeat(Math.max(0, per - show.length))
      : show.map((it) => `<div class="batt-item" title="${esc(it.name)}">${ringHTML(it)}
          <span>${it.battery != null ? it.battery + "%" : "已連線"}</span><small>${esc(it.name)}</small></div>`).join("");
    const dots = pages > 1 ? `<div class="dots">${Array.from({ length: pages }, (_, i) => `<i class="${i === inst.battPage ? "on" : ""}"></i>`).join("")}</div>` : "";
    setHTML(pane, `<div class="batt" style="--rows:${per}">${body}</div>${dots}`);
  },
};

/* ───────── 音訊輸出 ───────── */
const GENERIC = /^(喇叭|揚聲器|耳機|耳麥|頭戴式耳機|speakers?|headphones?|headset( earphone)?|earphones?|digital audio|數位音訊|realtek.*)$/i;
function splitName(name) {
  const m = String(name).match(/^(.*?)\s*\((.+)\)$/);
  if (!m) return { title: name, sub: "" };
  return GENERIC.test(m[1].trim()) ? { title: m[2], sub: m[1] } : { title: m[1], sub: m[2] };
}
function outputIcon(name) {
  const t = deviceType(name);
  if (t !== "other" && t !== "phone") return t;
  if (/monitor|display|hdmi|displayport|samsung|lg |dell|benq|asus|顯示器|螢幕/i.test(name)) return "pc";
  return "speaker";
}

WIDGETS.audio = {
  mount(pane) {
    pane.addEventListener("click", (e) => {
      const b = e.target.closest("[data-out]");
      if (b) api.audioSet(b.dataset.out);
    });
  },
  render(pane, inst) {
    const outs = store.audio;
    if (outs.length === 0) {
      setHTML(pane, `<div class="setup-msg"><span class="au-ico" style="width:46px;height:46px">${icon("speaker")}</span><small>沒有找到音訊輸出裝置</small></div>`);
      return;
    }
    const cur = outs.find((o) => o.default) || outs[0];
    if (inst.size === "s") {
      const n = splitName(cur.name);
      const next = outs[(outs.indexOf(cur) + 1) % outs.length];
      setHTML(pane, `<div class="au"><button class="au-now" data-out="${esc(next.id)}" title="點一下換到下一個輸出">
        <span class="au-ico">${icon(outputIcon(cur.name))}</span>
        <b>${esc(n.title)}</b><small>${outs.length > 1 ? "點一下切換" : esc(n.sub || "目前的輸出")}</small></button></div>`);
      return;
    }
    const list = [cur, ...outs.filter((o) => o !== cur)].slice(0, inst.size === "l" ? 7 : 3);
    setHTML(pane, `<div class="au"><div class="au-head">${icon("speaker")}音訊輸出</div>` + list.map((o) => {
      const n = splitName(o.name);
      return `<button class="au-row ${o === cur ? "on" : ""}" data-out="${esc(o.id)}">
        <span class="au-ico">${icon(outputIcon(o.name))}</span>
        <span class="au-text"><b>${esc(n.title)}</b>${n.sub ? `<small>${esc(n.sub)}</small>` : ""}</span>
        ${o === cur ? `<span class="au-check">${icon("check_circle")}</span>` : ""}</button>`;
    }).join("") + `</div>`);
  },
};

/* ───────── 家庭（Philips Hue）：像 iPhone「家庭」小工具，一格一個房間或燈，點一下開關 ───────── */
store.home = null;
let homeAt = 0;
async function loadHome(force = false) {
  const needed = [...instances.values()].some((i) => i.panes.has("home"));
  if (!needed || paused || (!force && Date.now() - homeAt < 8000)) return;
  homeAt = Date.now();
  try { store.home = await api.homeGet(); } catch { store.home = { error: "讀取失敗" }; }
  refresh("home");
}
setInterval(() => loadHome(), 10 * 1000); // 在 Hue App 或牆上開關改了，10 秒內跟著變
api.onHomeChanged?.(() => loadHome(true));

const HOME_TILES = { s: 4, m: 4, l: 8 };
function homeItems(d) {
  const p = d.prefs || {};
  const order = p.order || [];
  // 沒排過順序的：場景、房間、燈
  const rank = (it) => { const i = order.indexOf(it.id); return i < 0 ? 1e4 + ({ scene: 0, off: 500, room: 1000, light: 2000 }[it.kind] ?? 3000) : i; };
  return (d.items || []).filter((it) => !p.hidden?.[it.id]).sort((a, b) => rank(a) - rank(b));
}
// 場景：圓形裡放場景燈光的顏色（Hue App 的場景照片 Bridge 拿不到，用實際顏色代替）
function homeIcon(it) {
  if (it.kind === "off") return `<span class="hm-ico off"></span>`;
  if (it.kind === "scene") {
    const c = it.colors?.length ? it.colors : ["rgb(255,214,150)"];
    const bg = c.length === 1 ? c[0] : `conic-gradient(from 200deg, ${[...c, c[0]].join(",")})`;
    return `<span class="hm-ico scene" style="background:${bg}"></span>`;
  }
  return `<span class="hm-ico">${icon(it.kind === "room" ? "home" : "bulb")}</span>`;
}
const homeStatus = (it) => it.kind === "scene" || it.kind === "off" ? it.room : it.reachable === false ? "沒有回應" : it.on ? (it.bri != null ? `開啟 · ${it.bri}%` : "開啟") : "關閉";

WIDGETS.home = {
  // 方塊是 <button>，拖曳那段程式不會處理按鈕上的點擊，所以這裡自己聽 click
  mount(pane, inst) {
    pane.addEventListener("click", (e) => WIDGETS.home.tap(pane, inst, e.target));
    loadHome(true);
  },
  tap(pane, inst, target) {
    if (target.closest("[data-setup]")) return api.mgrOpen("home");
    const t = target.closest("[data-hid]");
    if (!t) return;
    if (t.dataset.hid.startsWith("s") || t.dataset.hid === "off") {
      // 場景：套用，閃一下「已套用」
      t.classList.add("on");
      const st = t.querySelector("small");
      const sub = st?.textContent;
      if (st) st.textContent = "套用中…";
      api.homeSet(t.dataset.hid, true).then((r) => {
        if (st) st.textContent = r?.error ? "失敗" : "已套用";
        setTimeout(() => { t.classList.remove("on"); if (st) st.textContent = sub; loadHome(true); }, 1500);
      });
      return;
    }
    const on = t.dataset.on !== "1";
    // 先在畫面上切換（感覺比較快），再真的送出；失敗的話下一次讀取會改回來
    t.dataset.on = on ? "1" : "0";
    t.classList.toggle("on", on);
    const st = t.querySelector("small");
    if (st) st.textContent = on ? "開啟" : "關閉";
    const it = store.home?.items?.find((x) => x.id === t.dataset.hid);
    if (it) it.on = on;
    api.homeSet(t.dataset.hid, on).then(() => setTimeout(() => loadHome(true), 700));
  },
  render(pane, inst) {
    const d = store.home;
    if (!d) { setHTML(pane, `<div class="setup-msg"><small>讀取中…</small></div>`); loadHome(true); return; }
    if (d.needSetup) {
      setHTML(pane, `<button class="setup-msg" data-setup><span class="hm-ico big">${icon("home")}</span><p>連接 Philips Hue</p><small>${esc(d.error || "點這裡設定")}</small></button>`);
      return;
    }
    if (d.error && !d.items) {
      setHTML(pane, `<div class="setup-msg"><span class="hm-ico big">${icon("home")}</span><p>${esc(d.error)}</p><small>電腦和 Bridge 要在同一個網路</small></div>`);
      return;
    }
    // 「全部關閉」固定放最後一格（跟 Hue 的小工具一樣）
    const n = HOME_TILES[inst.size] || 4;
    const all = homeItems(d);
    const off = all.find((it) => it.kind === "off");
    const rest = all.filter((it) => it !== off);
    const list = off ? [...rest.slice(0, n - 1), off] : rest.slice(0, n);
    if (!list.length) { setHTML(pane, `<button class="setup-msg" data-setup><small>沒有要顯示的燈，點這裡選</small></button>`); return; }
    setHTML(pane, `<div class="hm hm-${inst.size}">${list.map((it) => `<button class="hm-tile ${it.on ? "on" : ""} ${it.reachable === false ? "dead" : ""}" data-hid="${esc(it.id)}" data-on="${it.on ? 1 : 0}" title="${esc(it.name)}">
      ${homeIcon(it)}
      <span class="hm-text"><b>${esc(it.name)}</b><small>${esc(homeStatus(it))}</small></span></button>`).join("")}</div>`);
  },
};

/* ───────── Google 日曆 ───────── */
function evTime(ev) {
  if (ev.allDay) return "整天";
  const s = new Date(ev.start), e = new Date(ev.end);
  return sameDay(s, e) ? `${hhmm(s)}–${hhmm(e)}` : hhmm(s);
}
const evHTML = (ev) => `<div class="cal-ev" style="--c:${esc(ev.color)}"><b>${esc(ev.title)}</b><small>${evTime(ev)}</small></div>`;
const upcoming = (events, now) => events.filter((e) => (e.allDay ? e.end - 1 : e.end) >= (e.allDay ? dayStart(now).getTime() : now.getTime()));
function groupedList(events, max, now) {
  let html = "", last = "", lastDay = null;
  const dayOf = (ev) => dayStart(new Date(Math.max(ev.start, dayStart(now).getTime()))).getTime();
  for (const ev of events.slice(0, max)) {
    const d = new Date(dayOf(ev));
    const label = sameDay(d, now) ? "今天" : `${d.getMonth() + 1}月${d.getDate()}日${WEEK[d.getDay()]}`;
    if (label !== last) { html += `<div class="cal-head">${label}</div>`; last = label; }
    html += evHTML(ev);
    lastDay = d.getTime();
  }
  // 最後那天還有放不下的行程：「其他 N 個行程」（跟 iPhone 一樣）
  const more = events.slice(max).filter((ev) => dayOf(ev) === lastDay).length;
  if (more) html += `<div class="cal-more">其他 ${more} 個行程</div>`;
  return html;
}

WIDGETS.calendar = {
  tap(pane, inst, target) { if (target.closest("[data-setup]")) api.mgrOpen("calendar"); },
  render(pane, inst) {
    const now = new Date();
    const cal = store.cal;
    if (!cal || cal.needSetup) {
      setHTML(pane, `<div class="setup-msg"><p>Google 日曆</p><small>還沒加入行事曆</small><span class="setup-btn" data-setup>去設定</span></div>`);
      return;
    }
    const events = upcoming(cal.events, now);
    const todayEv = events.filter((e) => e.start < dayStart(new Date(now.getTime() + 864e5)).getTime());
    const l = lunar(now);
    // 像 iPhone：大大的日期，旁邊直排農曆和紅色星期
    const vert = (text, cls) => `<span class="cal-v ${cls}">${[...text].map((c) => `<i>${c}</i>`).join("")}</span>`;
    const todayBlock = inst.size === "m"
      ? `<div class="cal-today">
          <div class="cal-top"><span class="cal-day">${now.getDate()}</span>${l.day ? vert(l.day, "lunar") : ""}${vert("週" + WEEK_SHORT[now.getDay()], "week")}</div>
          ${todayEv.length === 0 ? `<span class="cal-empty">今天沒有行程</span>` : ""}</div>`
      : `<div class="cal-today">
          <span class="cal-week">${WEEK[now.getDay()]}</span><span class="cal-day">${now.getDate()}</span>
          <span class="cal-lunar">${l.day ? "農曆" + l.month + l.day : ""}</span></div>`;
    if (inst.size === "s") {
      const next = events[0];
      const when = next && !sameDay(new Date(Math.max(next.start, now.getTime())), now)
        ? `<div class="cal-head">${new Date(next.start).getMonth() + 1}月${new Date(next.start).getDate()}日</div>` : "";
      setHTML(pane, `<div class="cal">${todayBlock}${next
        ? `<div class="cal-list" style="margin-top:auto;flex:none">${when}${evHTML(next)}</div>`
        : `<span class="cal-empty">沒有接下來的行程</span>`}</div>`);
      return;
    }
    if (inst.size === "m") {
      setHTML(pane, `<div class="cal">${todayBlock}<div class="cal-list">${events.length ? groupedList(events, 2, now) : `<span class="cal-empty" style="margin:auto">接下來沒有行程</span>`}</div></div>`);
      return;
    }
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const startGrid = new Date(first); startGrid.setDate(1 - first.getDay());
    const hasEvent = new Set(cal.events.map((e) => dayStart(new Date(e.start)).getTime()));
    let grid = WEEK_SHORT.map((w) => `<span class="wd">${w}</span>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(startGrid); d.setDate(startGrid.getDate() + i);
      if (i >= 35 && d.getMonth() !== now.getMonth()) break;
      const cls = [d.getMonth() !== now.getMonth() ? "other" : "", sameDay(d, now) ? "today" : "", hasEvent.has(d.getTime()) ? "has" : ""].join(" ");
      grid += `<span class="${cls}">${d.getDate()}</span>`;
    }
    setHTML(pane, `<div class="cal">
      <div class="cal-month-head"><b>${now.getMonth() + 1}月</b><small>${WEEK[now.getDay()]}${l.day ? "・農曆" + l.month + l.day : ""}</small></div>
      <div class="cal-grid">${grid}</div>
      <div class="cal-list">${events.length ? groupedList(events, 2, now) : `<span class="cal-empty">接下來沒有行程</span>`}</div></div>`);
  },
};
setInterval(() => refresh("calendar"), 60 * 1000); // 過了時間的行程會消失、跨日會換日期

/* ───────── Pinterest ───────── */
const PIN_BADGE = `<span class="pn-badge" aria-label="Pinterest">P</span>`;

// Pinterest：小 1 張、中 3 張、大 6 張，隨機順序；每隔設定的時間（10～120 分鐘）一格一格淡入換下一批
const PIN_CELLS = { s: 1, m: 3, l: 6 };
WIDGETS.pinterest = {
  mount(pane, inst) {
    inst.slide = 0;
    inst.swappedAt = Date.now();
    inst.timers.push(setInterval(() => {
      const every = (store.pinInterval || 30) * 60 * 1000;
      if (paused || inst.el.matches(":hover") || Date.now() - inst.swappedAt < every) return;
      inst.swappedAt = Date.now();
      WIDGETS.pinterest.next(pane, inst);
    }, 20 * 1000));
  },
  tap(pane, inst, target) {
    if (target.closest("[data-setup]")) return api.mgrOpen("pinterest");
    const link = target.closest(".pn-cell")?.querySelector(".pn-photo.on")?.dataset.link;
    if (link) api.openPin(link);
  },
  // 一格換一張：先在背後載好再淡入（不會閃白）；載不到先試原本的網址，再不行就換下一張
  show(cell, p, inst, tries = 0) {
    const layers = cell.querySelectorAll(".pn-photo");
    const back = [...layers].find((l) => !l.classList.contains("on")) || layers[0];
    // 省記憶體：格子很小，不用載 600～736 寬的大圖（大圖解碼後一張就好幾 MB）。
    // 中、大的格子用 236 寬，小的用 474 寬；載不到再退回原本的網址
    const want = inst?.size === "s" ? "474x" : "236x";
    const sized = /^https:\/\/i\.pinimg\.com\//.test(p.img || "") ? p.img.replace(/\/(\d+x\d*|originals)\//, `/${want}/`).replace(/\.(png|gif|webp)$/i, ".jpg") : "";
    const urls = [sized, p.img, p.orig].filter((u, i, a) => u && a.indexOf(u) === i);
    const attempt = (k) => {
      const img = new Image();
      img.onload = () => {
        back.src = urls[k];
        back.dataset.link = p.link;
        back.alt = p.title || "";
        layers.forEach((l) => l.classList.toggle("on", l === back));
      };
      img.onerror = () => {
        if (k + 1 < urls.length) return attempt(k + 1);
        console.warn("pin image failed", urls.join(" | "));
        const pins = store.pins?.pins;
        if (inst && pins?.length > 1 && tries < 5) {
          inst.slide = (inst.slide + 1) % pins.length;
          WIDGETS.pinterest.show(cell, pins[inst.slide], inst, tries + 1);
        }
      };
      img.src = urls[k];
    };
    attempt(0);
  },
  next(pane, inst) {
    const pins = store.pins?.pins;
    if (!pins?.length) return;
    pane.querySelectorAll(".pn-cell").forEach((cell, i) => {
      inst.slide = (inst.slide + 1) % pins.length;
      const p = pins[inst.slide];
      setTimeout(() => WIDGETS.pinterest.show(cell, p, inst), i * 700); // 一格一格換
    });
  },
  render(pane, inst) {
    const r = store.pins;
    if (!r || r.needSetup || r.needBoard || r.loginExpired || (!r.pins && r.error)) {
      const msg = !r ? "讀取中…" : r.loginExpired ? "登入過期了" : r.needBoard ? "選一個要顯示的圖版" : r.error && !r.needSetup ? r.error : "還沒設定要顯示的圖";
      setHTML(pane, `<div class="setup-msg">${PIN_BADGE}<p>Pinterest</p><small>${esc(msg)}</small>${r ? `<span class="setup-btn" data-setup>去設定</span>` : ""}</div>`);
      return;
    }
    // 同一組圖就不重來（不然會跳回第一批）
    const sig = r.pins.map((p) => p.img).join("|");
    if (pane.__sig === sig) return;
    pane.__sig = sig;
    const n = PIN_CELLS[inst.size] || 1;
    pane.__html = null;
    const cell = `<div class="pn-cell"><img class="pn-photo" draggable="false" alt=""><img class="pn-photo" draggable="false" alt=""></div>`;
    pane.innerHTML = `<div class="pn-grid n${n}">${cell.repeat(n)}</div>`;
    inst.slide = Math.min(n, r.pins.length) - 1;
    pane.querySelectorAll(".pn-cell").forEach((cell, i) => WIDGETS.pinterest.show(cell, r.pins[i % r.pins.length], inst));
    inst.swappedAt = Date.now();
  },
};
async function loadPins() {
  if (![...instances.values()].some((i) => i.panes.has("pinterest"))) return;
  store.pins = await api.getPins();
  refresh("pinterest");
}
setInterval(loadPins, 30 * 60 * 1000);
api.onPinsChanged?.(loadPins);

/* ───────── 從主程式來的資料 ───────── */
(async () => {
  const st = await api.getState();
  store.devices = st.devices || [];
  store.city = st.city;
  store.batteryPrefs = st.batteryPrefs || store.batteryPrefs;
  store.audio = (await api.audioGet()).outputs || [];
  store.cal = await api.calGet();
  refresh(...Object.keys(WIDGETS));
  loadPins();
  loadWeather(true);
})();
api.onDevices((list) => { store.devices = list; refresh("battery"); });
api.onBatteryPrefs?.((p) => { store.batteryPrefs = p; refresh("battery"); });
api.onAudio?.((list) => { store.audio = list; refresh("audio"); });
api.onCalUpdate?.((d) => { store.cal = d; refresh("calendar"); });
// 筆電才顯示自己的電池；桌機（沒有電池時 Chromium 回報 100%、充電中、0 秒充飽）不顯示
navigator.getBattery?.().then((b) => {
  const read = () => {
    const isDesktop = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;
    store.pc = isDesktop ? null : { level: b.level, charging: b.charging };
    refresh("battery");
  };
  read();
  b.addEventListener("levelchange", read);
  b.addEventListener("chargingchange", read);
});
// 新加了天氣或 Pinterest 小組件時，馬上去抓資料
api.onHostLayout?.(() => setTimeout(() => { loadWeather(); loadAqi(); if (!store.pins) loadPins(); }, 50));
