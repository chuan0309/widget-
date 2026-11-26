const params = new URLSearchParams(location.search);
const kind = params.get("kind") || "clock";
const size = ["s", "m", "l"].includes(params.get("size")) ? params.get("size") : "s";
document.body.className = `glass-${params.get("glass") || "acrylic"} size-${size}`;
// 透明程度（0–100），管理程式拖滑桿時會即時傳過來
const setTintVar = (v) => document.body.style.setProperty("--t", String(Math.min(100, Math.max(0, Number(v))) / 100));
setTintVar(params.get("tint") ?? 30);
window.api.onTint?.(setTintVar);
document.querySelector(`[data-kind="${kind}"]`).hidden = false;

/* ───────── 圓角毛玻璃：模糊的桌布對準小組件的位置 ───────── */
const card = document.querySelector(`[data-kind="${kind}"]`);
let wall = null;
let backdropEl = null;

function layoutBackdrop({ win, area, scale }) {
  if (!wall || !backdropEl) return;
  if (wall.mode === "color") {
    backdropEl.style.cssText = `inset:-40px;background:${wall.color}`;
    return;
  }
  // 照 Windows 的「調整方式」算出桌布在螢幕上畫在哪裡、多大
  const iw = wall.width / scale, ih = wall.height / scale; // 圖片原始大小（換成螢幕座標）
  let w = area.width, h = area.height;
  if (wall.mode === "fill" || wall.mode === "span") {
    const k = Math.max(area.width / iw, area.height / ih); w = iw * k; h = ih * k;
  } else if (wall.mode === "fit") {
    const k = Math.min(area.width / iw, area.height / ih); w = iw * k; h = ih * k;
  } else if (wall.mode === "center") {
    w = iw; h = ih;
  }
  const x = area.x + (area.width - w) / 2 - win.x;
  const y = area.y + (area.height - h) / 2 - win.y;
  const st = backdropEl.style;
  if (wall.mode === "tile") {
    st.left = `${area.x - win.x}px`; st.top = `${area.y - win.y}px`;
    st.width = `${area.width}px`; st.height = `${area.height}px`;
    st.backgroundRepeat = "repeat"; st.backgroundSize = `${iw}px ${ih}px`;
  } else {
    st.left = `${x}px`; st.top = `${y}px`; st.width = `${w}px`; st.height = `${h}px`;
  }
}

window.api.onBackdrop?.((data) => {
  if (data.wall !== undefined) {
    wall = data.wall;
    if (wall && !backdropEl) {
      backdropEl = document.createElement("div");
      backdropEl.className = "backdrop";
      card.prepend(backdropEl);
    }
    if (backdropEl && wall?.url) backdropEl.style.backgroundImage = `url("${wall.url}")`;
    card.classList.toggle("has-backdrop", !!wall);
    if (!wall && backdropEl) { backdropEl.remove(); backdropEl = null; }
  }
  layoutBackdrop(data);
});

const $ = (id) => document.getElementById(id);
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* ───────── 右鍵選單（大小、移除） ───────── */
window.addEventListener("contextmenu", (e) => { e.preventDefault(); window.api.widgetMenu(); });

/* ───────── 省電：被別的視窗蓋住、螢幕鎖定時停下來 ───────── */
// 每個小組件用 every() 註冊要定時做的事；暫停時全部停掉，回來時馬上補做一次
const jobs = [];
let paused = false;
function every(ms, fn, { now = true } = {}) {
  const job = { ms, fn, timer: null };
  jobs.push(job);
  if (now) fn();
  job.timer = setInterval(() => !paused && fn(), ms);
  return job;
}
function setPaused(p) {
  if (p === paused) return;
  paused = p;
  document.body.classList.toggle("paused", p);
  if (!p) jobs.forEach((j) => j.fn()); // 回來了：馬上更新一次
}
let mainPaused = false;
const updatePaused = () => setPaused(mainPaused || document.visibilityState === "hidden");
document.addEventListener("visibilitychange", updatePaused);
window.api.onPaused?.((p) => { mainPaused = p; updatePaused(); });

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
  const month = parts.find((p) => p.type === "month")?.value || "";
  const day = LUNAR_DAYS[Number(parts.find((p) => p.type === "day")?.value)] || "";
  return { month, day };
}
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* ───────── 時鐘 ───────── */
function tick() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  $("hHand").style.transform = `rotate(${(h % 12) * 30 + m * 0.5}deg)`;
  $("mHand").style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
  $("sHand").style.transform = `rotate(${s * 6}deg)`;
  $("dateWeek").textContent = WEEK[now.getDay()];
  $("dateDay").textContent = now.getDate();
  $("digital").textContent = hhmm(now);
  $("dateFull").textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;
  const l = lunar(now);
  $("lunar").textContent = l.day ? `農曆${l.month}${l.day}` : "";
}
if (kind === "clock") every(1000, tick);

/* ───────── 天氣（Open-Meteo，免費、不用註冊）───────── */
// 天氣代碼 → [說明, 圖示, 顏色]
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
async function loadWeather() {
  if (Date.now() - weatherAt < 20 * 60 * 1000) return; // 20 分鐘內不重抓
  const { city } = await window.api.getState();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=6";
    const data = await (await fetch(url)).json();
    weatherAt = Date.now();
    renderWeather(city, data);
  } catch {
    $("wt").innerHTML = `<div class="wt-city">${escapeHTML(city.name)}</div><div class="wt-desc" style="margin-top:auto;text-align:left">沒有網路</div>`;
  }
}

function renderWeather(city, data) {
  const cur = data.current;
  const [desc, iconName, color] = weatherLook(cur.weather_code);
  const hi = Math.round(data.daily.temperature_2m_max[0]), lo = Math.round(data.daily.temperature_2m_min[0]);
  const range = `高 ${hi}° 低 ${lo}°`;

  if (size === "s") {
    $("wt").innerHTML = `
      <div class="wt-top"><div class="wt-city">${escapeHTML(city.name)}</div><span class="wt-icon" style="color:${color}">${icon(iconName)}</span></div>
      <div class="wt-temp">${Math.round(cur.temperature_2m)}°</div>
      <div class="wt-desc"><span>${desc}</span><small>${range}</small></div>`;
    return;
  }

  // 接下來 6 個小時
  const nowIdx = Math.max(0, data.hourly.time.findIndex((t) => new Date(t) > new Date()) - 1);
  const hours = data.hourly.time.slice(nowIdx, nowIdx + 6).map((t, i) => {
    const k = nowIdx + i;
    return `<div class="wt-hour"><small>${i === 0 ? "現在" : new Date(t).getHours() + "時"}</small>
      ${wIcon(data.hourly.weather_code[k])}<span>${Math.round(data.hourly.temperature_2m[k])}°</span></div>`;
  }).join("");

  let days = "";
  if (size === "l") {
    const min = Math.min(...data.daily.temperature_2m_min), max = Math.max(...data.daily.temperature_2m_max);
    days = `<div class="wt-days">${data.daily.time.slice(0, 5).map((t, i) => {
      const a = data.daily.temperature_2m_min[i], b = data.daily.temperature_2m_max[i];
      const left = ((a - min) / (max - min || 1)) * 100, width = ((b - a) / (max - min || 1)) * 100;
      return `<div class="wt-day"><span>${i === 0 ? "今天" : "週" + WEEK_SHORT[new Date(t).getDay()]}</span>
        ${wIcon(data.daily.weather_code[i])}<span class="lo">${Math.round(a)}°</span>
        <span class="wt-bar"><i style="left:${left}%;width:${Math.max(width, 4)}%"></i></span><span>${Math.round(b)}°</span></div>`;
    }).join("")}</div>`;
  }

  $("wt").innerHTML = `
    <div class="wt-top">
      <div><div class="wt-city">${escapeHTML(city.name)}</div><div class="wt-temp">${Math.round(cur.temperature_2m)}°</div></div>
      <div class="wt-desc"><span class="wt-icon" style="color:${color};align-self:flex-end">${icon(iconName)}</span><span>${desc}</span><small>${range}</small></div>
    </div>
    <div class="wt-hours">${hours}</div>${days}`;
}
if (kind === "weather") every(60 * 1000, loadWeather);

/* ───────── 電量 ───────── */
let pcBattery = null; // 只有筆電才會有；桌機不顯示
let btDevices = [];
let battPage = 0;
let battPageJob = null;

function batteryList() {
  const list = [];
  if (pcBattery) list.push({ name: "這台電腦", type: "laptop", battery: Math.round(pcBattery.level * 100), sub: pcBattery.charging ? "充電中" : "" });
  for (const d of btDevices.filter((d) => d.connected).sort((a, b) => (a.battery ?? 101) - (b.battery ?? 101))) {
    list.push({ name: d.name, type: deviceType(d.name, d.cod), battery: d.battery, sub: d.battery == null ? "已連線" : "" });
  }
  return list;
}

function ringHTML(it) {
  const state = it.battery == null ? "unknown" : it.battery <= 20 ? "low" : "";
  return `<div class="ring ${state}" style="--p:${it.battery ?? 100}">${deviceIcon(it.type)}</div>`;
}

function renderBattery() {
  const list = batteryList();
  if (list.length === 0) {
    $("batt").innerHTML = `<div class="setup-msg"><span class="ring unknown" style="--p:0;--size:46px">${icon("other")}</span>
      <small>沒有連線中的藍牙裝置</small></div>`;
    $("battDots").innerHTML = "";
    return;
  }
  const per = size === "l" ? 5 : 4;
  const pages = Math.ceil(list.length / per);
  if (battPage >= pages) battPage = 0;
  const show = list.slice(battPage * per, (battPage + 1) * per);

  if (size === "l") {
    $("batt").innerHTML = show.map((it) => `
      <div class="batt-row">${ringHTML(it)}
        <div><b>${escapeHTML(it.name)}</b>${it.sub ? `<small>${it.sub}</small>` : ""}
          ${it.battery != null ? `<div class="batt-bar"><i class="${it.battery <= 20 ? "low" : ""}" style="width:${it.battery}%"></i></div>` : ""}</div>
        <span class="pct">${it.battery != null ? it.battery + "%" : ""}</span></div>`).join("");
  } else {
    $("batt").innerHTML = show.map((it) => `
      <div class="batt-item" title="${escapeHTML(it.name)}">${ringHTML(it)}
        <span>${it.battery != null ? it.battery + "%" : "已連線"}</span><small>${escapeHTML(it.name)}</small></div>`).join("");
  }
  $("battDots").innerHTML = pages > 1
    ? Array.from({ length: pages }, (_, i) => `<i class="${i === battPage ? "on" : ""}"></i>`).join("") : "";
}

async function initBattery() {
  if (navigator.getBattery) {
    const b = await navigator.getBattery();
    const read = () => {
      // 桌機沒有電池時，Chromium 會回報「100%、充電中、0 秒充飽」→ 不顯示
      const isDesktop = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;
      pcBattery = isDesktop ? null : { level: b.level, charging: b.charging };
      renderBattery();
    };
    read();
    b.addEventListener("levelchange", read);
    b.addEventListener("chargingchange", read);
  }
  btDevices = (await window.api.getState()).devices;
  renderBattery();
  window.api.onDevices((list) => { btDevices = list; if (!paused) renderBattery(); });
  // 裝置太多時每 6 秒翻頁（滑鼠在上面時不翻）
  battPageJob = every(6000, () => {
    if (document.querySelector(".battery:hover")) return;
    const per = size === "l" ? 5 : 4;
    const pages = Math.ceil(batteryList().length / per);
    if (pages > 1) battPage = (battPage + 1) % pages;
    renderBattery();
  }, { now: false });
}
if (kind === "battery") initBattery();

/* ───────── Google 日曆 ───────── */
let calData = null;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function evTime(ev) {
  if (ev.allDay) return "整天";
  const s = new Date(ev.start), e = new Date(ev.end);
  return sameDay(s, e) ? `${hhmm(s)}–${hhmm(e)}` : hhmm(s);
}
function evHTML(ev) {
  return `<div class="cal-ev" style="--c:${ev.color}"><b>${escapeHTML(ev.title)}</b><small>${evTime(ev)}</small></div>`;
}
// 還沒結束的行程（全天行程算到當天結束）
function upcoming(events, now) {
  return events.filter((e) => (e.allDay ? e.end - 1 : e.end) >= (e.allDay ? dayStart(now).getTime() : now.getTime()));
}
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

function renderCalendar() {
  const now = new Date();
  if (!calData || calData.needSetup) {
    $("cal").innerHTML = `<div class="setup-msg"><p>Google 日曆</p><small>還沒加入行事曆</small>
      <button id="calSetup">去設定</button></div>`;
    $("calSetup").addEventListener("click", () => window.api.mgrOpen("calendar"));
    return;
  }
  const events = upcoming(calData.events, now);
  const todayEv = events.filter((e) => e.start < dayStart(new Date(now.getTime() + 864e5)).getTime());
  const l = lunar(now);
  const todayBlock = `<div class="cal-today">
      <span class="cal-week">${WEEK[now.getDay()]}</span>
      <span class="cal-day">${now.getDate()}</span>
      <span class="cal-lunar">${l.day ? "農曆" + l.month + l.day : ""}</span>
      ${todayEv.length === 0 && size === "m" ? `<span class="cal-empty">今天沒有行程</span>` : ""}
    </div>`;

  if (size === "s") {
    const next = events[0];
    const when = next && !sameDay(new Date(Math.max(next.start, now.getTime())), now)
      ? `<div class="cal-head">${new Date(next.start).getMonth() + 1}月${new Date(next.start).getDate()}日</div>` : "";
    $("cal").innerHTML = todayBlock +
      (next ? `<div class="cal-list" style="margin-top:auto;flex:none">${when}${evHTML(next)}</div>`
        : `<span class="cal-empty">沒有接下來的行程</span>`);
    return;
  }

  if (size === "m") {
    $("cal").innerHTML = todayBlock + `<div class="cal-list">${events.length ? groupedList(events, 2, now) : `<span class="cal-empty" style="margin:auto">接下來沒有行程</span>`}</div>`;
    return;
  }

  // 大：月曆＋接下來的行程
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const startGrid = new Date(first); startGrid.setDate(1 - first.getDay());
  const hasEvent = new Set(calData.events.map((e) => dayStart(new Date(e.start)).getTime()));
  let grid = WEEK_SHORT.map((w) => `<span class="wd">${w}</span>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(startGrid); d.setDate(startGrid.getDate() + i);
    if (i >= 35 && d.getMonth() !== now.getMonth()) break; // 只有 5 週就不畫第 6 週
    const cls = [d.getMonth() !== now.getMonth() ? "other" : "", sameDay(d, now) ? "today" : "", hasEvent.has(d.getTime()) ? "has" : ""].join(" ");
    grid += `<span class="${cls}">${d.getDate()}</span>`;
  }
  $("cal").innerHTML = `
    <div class="cal-month-head"><b>${now.getMonth() + 1}月</b><small>${WEEK[now.getDay()]}${l.day ? "・農曆" + l.month + l.day : ""}</small></div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-list">${events.length ? groupedList(events, 2, now) : `<span class="cal-empty">接下來沒有行程</span>`}</div>`;
}

async function initCalendar() {
  calData = await window.api.calGet();
  renderCalendar();
  window.api.onCalUpdate((d) => { calData = d; if (!paused) renderCalendar(); });
  every(60 * 1000, renderCalendar, { now: false }); // 每分鐘重畫（過了時間的行程會消失、跨日會換日期）
}
if (kind === "calendar") initCalendar();

/* ───────── Pinterest ───────── */
const pnCard = document.querySelector(".pinterest");
let hasPins = false;
const PIN_SVG = icon("pin");
const LOCK_SVG = icon("lock");

function pinElement(pin) {
  const img = document.createElement("img");
  img.className = "pn-pin";
  img.src = pin.img;
  img.alt = pin.title || "";
  img.title = pin.title || "";
  img.draggable = false;
  img.addEventListener("load", () => img.classList.add("loaded"));
  img.addEventListener("click", () => window.api.openPin(pin.link));
  return img;
}

// 小：一次一張慢慢換；中：三欄；大：兩欄，各欄用不同速度往上捲
let slideIndex = 0;
function renderPins({ title, pins }) {
  $("pnTitle").textContent = title || "Pinterest";
  hasPins = true;
  if (size === "s") {
    const col = $("pnColA");
    col.replaceChildren(...pins.map(pinElement));
    slideIndex = 0;
    col.firstChild?.classList.add("on");
    return;
  }
  const n = size === "m" ? 3 : 2;
  const cols = Array.from({ length: n }, () => []);
  pins.forEach((p, i) => cols[i % n].push(p));
  [$("pnColA"), $("pnColB"), $("pnColC")].slice(0, n).forEach((col, i) => {
    col.replaceChildren();
    // 同一組放兩次，捲到一半時剛好接回開頭，看起來就是無限捲動
    for (let round = 0; round < 2; round++) cols[i].forEach((p) => col.append(pinElement(p)));
    col.style.setProperty("--dur", `${Math.max(20, cols[i].length * [7, 9, 8][i])}s`);
  });
}
if (kind === "pinterest" && size === "s") {
  every(8000, () => {
    const imgs = $("pnColA").children;
    if (imgs.length < 2) return;
    imgs[slideIndex % imgs.length].classList.remove("on");
    slideIndex = (slideIndex + 1) % imgs.length;
    imgs[slideIndex].classList.add("on");
  }, { now: false });
}

function clearPins() {
  $("pnColA").replaceChildren();
  $("pnColB").replaceChildren();
  $("pnColC").replaceChildren();
  $("pnTitle").textContent = "Pinterest";
  hasPins = false;
}

/* 設定面板裡切換畫面 */
function showView(name, error = "") {
  pnCard.classList.add("setup");
  $("pnSetup").hidden = false;
  showMsg("");
  for (const v of document.querySelectorAll(".pn-view")) {
    const on = v.dataset.view === name;
    v.classList.toggle("on", on);
    const err = v.querySelector("[data-error]");
    if (err) err.textContent = on ? error : "";
  }
  document.querySelector(`.pn-view[data-view="${name}"] input`)?.focus();
}
function hideSetup() {
  pnCard.classList.remove("setup");
  $("pnSetup").hidden = true;
}
function showMsg(text) {
  $("pnMsg").textContent = text;
  $("pnMsg").hidden = !text;
}

function applyPins(result) {
  // 小、中尺寸放不下設定畫面 → 請使用者到管理程式設定
  if (size !== "l" && (result.needSetup || result.needBoard || result.loginExpired)) {
    showMsg("");
    let box = document.querySelector(".pn-small-setup");
    if (!box) {
      box = document.createElement("div");
      box.className = "setup-msg pn-small-setup";
      box.style.cssText = "position:absolute;inset:0;z-index:2";
      box.innerHTML = `<p>Pinterest</p><small>${result.loginExpired ? "登入過期了" : "還沒設定要顯示的圖"}</small><button>去設定</button>`;
      box.querySelector("button").addEventListener("click", () => window.api.mgrOpen("pinterest"));
      pnCard.append(box);
    }
    return;
  }
  document.querySelector(".pn-small-setup")?.remove();
  if (result.needSetup) return showView("choice");
  if (result.needBoard) return openBoards();
  if (result.loginExpired) return showView("login", result.error);
  hideSetup();
  if (result.pins) { renderPins(result); showMsg(""); }
  else if (result.error) { if (result.title) $("pnTitle").textContent = result.title; showMsg(result.error); }
}

/* 選圖版 */
async function openBoards() {
  showView("boards");
  const list = $("pnBoards");
  list.innerHTML = '<small style="padding:10px">讀取中…</small>';
  const status = await window.api.pinterestStatus();
  $("pnUser").textContent = status.username ? `@${status.username}` : "";
  const res = await window.api.pinterestBoards();
  if (res.error) {
    list.replaceChildren();
    return res.loginExpired ? showView("login", res.error) : showView("boards", res.error);
  }
  const current = status.source?.id;
  const items = [{ id: "all", name: "我存的所有 pin", count: null, cover: "", all: true }, ...res.boards];
  list.replaceChildren(...items.map((b) => {
    const row = document.createElement("button");
    row.className = "pn-board" + (b.id === current ? " on" : "");
    const thumb = document.createElement("span");
    thumb.className = "pn-thumb";
    if (b.cover) thumb.style.backgroundImage = `url("${encodeURI(b.cover)}")`;
    else thumb.innerHTML = PIN_SVG;
    const name = document.createElement("span");
    name.className = "pn-board-name";
    name.textContent = b.name;
    const meta = document.createElement("span");
    meta.className = "pn-board-meta";
    meta.innerHTML = (b.secret ? LOCK_SVG : "") + (b.count != null ? `<span>${Number(b.count)}</span>` : "");
    row.append(thumb, name, meta);
    row.addEventListener("click", async () => {
      list.querySelectorAll(".pn-board").forEach((r) => r.classList.toggle("on", r === row));
      applyPins(await window.api.pinterestChoose({ id: b.id, name: b.name }));
    });
    return row;
  }));
}

async function initPinterest() {
  $("pnBadge").innerHTML = icon("pin");
  // 在管理程式改了 Pinterest 設定 → 重新讀
  window.api.onPinsChanged?.(async () => applyPins(await window.api.getPins()));
  $("pnGear").innerHTML = icon("swap");
  const status = await window.api.pinterestStatus();
  $("pnAppId").value = status.clientId;
  $("pnRedirect").textContent = status.redirectUri;

  applyPins(await window.api.getPins());
  setInterval(async () => {
    if (!pnCard.classList.contains("setup")) applyPins(await window.api.getPins());
  }, 30 * 60 * 1000);

  document.querySelectorAll("[data-go]").forEach((b) =>
    b.addEventListener("click", async () => {
      // 打包時就有 Pinterest App 資料 → 不用填表，直接到瀏覽器登入
      if (b.dataset.go === "login" && status.builtIn && b.closest('[data-view="choice"]')) {
        showView("wait");
        const res = await window.api.pinterestLogin("", "");
        if (res.ok) openBoards(); else showView("choice", res.error);
        return;
      }
      showView(b.dataset.go);
    }));

  // 公開網址
  $("pnRssForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector(".pn-btn");
    btn.disabled = true; btn.textContent = "讀取中…";
    const result = await window.api.setPinterest($("pnInput").value);
    btn.disabled = false; btn.textContent = "完成";
    if (result.needSetup) showView("rss", result.error);
    else applyPins(result);
  });

  // 官方 API 登入
  $("pnLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showView("wait");
    const res = await window.api.pinterestLogin($("pnAppId").value, $("pnSecret").value);
    $("pnSecret").value = "";
    if (res.ok) openBoards();
    else showView("login", res.error);
  });

  $("pnLogout").addEventListener("click", () => {
    window.api.pinterestLogout();
    clearPins();
    showView("choice");
  });

  $("pnGear").addEventListener("click", async () => {
    if (pnCard.classList.contains("setup") && hasPins) return hideSetup();
    const st = await window.api.pinterestStatus();
    if (st.loggedIn) openBoards();
    else showView("choice");
  });
}
if (kind === "pinterest") initPinterest();
