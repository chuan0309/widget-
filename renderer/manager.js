const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get("mica") === "1") document.body.classList.add("mica");

// 把 data-icon="xxx" 換成真的圖示
function fillIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
    el.removeAttribute("data-icon");
  });
}
fillIcons();

let state = null;
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2200);
}

async function save(patch, message) {
  state = await window.api.mgrSet(patch);
  render();
  if (message) toast(message);
}

/* ───────── 左邊選單切換 ───────── */
function go(section) {
  if (!document.querySelector(`section[data-section="${section}"]`)) section = "widgets";
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.go === section));
  document.querySelectorAll("section").forEach((s) => s.classList.toggle("on", s.dataset.section === section));
  if (section === "pinterest") loadPinterest();
  if (section === "calendar") { renderCalendars(); loadGoogle(); }
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
window.api.onGoto((section) => go(section));

/* ───────── 小組件 ───────── */
const WIDGET_INFO = [
  { kind: "clock", name: "時鐘", icon: "schedule" },
  { kind: "weather", name: "天氣", icon: "partly_cloudy" },
  { kind: "battery", name: "電量", icon: "buds" },
  { kind: "calendar", name: "Google 日曆", icon: "calendar" },
  { kind: "pinterest", name: "Pinterest", icon: "pin" },
];
const SIZE_NAMES = { s: "小", m: "中", l: "大" };

function renderWidgets() {
  $("widgetGrid").replaceChildren(...WIDGET_INFO.map((w) => {
    const on = !!state.settings.widgets[w.kind];
    const cur = state.settings.sizes?.[w.kind] || "s";
    const card = document.createElement("div");
    card.className = "w-card" + (on ? " on" : "");
    card.innerHTML = `
      <span class="w-preview">${icon(w.icon)}</span>
      <label class="w-foot">
        <span class="row-text"><b>${w.name}</b><small>${on ? "在桌面上" : "沒有顯示"}</small></span>
        <input type="checkbox" class="switch" ${on ? "checked" : ""} />
      </label>
      <span class="seg">${["s", "m", "l"].map((z) => `<button data-size="${z}" class="${z === cur ? "on" : ""}">${SIZE_NAMES[z]}</button>`).join("")}</span>`;
    card.querySelector("input").addEventListener("change", (e) =>
      save({ widgets: { [w.kind]: e.target.checked } }, e.target.checked ? `已加入${w.name}` : `已移除${w.name}`));
    card.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () =>
      save({ sizes: { [w.kind]: b.dataset.size } }, `${w.name}改成${SIZE_NAMES[b.dataset.size]}尺寸`)));
    return card;
  }));
}
$("showWidgets").addEventListener("click", () => { window.api.mgrShowWidgets(); toast("小組件回來了"); });
$("resetPos").addEventListener("click", () => { window.api.mgrResetPositions(); toast("已放回右上角"); });

/* ───────── 外觀 ───────── */
function renderLook() {
  $("tint").value = state.settings.tint ?? 30;
  showTint($("tint").value);
  // 透明程度滑桿：拖的時候即時預覽（不存檔），放開時才存
function showTint(v) { $("tintPreview").style.setProperty("--t", String(v / 100)); }
$("tint").addEventListener("input", (e) => { showTint(e.target.value); window.api.previewTint(Number(e.target.value)); });
$("tint").addEventListener("change", (e) => save({ tint: Number(e.target.value) }));

document.querySelectorAll(".look-card").forEach((c) => c.classList.toggle("on", c.dataset.glass === state.settings.glass));
  const acrylic = document.querySelector('.look-card[data-glass="acrylic"]');
  if (!state.isWin11) {
    acrylic.disabled = true;
    acrylic.querySelector("small").textContent = "需要 Windows 11（22H2 以上）。";
  }
}
// 透明程度滑桿：拖的時候即時預覽（不存檔），放開時才存
function showTint(v) { $("tintPreview").style.setProperty("--t", String(v / 100)); }
$("tint").addEventListener("input", (e) => { showTint(e.target.value); window.api.previewTint(Number(e.target.value)); });
$("tint").addEventListener("change", (e) => save({ tint: Number(e.target.value) }));

document.querySelectorAll(".look-card").forEach((c) =>
  c.addEventListener("click", () => save({ glass: c.dataset.glass }, "已套用")));

/* ───────── 藍牙 ───────── */
function renderBluetooth() {
  const bt = state.settings.bluetooth;
  $("btConnect").checked = bt.notifyConnect;
  $("btLow").checked = bt.notifyLow;
  $("btThreshold").value = bt.lowThreshold;
  $("btThresholdOut").textContent = `${bt.lowThreshold}%`;
  renderDevices();
}

function renderDevices() {
  const list = [...state.devices].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  if (list.length === 0) {
    $("deviceList").innerHTML = `<div class="row"><span class="row-text"><b>還沒有偵測到藍牙裝置</b>
      <small>先在 Windows 的「設定 → 藍牙與裝置」配對，這裡就會出現</small></span></div>`;
    return;
  }
  const muted = state.settings.bluetooth.muted;
  $("deviceList").replaceChildren(...list.map((d) => {
    const row = document.createElement("label");
    row.className = "row";
    const status = d.connected
      ? `已連線${d.battery != null ? `・電量 ${d.battery}%` : ""}`
      : "未連線";
    row.innerHTML = `
      <span class="row-icon ${d.connected ? "blue" : ""}">${deviceIcon(deviceType(d.name, d.cod))}</span>
      <span class="row-text"><b>${escapeHTML(d.name)}</b><small>${status}</small></span>
      <input type="checkbox" class="switch" ${muted[d.id] ? "" : "checked"} title="這台裝置的通知" />`;
    row.querySelector("input").addEventListener("change", (e) =>
      save({ bluetooth: { mute: { [d.id]: !e.target.checked } } }, e.target.checked ? "會通知" : "不會再通知這台"));
    return row;
  }));
}

$("btConnect").addEventListener("change", (e) => save({ bluetooth: { notifyConnect: e.target.checked } }));
$("btLow").addEventListener("change", (e) => save({ bluetooth: { notifyLow: e.target.checked } }));
$("btThreshold").addEventListener("input", (e) => ($("btThresholdOut").textContent = `${e.target.value}%`));
$("btThreshold").addEventListener("change", (e) => save({ bluetooth: { lowThreshold: Number(e.target.value) } }, "已儲存"));
$("btTest").addEventListener("click", () => window.api.mgrTestPopup());
window.api.onDevices((list) => { if (state) { state.devices = list; renderDevices(); } });

/* ───────── Pinterest ───────── */
async function loadPinterest() {
  const st = await window.api.pinterestStatus();
  $("pnRedirect").textContent = st.redirectUri;
  if (st.clientId && !$("pnAppId").value) $("pnAppId").value = st.clientId;
  const pins = await window.api.getPins();

  let html;
  if (st.loggedIn) {
    html = `<div class="row">
        <span class="row-icon blue">${icon("check_circle")}</span>
        <span class="row-text"><b>已登入 ${st.username ? "@" + escapeHTML(st.username) : "Pinterest"}</b>
          <small>${st.source ? "顯示中：" + escapeHTML(st.source.name) : "還沒選圖版"}</small></span>
        <button class="btn small ghost" id="pnLogout">${icon("logout")}登出</button>
      </div>`;
  } else if (pins.pins || pins.title) {
    html = `<div class="row">
        <span class="row-icon">${icon("link")}</span>
        <span class="row-text"><b>使用公開網址</b><small>${escapeHTML(pins.title || "")}</small></span>
      </div>`;
  } else {
    html = `<div class="row"><span class="row-icon">${icon("pin")}</span>
      <span class="row-text"><b>還沒設定</b><small>登入帳號，或貼一個公開的 Pinterest 網址</small></span></div>`;
  }
  $("pnStatus").innerHTML = html;
  $("pnLogout")?.addEventListener("click", () => {
    window.api.pinterestLogout();
    window.api.mgrPinsChanged();
    toast("已登出");
    loadPinterest();
  });

  // 打包時就有 Pinterest App 資料 → 只顯示「使用 Pinterest 帳號登入」按鈕
  $("pnQuick").hidden = st.loggedIn || !st.builtIn;
  $("pnLoginWrap").hidden = st.loggedIn || st.builtIn;
  $("pnBoardsWrap").hidden = !st.loggedIn;
  if (st.loggedIn) loadBoards(st.source?.id);
}

async function loadBoards(currentId) {
  $("pnBoards").innerHTML = `<div class="row"><span class="row-text"><small>讀取中…</small></span></div>`;
  const res = await window.api.pinterestBoards();
  if (res.error) {
    $("pnBoards").innerHTML = `<div class="row"><span class="row-text"><b class="err">${escapeHTML(res.error)}</b></span></div>`;
    return;
  }
  const items = [{ id: "all", name: "我存的所有 pin", cover: "" }, ...res.boards];
  $("pnBoards").replaceChildren(...items.map((b) => {
    const row = document.createElement("div");
    row.className = "row clickable" + (b.id === currentId ? " on" : "");
    const thumb = b.cover
      ? `<span class="row-icon thumb" style="background-image:url('${encodeURI(b.cover)}')"></span>`
      : `<span class="row-icon">${icon("pin")}</span>`;
    row.innerHTML = `${thumb}
      <span class="row-text"><b>${escapeHTML(b.name)}</b>
        <small>${b.secret ? "私密圖版・" : ""}${b.count != null ? Number(b.count) + " 個 pin" : ""}</small></span>
      ${b.id === currentId ? `<span class="check">${icon("check_circle")}</span>` : ""}`;
    row.addEventListener("click", async () => {
      await window.api.pinterestChoose({ id: b.id, name: b.name });
      window.api.mgrPinsChanged();
      toast(`改成顯示「${b.name}」`);
      loadPinterest();
    });
    return row;
  }));
}

$("pnQuickLogin").addEventListener("click", async () => {
  $("pnQuickLogin").disabled = true;
  $("pnQuickErr").classList.remove("err");
  $("pnQuickErr").textContent = "請在瀏覽器按「允許」，完成後會自動回到這裡…";
  const res = await window.api.pinterestLogin("", "");
  $("pnQuickLogin").disabled = false;
  if (res.ok) { window.api.mgrPinsChanged(); toast("登入成功！選一個圖版吧"); loadPinterest(); }
  else { $("pnQuickErr").textContent = res.error; $("pnQuickErr").classList.add("err"); }
});
$("pnCopy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("pnRedirect").textContent); toast("已複製"); }
  catch { toast("複製失敗，請手動選取"); }
});
$("pnLogin").addEventListener("click", async () => {
  $("pnLoginErr").textContent = "";
  $("pnLogin").disabled = true;
  $("pnLoginMsg").textContent = "請在瀏覽器按「允許」，完成後會自動回到這裡…";
  const res = await window.api.pinterestLogin($("pnAppId").value, $("pnSecret").value);
  $("pnLogin").disabled = false;
  $("pnSecret").value = "";
  $("pnLoginMsg").textContent = "按下後會打開瀏覽器，按「允許」就完成";
  if (res.ok) { window.api.mgrPinsChanged(); toast("登入成功！選一個圖版吧"); loadPinterest(); }
  else $("pnLoginErr").textContent = res.error;
});
$("pnUrlSave").addEventListener("click", async () => {
  $("pnUrlErr").textContent = "";
  $("pnUrlSave").disabled = true;
  const res = await window.api.setPinterest($("pnUrl").value);
  $("pnUrlSave").disabled = false;
  if (res.needSetup || res.error) { $("pnUrlErr").textContent = res.error || "網址不對"; return; }
  window.api.mgrPinsChanged();
  toast("已套用");
  loadPinterest();
});

/* ───────── Google 日曆：登入帳號 ───────── */
async function loadGoogle() {
  const st = await window.api.googleStatus();
  const box = $("gAccount");
  $("gCalsWrap").hidden = true;

  if (!st.configured) {
    box.innerHTML = `<div class="row"><span class="row-icon">${icon("calendar")}</span>
      <span class="row-text"><b>這個版本還不能用 Google 帳號登入</b>
      <small>開發者還沒設定 Google 登入（README 裡有步驟）。現在可以先用下面「進階」的 iCal 網址。</small></span></div>`;
    $("calAdv").open = true;
    return;
  }
  if (!st.loggedIn) {
    box.innerHTML = `<div class="row signin-big">
      <span class="row-text"><b>登入後會自動列出你所有的日曆</b>
        <small id="gMsg">會打開瀏覽器，選你的 Google 帳號、按「允許」就完成。只會讀取行程，不會修改。</small></span>
      <button class="btn signin google" id="gLogin"><span class="g">G</span>使用 Google 帳號登入</button></div>`;
    $("gLogin").addEventListener("click", async () => {
      $("gLogin").disabled = true;
      $("gMsg").textContent = "請在瀏覽器登入並按「允許」，完成後會自動回到這裡…";
      const r = await window.api.googleLogin();
      if (r.ok) { toast("登入成功"); loadGoogle(); }
      else { $("gLogin").disabled = false; $("gMsg").textContent = r.error; $("gMsg").classList.add("err"); }
    });
    return;
  }

  box.innerHTML = `<div class="row">
      <span class="row-icon blue">${icon("check_circle")}</span>
      <span class="row-text"><b>已登入 Google</b><small>${escapeHTML(st.email)}</small></span>
      <button class="btn small ghost" id="gLogout">${icon("logout")}登出</button></div>`;
  $("gLogout").addEventListener("click", async () => {
    await window.api.googleLogout();
    toast("已登出 Google");
    loadGoogle();
  });

  $("gCalsWrap").hidden = false;
  $("gCals").innerHTML = `<div class="row"><span class="row-text"><small>讀取中…</small></span></div>`;
  const res = await window.api.googleCalendars();
  if (res.error) {
    $("gCals").innerHTML = `<div class="row"><span class="row-text"><b class="err">${escapeHTML(res.error)}</b></span></div>`;
    return;
  }
  $("gCals").replaceChildren(...res.calendars.map((c) => {
    const row = document.createElement("label");
    row.className = "row";
    row.innerHTML = `<span class="dot" style="background:${c.color}"></span>
      <span class="row-text"><b>${escapeHTML(c.name)}</b>${c.primary ? "<small>主要日曆</small>" : ""}</span>
      <input type="checkbox" class="switch" ${c.on ? "checked" : ""} />`;
    row.querySelector("input").addEventListener("change", async (e) => {
      await window.api.googleChoose(c.id, e.target.checked);
      toast(e.target.checked ? `會顯示「${c.name}」` : `不顯示「${c.name}」`);
    });
    return row;
  }));
}

/* ───────── Google 日曆：進階（iCal 網址） ───────── */
function renderCalendars() {
  const list = state.calendars || [];
  if (list.length === 0) {
    $("calList").innerHTML = `<div class="row"><span class="row-icon">${icon("calendar")}</span>
      <span class="row-text"><b>沒有用 iCal 網址加入的行事曆</b><small>登入 Google 帳號的話不需要這個</small></span></div>`;
    return;
  }
  $("calList").replaceChildren(...list.map((c, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="dot" style="background:${c.color}"></span>
      <span class="row-text"><b>${escapeHTML(c.name)}</b></span>
      <button class="btn small ghost">${icon("delete")}移除</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      await window.api.calRemove(i);
      state = await window.api.mgrGet();
      renderCalendars();
      toast("已移除");
    });
    return row;
  }));
}
$("calAdd").addEventListener("click", async () => {
  $("calErr").textContent = "";
  $("calAdd").disabled = true;
  $("calAdd").textContent = "讀取中…";
  const res = await window.api.calAdd($("calUrl").value);
  $("calAdd").disabled = false;
  $("calAdd").textContent = "加入";
  if (res.error) { $("calErr").textContent = res.error; return; }
  $("calUrl").value = "";
  state = await window.api.mgrGet();
  renderCalendars();
  toast(`已加入「${res.name || "行事曆"}」`);
});
$("calOpenGoogle").addEventListener("click", () => window.api.mgrOpenUrl("https://calendar.google.com/calendar/r/settings"));

/* ───────── 天氣 ───────── */
function renderCity() {
  const c = state.settings.city;
  $("cityName").textContent = c.name;
  $("cityCoord").textContent = `緯度 ${c.lat.toFixed(2)}・經度 ${c.lon.toFixed(2)}`;
}

$("citySearch").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("cityInput").value.trim();
  if (!q) return;
  const box = $("cityResults");
  box.hidden = false;
  box.innerHTML = `<div class="row"><span class="row-text"><small>搜尋中…</small></span></div>`;
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=zh&format=json`;
    const data = await (await fetch(url)).json();
    const results = data.results || [];
    if (results.length === 0) {
      box.innerHTML = `<div class="row"><span class="row-text"><b>找不到「${escapeHTML(q)}」</b><small>換個寫法試試，例如英文名稱</small></span></div>`;
      return;
    }
    box.replaceChildren(...results.map((r) => {
      const row = document.createElement("div");
      row.className = "row clickable";
      const where = [r.admin1, r.country].filter(Boolean).join("・");
      row.innerHTML = `<span class="row-icon">${icon("location_on")}</span>
        <span class="row-text"><b>${escapeHTML(r.name)}</b><small>${escapeHTML(where)}</small></span>`;
      row.addEventListener("click", async () => {
        await save({ city: { name: r.name, lat: r.latitude, lon: r.longitude } }, `天氣改成 ${r.name}`);
        box.hidden = true;
        $("cityInput").value = "";
      });
      return row;
    }));
  } catch {
    box.innerHTML = `<div class="row"><span class="row-text"><b class="err">連不到網路</b></span></div>`;
  }
});

/* ───────── 一般 ───────── */
function renderGeneral() {
  $("autostart").checked = state.autostart;
  $("dataFolder").textContent = state.dataFolder;
  $("version").textContent = state.version;
}
$("autostart").addEventListener("change", (e) =>
  save({ autostart: e.target.checked }, e.target.checked ? "開機時會自動啟動" : "已關閉自動啟動"));
$("openFolder").addEventListener("click", () => window.api.mgrOpenFolder());
$("quitApp").addEventListener("click", () => window.api.mgrQuit());

/* 更新 */
function renderUpdate(u) {
  const msg = $("updateMsg"), btn = $("updateBtn");
  btn.disabled = false;
  btn.className = "btn small ghost";
  btn.textContent = "檢查更新";
  if (!u.packaged) { msg.textContent = "開發模式不會自動更新"; btn.disabled = true; return; }
  switch (u.state) {
    case "checking": msg.textContent = "檢查中…"; btn.disabled = true; break;
    case "latest": msg.textContent = "已經是最新版"; break;
    case "downloading": msg.textContent = `正在下載新版 ${u.version}…${u.progress ? u.progress + "%" : ""}`; btn.disabled = true; break;
    case "ready":
      msg.textContent = `新版 ${u.version} 下載好了，關掉程式時會自動裝好`;
      btn.className = "btn small";
      btn.textContent = "立即重新啟動並更新";
      break;
    case "error": msg.textContent = "檢查更新失敗：" + u.error; break;
    default: msg.textContent = "會自動檢查更新（每 6 小時）";
  }
}
$("updateBtn").addEventListener("click", async () => {
  const u = await window.api.updateGet();
  if (u.state === "ready") window.api.updateInstall();
  else window.api.updateCheck();
});
window.api.onUpdate?.((u) => window.api.updateGet().then(renderUpdate));
window.api.updateGet?.().then(renderUpdate);

/* ───────── 開始 ───────── */
function render() {
  renderWidgets();
  renderLook();
  renderBluetooth();
  renderCity();
  renderGeneral();
  renderCalendars();
}
// 從小組件右鍵改了大小、或日曆更新時，重新讀一次
window.api.onMgrRefresh?.(async () => { state = await window.api.mgrGet(); render(); });

(async () => {
  state = await window.api.mgrGet();
  render();
  go(params.get("section") || "widgets");
})();
