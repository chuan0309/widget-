const params = new URLSearchParams(location.search);
const kind = params.get("kind") || "clock";
document.body.className = `glass-${params.get("glass") || "acrylic"}`;
document.querySelector(`[data-kind="${kind}"]`).hidden = false;

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
const SUN = '<circle cx="20" cy="20" r="8" fill="#ffc93b" style="filter:drop-shadow(0 0 6px #ffc93b)"/>';
const CLOUD = (x = 0, y = 0, o = 0.95) =>
  `<path transform="translate(${x} ${y})" fill="rgba(255,255,255,${o})" d="M12 32h18a7 7 0 0 0 0-14 9 9 0 0 0-17 3 5.5 5.5 0 0 0-1 11z"/>`;
const DROPS = '<path stroke="#64d2ff" stroke-width="2.4" stroke-linecap="round" d="M14 35l-2 4M21 35l-2 4M28 35l-2 4"/>';
const FLAKES = '<g fill="#fff"><circle cx="13" cy="37" r="1.8"/><circle cx="21" cy="38" r="1.8"/><circle cx="29" cy="37" r="1.8"/></g>';
const BOLT = '<path fill="#ffd60a" d="M21 31l-5 8h4l-2 6 7-9h-4l2-5z"/>';

function weatherLook(code) {
  if (code === 0) return ["晴天", SUN];
  if (code <= 2) return ["晴時多雲", SUN.replace('cx="20" cy="20"', 'cx="15" cy="14"') + CLOUD(4, 2)];
  if (code === 3) return ["陰天", CLOUD(0, -4)];
  if (code <= 48) return ["起霧", CLOUD(0, -6, 0.6) + '<path stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7" d="M8 34h24M12 39h20"/>'];
  if (code <= 67 || (code >= 80 && code <= 82)) return ["下雨", CLOUD(0, -8) + DROPS];
  if (code <= 77 || code === 85 || code === 86) return ["下雪", CLOUD(0, -8) + FLAKES];
  return ["雷雨", CLOUD(0, -8) + BOLT];
}

async function loadWeather() {
  const { city } = await window.api.getState();
  $("wtCity").textContent = city.name;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1";
    const data = await (await fetch(url)).json();
    const [desc, icon] = weatherLook(data.current.weather_code);
    $("wtTemp").textContent = `${Math.round(data.current.temperature_2m)}°`;
    $("wtDesc").textContent = desc;
    $("wtIcon").innerHTML = `<svg viewBox="0 0 40 46">${icon}</svg>`;
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
const PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3zM12 14v7"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

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
