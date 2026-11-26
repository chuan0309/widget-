const params = new URLSearchParams(location.search);
const kind = params.get("kind") || "clock";
document.body.className = `glass-${params.get("glass") || "acrylic"}`;
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

/* ───────── 時鐘 ───────── */
const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
function tick() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  $("hHand").style.transform = `rotate(${(h % 12) * 30 + m * 0.5}deg)`;
  $("mHand").style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
  $("sHand").style.transform = `rotate(${s * 6}deg)`;
  $("dateWeek").textContent = WEEK[now.getDay()];
  $("dateDay").textContent = now.getDate();
}
if (kind === "clock") { tick(); setInterval(tick, 1000); }

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

async function loadWeather() {
  const { city } = await window.api.getState();
  $("wtCity").textContent = city.name;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1";
    const data = await (await fetch(url)).json();
    const [desc, iconName, color] = weatherLook(data.current.weather_code);
    $("wtTemp").textContent = `${Math.round(data.current.temperature_2m)}°`;
    $("wtDesc").textContent = desc;
    $("wtIcon").innerHTML = icon(iconName);
    $("wtIcon").style.color = color;
    $("wtRange").textContent =
      `高 ${Math.round(data.daily.temperature_2m_max[0])}° 低 ${Math.round(data.daily.temperature_2m_min[0])}°`;
  } catch {
    $("wtDesc").textContent = "沒有網路";
  }
}
if (kind === "weather") { loadWeather(); setInterval(loadWeather, 20 * 60 * 1000); }

/* ───────── 電量 ───────── */
let pcBattery = null; // { level, charging, isDesktop }
let btDevices = [];

function ringHTML(percent, iconType, label, sub, extraClass = "") {
  const state = percent == null ? "unknown" : percent <= 20 ? "low" : "";
  return `
    <div class="batt-item ${extraClass}">
      <div class="ring ${state}" style="--p:${percent ?? 100}">${deviceIcon(iconType)}</div>
      <span>${label}</span>
      ${sub ? `<small>${sub}</small>` : ""}
    </div>`;
}

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 一頁放 4 個，超過就自動翻頁
const PER_PAGE = 4;
let battPage = 0;
let battTimer = null;

function batteryItems() {
  const items = [];
  if (pcBattery) {
    const pct = Math.round(pcBattery.level * 100);
    items.push(pcBattery.isDesktop
      ? ringHTML(100, "pc", "插電中", "這台電腦")
      : ringHTML(pct, "laptop", `${pct}%`, pcBattery.charging ? "充電中" : "這台電腦"));
  }
  const connected = btDevices
    .filter((d) => d.connected)
    // 有電量的排前面，電量低的最前面
    .sort((a, b) => (a.battery ?? 101) - (b.battery ?? 101));
  for (const d of connected) {
    const label = d.battery != null ? `${d.battery}%` : "已連線";
    items.push(ringHTML(d.battery, deviceType(d.name, d.cod), label, escapeHTML(d.name)));
  }
  if (connected.length === 0) items.push(ringHTML(0, "other", "—", "沒有藍牙裝置", "placeholder"));
  return items;
}

function renderBattery() {
  const items = batteryItems();
  const pages = Math.ceil(items.length / PER_PAGE);
  if (battPage >= pages) battPage = 0;
  $("battRow").innerHTML = items.slice(battPage * PER_PAGE, (battPage + 1) * PER_PAGE).join("");
  $("battDots").innerHTML = pages > 1
    ? Array.from({ length: pages }, (_, i) => `<i class="${i === battPage ? "on" : ""}"></i>`).join("")
    : "";

  clearInterval(battTimer);
  if (pages > 1) {
    battTimer = setInterval(() => {
      if (document.querySelector(".battery:hover")) return; // 滑鼠在上面就不要翻
      battPage = (battPage + 1) % pages;
      renderBattery();
    }, 6000);
  }
}

async function initBattery() {
  if (navigator.getBattery) {
    const b = await navigator.getBattery();
    const read = () => {
      // 桌機沒有電池時，Chromium 會回報「100%、充電中、0 秒充飽」
      const isDesktop = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;
      pcBattery = { level: b.level, charging: b.charging, isDesktop };
      renderBattery();
    };
    read();
    b.addEventListener("levelchange", read);
    b.addEventListener("chargingchange", read);
  }
  const state = await window.api.getState();
  btDevices = state.devices;
  renderBattery();
  window.api.onDevices((list) => { btDevices = list; renderBattery(); });
}
if (kind === "battery") initBattery();

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

function renderPins({ title, pins }) {
  $("pnTitle").textContent = title || "Pinterest";
  const cols = [[], []];
  pins.forEach((p, i) => cols[i % 2].push(p));
  [$("pnColA"), $("pnColB")].forEach((col, i) => {
    col.replaceChildren();
    // 同一組放兩次，捲到一半時剛好接回開頭，看起來就是無限捲動
    for (let round = 0; round < 2; round++) cols[i].forEach((p) => col.append(pinElement(p)));
    col.style.setProperty("--dur", `${Math.max(20, cols[i].length * (i ? 9 : 7))}s`);
  });
  hasPins = true;
}

function clearPins() {
  $("pnColA").replaceChildren();
  $("pnColB").replaceChildren();
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
    b.addEventListener("click", () => showView(b.dataset.go)));

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
