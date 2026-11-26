// 整個主螢幕只有這一個透明視窗，所有小組件（和疊放）都畫在這裡。
// - 每個小組件是一個「實例」：自己的位置、大小、內容，用自己的元素，不靠全域 id
// - 內容只在真的有變的時候才重畫（以前每 6 秒整個重畫一次，入場動畫重播，看起來會閃）
// - 拖動只是在畫面裡移動，放開時自動對齊格子；不會再動到視窗本身
// - 視窗平常點得穿，滑鼠移到小組件上時才接收滑鼠

const api = window.api;
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
    if (kinds.includes(kind)) WIDGETS[kind].render(pane, inst);
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

  const inst = { key: item.key, kinds: item.kinds, size: item.size, x: item.x, y: item.y, el, backdrop, panes: new Map(), timers: [] };
  const mountPane = (kind, parent) => {
    const pane = document.createElement("div");
    pane.className = `pane ${kind}`;
    parent.append(pane);
    inst.panes.set(kind, pane);
    WIDGETS[kind].mount?.(pane, inst);
    WIDGETS[kind].render(pane, inst);
  };

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
    instances.set(item.key, createInstance(item));
  }
  for (const [key, inst] of instances) if (!keep.has(key)) { destroyInstance(inst); instances.delete(key); }
});

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
const NO_DRAG = "button, input, a, select, textarea, label, .pn-pin, .stack-dots i";
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
function snapToGrid(inst) {
  const [w, h] = SIZES[inst.size];
  const o = gridOrigin();
  const maxCol = Math.floor((hostRect.width - w - o.x) / CELL);
  const maxRow = Math.floor((hostRect.height - h - o.y) / CELL);
  const col0 = Math.round((inst.x - o.x) / CELL), row0 = Math.round((inst.y - o.y) / CELL);
  const rect = (c, r) => ({ x: o.x + c * CELL, y: o.y + r * CELL, w, h });
  const overlaps = (a) => [...instances.values()].some((other) => {
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
WIDGETS.clock = {
  mount(pane) {
    pane.innerHTML = `
      <div class="analog"><i class="hand h"></i><i class="hand m"></i><i class="hand s"></i><i class="pin"></i></div>
      <div class="clock-info"><div class="digital"></div>
        <div class="clock-meta"><span class="cm-week"></span><b class="cm-day"></b></div>
        <div class="clock-date"></div><div class="lunar"></div></div>`;
    pane.__h = pane.querySelector(".hand.h");
    pane.__m = pane.querySelector(".hand.m");
    pane.__s = pane.querySelector(".hand.s");
  },
  render(pane) {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    pane.__h.style.transform = `rotate(${(h % 12) * 30 + m * 0.5}deg)`;
    pane.__m.style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
    pane.__s.style.transform = `rotate(${s * 6}deg)`;
    const set = (sel, text) => { const el = pane.querySelector(sel); if (el.textContent !== text) el.textContent = text; };
    set(".digital", hhmm(now));
    set(".cm-week", WEEK[now.getDay()]);
    set(".cm-day", String(now.getDate()));
    set(".clock-date", `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`);
    const l = lunar(now);
    set(".lunar", l.day ? `農曆${l.month}${l.day}` : "");
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
const wIcon = (code) => { const [, name, color] = weatherLook(code); return `<span style="color:${color}">${icon(name)}</span>`; };

let weatherAt = 0;
async function loadWeather(force = false) {
  const needed = [...instances.values()].some((i) => i.panes.has("weather"));
  if (!needed || paused || (!force && Date.now() - weatherAt < 20 * 60 * 1000)) return;
  weatherAt = Date.now();
  const { city } = await api.getState();
  store.city = city;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=6";
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
    const [desc, iconName, color] = weatherLook(cur.weather_code);
    const range = `高 ${Math.round(data.daily.temperature_2m_max[0])}° 低 ${Math.round(data.daily.temperature_2m_min[0])}°`;
    if (inst.size === "s") {
      setHTML(pane, `<div class="wt">
        <div class="wt-top"><div class="wt-city">${esc(city.name)}</div><span class="wt-icon" style="color:${color}">${icon(iconName)}</span></div>
        <div class="wt-temp">${Math.round(cur.temperature_2m)}°</div>
        <div class="wt-desc"><span>${desc}</span><small>${range}</small></div></div>`);
      return;
    }
    const nowIdx = Math.max(0, data.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1);
    const hours = data.hourly.time.slice(nowIdx, nowIdx + 6).map((t, i) => {
      const k = nowIdx + i;
      return `<div class="wt-hour"><small>${i === 0 ? "現在" : new Date(t).getHours() + "時"}</small>
        ${wIcon(data.hourly.weather_code[k])}<span>${Math.round(data.hourly.temperature_2m[k])}°</span></div>`;
    }).join("");
    let days = "";
    if (inst.size === "l") {
      const min = Math.min(...data.daily.temperature_2m_min), max = Math.max(...data.daily.temperature_2m_max);
      days = `<div class="wt-days">${data.daily.time.slice(0, 5).map((t, i) => {
        const a = data.daily.temperature_2m_min[i], b = data.daily.temperature_2m_max[i];
        const left = ((a - min) / (max - min || 1)) * 100, width = ((b - a) / (max - min || 1)) * 100;
        return `<div class="wt-day"><span>${i === 0 ? "今天" : "週" + WEEK_SHORT[new Date(t).getDay()]}</span>
          ${wIcon(data.daily.weather_code[i])}<span class="lo">${Math.round(a)}°</span>
          <span class="wt-bar"><i style="left:${left}%;width:${Math.max(width, 4)}%"></i></span><span>${Math.round(b)}°</span></div>`;
      }).join("")}</div>`;
    }
    setHTML(pane, `<div class="wt">
      <div class="wt-top">
        <div><div class="wt-city">${esc(city.name)}</div><div class="wt-temp">${Math.round(cur.temperature_2m)}°</div></div>
        <div class="wt-desc right"><span class="wt-icon" style="color:${color}">${icon(iconName)}</span><span>${desc}</span><small>${range}</small></div>
      </div>
      <div class="wt-hours">${hours}</div>${days}</div>`);
  },
};

/* ───────── 電量 ───────── */
function batteryList() {
  const list = [];
  if (store.pc) list.push({ id: "pc", name: "這台電腦", type: "laptop", battery: Math.round(store.pc.level * 100), sub: store.pc.charging ? "充電中" : "" });
  for (const d of store.devices.filter((d) => d.connected)) {
    list.push({ id: d.id, name: d.name, type: deviceType(d.name, d.cod), battery: d.battery, sub: d.battery == null ? "已連線" : "" });
  }
  // 有自己排過順序的照順序；沒排過的放後面，電量低的在前面
  const order = store.batteryPrefs.order || [];
  const rank = (it) => { const i = order.indexOf(it.id); return i < 0 ? 1e6 + (it.battery ?? 101) : i; };
  return list.filter((it) => !store.batteryPrefs.hidden?.[it.id]).sort((a, b) => rank(a) - rank(b));
}
const ringHTML = (it) => {
  const state = it.battery == null ? "unknown" : it.battery <= 20 ? "low" : "";
  return `<div class="ring ${state}" style="--p:${it.battery ?? 100}">${deviceIcon(it.type)}</div>`;
};

WIDGETS.battery = {
  mount(pane, inst) {
    inst.battPage = 0;
    // 裝置太多時每 6 秒翻頁（滑鼠在上面時不翻）
    inst.timers.push(setInterval(() => {
      if (paused || inst.el.matches(":hover")) return;
      const per = inst.size === "l" ? 5 : 4;
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
    const per = inst.size === "l" ? 5 : 4;
    const pages = Math.ceil(list.length / per);
    if (inst.battPage >= pages) inst.battPage = 0;
    const show = list.slice(inst.battPage * per, (inst.battPage + 1) * per);
    const body = inst.size === "l"
      ? show.map((it) => `<div class="batt-row">${ringHTML(it)}
          <div><b>${esc(it.name)}</b>${it.sub ? `<small>${it.sub}</small>` : ""}
          ${it.battery != null ? `<div class="batt-bar"><i class="${it.battery <= 20 ? "low" : ""}" style="width:${it.battery}%"></i></div>` : ""}</div>
          <span class="pct">${it.battery != null ? it.battery + "%" : ""}</span></div>`).join("")
      : show.map((it) => `<div class="batt-item" title="${esc(it.name)}">${ringHTML(it)}
          <span>${it.battery != null ? it.battery + "%" : "已連線"}</span><small>${esc(it.name)}</small></div>`).join("");
    const dots = pages > 1 ? `<div class="dots">${Array.from({ length: pages }, (_, i) => `<i class="${i === inst.battPage ? "on" : ""}"></i>`).join("")}</div>` : "";
    setHTML(pane, `<div class="batt">${body}</div>${dots}`);
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

/* ───────── Google 日曆 ───────── */
function evTime(ev) {
  if (ev.allDay) return "整天";
  const s = new Date(ev.start), e = new Date(ev.end);
  return sameDay(s, e) ? `${hhmm(s)}–${hhmm(e)}` : hhmm(s);
}
const evHTML = (ev) => `<div class="cal-ev" style="--c:${esc(ev.color)}"><b>${esc(ev.title)}</b><small>${evTime(ev)}</small></div>`;
const upcoming = (events, now) => events.filter((e) => (e.allDay ? e.end - 1 : e.end) >= (e.allDay ? dayStart(now).getTime() : now.getTime()));
function groupedList(events, max, now) {
  let html = "", last = "";
  for (const ev of events.slice(0, max)) {
    const d = new Date(Math.max(ev.start, dayStart(now).getTime()));
    const label = sameDay(d, now) ? "今天" : `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
    if (label !== last) { html += `<div class="cal-head">${label}</div>`; last = label; }
    html += evHTML(ev);
  }
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
    const todayBlock = `<div class="cal-today">
        <span class="cal-week">${WEEK[now.getDay()]}</span><span class="cal-day">${now.getDate()}</span>
        <span class="cal-lunar">${l.day ? "農曆" + l.month + l.day : ""}</span>
        ${todayEv.length === 0 && inst.size === "m" ? `<span class="cal-empty">今天沒有行程</span>` : ""}</div>`;
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

WIDGETS.pinterest = {
  mount(pane, inst) {
    inst.slide = 0;
    if (inst.size === "s") {
      inst.timers.push(setInterval(() => {
        const imgs = pane.querySelectorAll(".pn-pin");
        if (paused || imgs.length < 2) return;
        imgs[inst.slide % imgs.length].classList.remove("on");
        inst.slide = (inst.slide + 1) % imgs.length;
        imgs[inst.slide].classList.add("on");
      }, 8000));
    }
  },
  tap(pane, inst, target) {
    if (target.closest("[data-setup]")) api.mgrOpen("pinterest");
  },
  render(pane, inst) {
    const r = store.pins;
    if (!r || r.needSetup || r.needBoard || r.loginExpired || (!r.pins && r.error)) {
      const msg = !r ? "讀取中…" : r.loginExpired ? "登入過期了" : r.needBoard ? "選一個要顯示的圖版" : r.error && !r.needSetup ? r.error : "還沒設定要顯示的圖";
      setHTML(pane, `<div class="setup-msg">${PIN_BADGE}<p>Pinterest</p><small>${esc(msg)}</small>${r ? `<span class="setup-btn" data-setup>去設定</span>` : ""}</div>`);
      return;
    }
    // 同一組圖就不重畫（不然圖片會重新載入、閃一下）
    const sig = r.pins.map((p) => p.img).join("|") + inst.size;
    if (pane.__sig === sig) return;
    pane.__sig = sig;
    const pinImg = (p) => `<img class="pn-pin" src="${esc(p.img)}" alt="${esc(p.title)}" title="${esc(p.title)}" draggable="false" decoding="async" loading="lazy" data-link="${esc(p.link)}">`;
    if (inst.size === "s") {
      pane.innerHTML = `<div class="pn-head">${PIN_BADGE}</div><div class="pn-wall"><div class="pn-col a">${r.pins.map(pinImg).join("")}</div></div>`;
      inst.slide = 0;
      pane.querySelector(".pn-pin")?.classList.add("on");
    } else {
      const n = inst.size === "m" ? 3 : 2;
      const cols = Array.from({ length: n }, () => []);
      r.pins.forEach((p, i) => cols[i % n].push(p));
      // 同一組放兩次，捲到一半時剛好接回開頭，看起來就是無限捲動
      pane.innerHTML = `<div class="pn-head">${PIN_BADGE}<b>${esc(r.title || "Pinterest")}</b></div>
        <div class="pn-wall">${cols.map((c, i) => `<div class="pn-col" style="--dur:${Math.max(20, c.length * [7, 9, 8][i])}s">${c.map(pinImg).join("")}${c.map(pinImg).join("")}</div>`).join("")}</div>`;
    }
    pane.querySelectorAll(".pn-pin").forEach((img) => {
      img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
      img.addEventListener("click", () => api.openPin(img.dataset.link));
    });
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
api.onHostLayout?.(() => setTimeout(() => { loadWeather(); if (!store.pins) loadPins(); }, 50));
