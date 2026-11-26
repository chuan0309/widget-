const $ = (id) => document.getElementById(id);

/* ───────── 時鐘 ───────── */
const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
function tick() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  $("hHand").style.transform = `rotate(${(h % 12) * 30 + m * 0.5}deg)`;
  $("mHand").style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
  $("sHand").style.transform = `rotate(${s * 6}deg)`;
  $("sbTime").textContent = `${h}:${String(m).padStart(2, "0")}`;
  $("dateWeek").textContent = WEEK[now.getDay()];
  $("dateDay").textContent = now.getDate();
}
tick();
setInterval(tick, 1000);

/* ───────── 手機大小自動縮放（小螢幕也看得完整）───────── */
function fit() {
  const s = Math.min(1, (window.innerHeight - 32) / 844, (window.innerWidth - 32) / 390);
  $("phone").style.zoom = s;
}
fit();
window.addEventListener("resize", fit);

/* ───────── 藍牙彈窗 ───────── */
const sheet = $("sheet");
const backdrop = $("backdrop");
const btn = $("connectBtn");
const device = { name: "Aero Buds Pro", left: 85, right: 90, case: 62 };
let connected = false;

function openSheet() {
  sheet.classList.toggle("connected", connected);
  $("sheetSub").textContent = connected ? "已連線" : "偵測到新的藍牙耳機";
  btn.querySelector(".btn-label").textContent = connected ? "完成" : "連線";
  sheet.classList.add("show");
  backdrop.classList.add("show");
  navigator.vibrate?.(20);
}
function closeSheet() {
  sheet.classList.remove("show");
  backdrop.classList.remove("show");
}

btn.addEventListener("click", () => {
  if (connected) return closeSheet();
  btn.classList.add("loading");
  // 假裝在配對，1.6 秒後成功
  setTimeout(() => {
    btn.classList.remove("loading");
    connected = true;
    sheet.classList.add("connected");
    $("sheetSub").textContent = "已連線";
    btn.querySelector(".btn-label").textContent = "完成";
    updateWidget();
    showIsland(`${device.name}`, `${Math.min(device.left, device.right)}%`);
    $("sbBt").classList.add("on");
    setTimeout(closeSheet, 1800);
  }, 1600);
});

$("sheetClose").addEventListener("click", closeSheet);
backdrop.addEventListener("click", closeSheet);

/* 把耳機電量塞進桌面的電量 widget */
function updateWidget() {
  const map = { left: device.left, right: device.right, case: device.case };
  document.querySelectorAll(".ring-item").forEach((el) => {
    const key = el.dataset.dev;
    if (!(key in map)) return;
    const v = connected ? map[key] : 0;
    el.classList.toggle("empty", !connected);
    el.querySelector(".ring").style.setProperty("--p", v);
    el.querySelector("span").textContent = connected ? `${v}%` : "—";
  });
}

/* 動態島展開一下再收回 */
let islandTimer;
function showIsland(text, batt) {
  $("islandText").textContent = text;
  $("islandBatt").textContent = batt;
  const island = $("island");
  island.classList.add("expand");
  clearTimeout(islandTimer);
  islandTimer = setTimeout(() => island.classList.remove("expand"), 3000);
}

function disconnect() {
  connected = false;
  closeSheet();
  updateWidget();
  $("sbBt").classList.remove("on");
  showIsland("已中斷連線", "");
}

/* ───────── 換桌布 ───────── */
let theme = 0;
function nextWallpaper() {
  theme = (theme + 1) % 4;
  $("wallpaper").dataset.theme = theme;
}

/* ───────── 音樂 widget 播放/暫停 ───────── */
let playing = false, prog = 0, progTimer;
$("muPlay").addEventListener("click", () => {
  playing = !playing;
  document.querySelector(".music-widget").classList.toggle("playing", playing);
  $("muIcon").innerHTML = playing
    ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  clearInterval(progTimer);
  if (playing) progTimer = setInterval(() => {
    prog = (prog + 0.5) % 100;
    $("muProg").style.width = prog + "%";
  }, 200);
});

/* ───────── 按鈕綁定 ───────── */
document.querySelector('[data-app="bt"]').addEventListener("click", openSheet);
document.querySelector('[data-app="wall"]').addEventListener("click", nextWallpaper);
$("triggerBtn").addEventListener("click", openSheet);
$("resetBtn").addEventListener("click", disconnect);
$("wallBtn").addEventListener("click", nextWallpaper);

// 一打開頁面 1.2 秒後自動跳一次，像耳機剛靠近手機
setTimeout(openSheet, 1200);
