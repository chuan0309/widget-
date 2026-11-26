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
  if (section === "audio") loadAudio();
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
window.api.onGoto((section) => go(section));

/* ───────── 小組件 ───────── */
const WIDGET_INFO = [
  { kind: "clock", name: "時鐘", icon: "schedule" },
  { kind: "weather", name: "天氣", icon: "partly_cloudy" },
  { kind: "aqi", name: "空氣品質", icon: "foggy" },
  { kind: "battery", name: "電量", icon: "buds" },
  { kind: "audio", name: "音訊輸出", icon: "speaker" },
  { kind: "calendar", name: "Google 日曆", icon: "calendar" },
  { kind: "pinterest", name: "Pinterest", icon: "pin" },
];
const SIZE_NAMES = { s: "小", m: "中", l: "大" };

function renderWidgets() {
  renderStacks();
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
/* 疊放 */
function saveStacks(stacks, msg) { return save({ stacks }, msg); }
function renderStacks() {
  const stacks = (state.settings.stacks || []).map((st) => ({ ...st, items: [...st.items] }));
  const box = $("stackList");
  if (stacks.length === 0) {
    box.innerHTML = `<div class="group"><div class="row"><span class="row-icon">${icon("widgets")}</span>
      <span class="row-text"><b>還沒有疊放</b><small>例如把時鐘、天氣、日曆疊在同一格，省空間</small></span></div></div>`;
    return;
  }
  box.replaceChildren(...stacks.map((st, si) => {
    const el = document.createElement("div");
    el.className = "group stack-card";
    const info = (k) => WIDGET_INFO.find((w) => w.kind === k);
    const missing = WIDGET_INFO.filter((w) => !st.items.includes(w.kind));
    el.innerHTML = `
      <div class="stack-top">
        <b>疊放 ${si + 1}</b>
        <span class="seg">${["s", "m", "l"].map((z) => `<button data-size="${z}" class="${z === st.size ? "on" : ""}">${SIZE_NAMES[z]}</button>`).join("")}</span>
        <button class="btn small ghost" data-del>${icon("delete")}移除疊放</button>
      </div>
      <div class="stack-items">${st.items.map((k, i) => `
        <div class="stack-item">
          <span class="row-icon">${icon(info(k).icon)}</span><span class="name">${info(k).name}</span>
          <span class="move"><button data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button><button data-down="${i}" ${i === st.items.length - 1 ? "disabled" : ""}>↓</button><button data-rm="${i}" title="從疊放拿掉">✕</button></span>
        </div>`).join("")}</div>
      <div class="stack-bottom">
        ${missing.length ? `<select data-add><option value="">＋ 加入小組件…</option>${missing.map((w) => `<option value="${w.kind}">${w.name}</option>`).join("")}</select>` : ""}
        <label>自動輪播<input type="checkbox" class="switch" data-rotate ${st.rotate ? "checked" : ""} /></label>
      </div>`;
    const commit = (msg) => saveStacks(stacks, msg);
    el.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => { st.size = b.dataset.size; commit(`疊放改成${SIZE_NAMES[st.size]}尺寸`); }));
    el.querySelector("[data-del]").addEventListener("click", () => { stacks.splice(si, 1); commit("已移除疊放"); });
    el.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.up; [st.items[i - 1], st.items[i]] = [st.items[i], st.items[i - 1]]; commit(); }));
    el.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.down; [st.items[i + 1], st.items[i]] = [st.items[i], st.items[i + 1]]; commit(); }));
    el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      st.items.splice(+b.dataset.rm, 1);
      if (st.items.length === 0) stacks.splice(si, 1);
      commit("已拿掉");
    }));
    el.querySelector("[data-add]")?.addEventListener("change", (e) => { if (e.target.value) { st.items.push(e.target.value); commit("已加入疊放"); } });
    el.querySelector("[data-rotate]").addEventListener("change", (e) => { st.rotate = e.target.checked; commit(e.target.checked ? "每 20 秒自動換下一個" : "不自動輪播"); });
    return el;
  }));
}
$("addStack").addEventListener("click", () => {
  const stacks = [...(state.settings.stacks || []), { id: Date.now().toString(36), items: ["clock", "weather", "calendar"], size: "s", rotate: false }];
  saveStacks(stacks, "已新增疊放（時鐘、天氣、日曆），可以再改");
});

$("showWidgets").addEventListener("click", () => { window.api.mgrShowWidgets(); toast("小組件回來了"); });
$("resetPos").addEventListener("click", () => { window.api.mgrResetPositions(); toast("已放回右上角"); });

/* ───────── 外觀 ───────── */
function renderLook() {
  $("tint").value = state.settings.tint ?? 30;
  showTint($("tint").value);
  const bg = state.settings.background || "glass";
  document.querySelectorAll(".bg-card[data-bg]").forEach((c) => c.classList.toggle("on", c.dataset.bg === bg));
  $("tintBlock").hidden = bg !== "glass"; // 透明程度只有玻璃背景才有用
  showFont(fwOf(state.settings.fontWeight));
}
const fwOf = (v) => (v === "light" ? 400 : v === "bold" || v == null ? 600 : Number(v) || 600);
const FW_NAMES = { 300: "很細", 350: "細", 400: "細", 450: "標準", 500: "標準", 550: "中粗", 600: "粗", 650: "粗", 700: "很粗", 750: "很粗", 800: "最粗" };
function showFont(w) {
  $("fw").value = w;
  $("fwSample").style.setProperty("--fw", w);
  $("fwOut").textContent = `${FW_NAMES[w] || ""} ${w}`;
}
// 拖的時候小組件就跟著變（間隔一下，不要每一格都存檔）
let fwTimer = null;
$("fw").addEventListener("input", (e) => {
  const w = Number(e.target.value);
  showFont(w);
  state.settings.fontWeight = w;
  clearTimeout(fwTimer);
  fwTimer = setTimeout(() => window.api.mgrSet({ fontWeight: w }), 60);
});
$("fw").addEventListener("change", (e) => save({ fontWeight: Number(e.target.value) }, "已儲存"));
document.querySelectorAll(".bg-card[data-bg]").forEach((c) => c.addEventListener("click", () => {
  state.settings.background = c.dataset.bg;
  renderLook();
  save({ background: c.dataset.bg }, "已套用");
}));
// 透明程度滑桿：拖的時候即時預覽（不存檔），放開時才存
function showTint(v) { $("tintPreview").style.setProperty("--t", String(v / 100)); }
$("tint").addEventListener("input", (e) => { showTint(e.target.value); window.api.previewTint(Number(e.target.value)); });
$("tint").addEventListener("change", (e) => save({ tint: Number(e.target.value) }));

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
  renderBatteryList();
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

// 電量小組件：顯示哪些、順序
function renderBatteryList() {
  const prefs = state.settings.batteryWidget || { hidden: {}, order: [] };
  const known = [...state.devices];
  const order = (prefs.order || []).filter((id) => known.some((d) => d.id === id));
  for (const d of known.sort((a, b) => a.name.localeCompare(b.name))) if (!order.includes(d.id)) order.push(d.id);
  if (order.length === 0) {
    $("battList").innerHTML = `<div class="row"><span class="row-text"><small>還沒有偵測到裝置</small></span></div>`;
    return;
  }
  const move = (i, dir) => {
    const next = [...order];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    save({ batteryWidget: { order: next } });
  };
  $("battList").replaceChildren(...order.map((id, i) => {
    const d = known.find((x) => x.id === id);
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <span class="row-icon ${d.connected ? "blue" : ""}">${deviceIcon(deviceType(d.name, d.cod))}</span>
      <span class="row-text"><b>${escapeHTML(d.name)}</b><small>${d.connected ? (d.battery != null ? `電量 ${d.battery}%` : "已連線・讀不到電量") : "未連線"}</small></span>
      <span class="move"><button title="往上" ${i === 0 ? "disabled" : ""}>↑</button><button title="往下" ${i === order.length - 1 ? "disabled" : ""}>↓</button></span>
      <input type="checkbox" class="switch" title="顯示在電量小組件" ${prefs.hidden?.[id] ? "" : "checked"} />`;
    const [up, down] = row.querySelectorAll(".move button");
    up.addEventListener("click", () => move(i, -1));
    down.addEventListener("click", () => move(i, 1));
    row.querySelector("input").addEventListener("change", (e) =>
      save({ batteryWidget: { hide: { [id]: !e.target.checked } } }, e.target.checked ? "會顯示" : "不顯示在電量小組件"));
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

/* ───────── 音訊輸出 ───────── */
let audio = { outputs: [], auto: false, priority: [] };
// Windows 的名稱像「耳機 (INZONE Buds)」：外面是種類時，括號裡才是裝置名稱
const AU_GENERIC = /^(喇叭|揚聲器|耳機|耳麥|頭戴式耳機|speakers?|headphones?|headset( earphone)?|earphones?|digital audio|數位音訊|realtek.*)$/i;
const auSplit = (name) => {
  const m = String(name).match(/^(.*?)\s*\((.+)\)$/);
  if (!m) return { title: name, sub: "" };
  return AU_GENERIC.test(m[1].trim()) ? { title: m[2], sub: m[1] } : { title: m[1], sub: m[2] };
};
function auIcon(name) {
  const t = deviceType(name);
  if (t !== "other" && t !== "phone") return t;
  if (/monitor|display|hdmi|samsung|lg |dell|benq|asus|顯示器|螢幕/i.test(name)) return "pc";
  return "speaker";
}
async function loadAudio() {
  audio = await window.api.audioGet();
  renderAudio();
}
function renderAudio() {
  $("auAuto").checked = !!audio.auto;
  if (audio.outputs.length === 0) {
    $("auNow").innerHTML = `<div class="row"><span class="row-text"><b>沒有找到音訊輸出裝置</b><small>程式剛開的話等幾秒</small></span></div>`;
  } else {
    $("auNow").replaceChildren(...audio.outputs.map((o) => {
      const n = auSplit(o.name);
      const row = document.createElement("div");
      row.className = "row clickable" + (o.default ? " on" : "");
      row.innerHTML = `<span class="row-icon ${o.default ? "blue" : ""}">${icon(auIcon(o.name))}</span>
        <span class="row-text"><b>${escapeHTML(n.title)}</b><small>${escapeHTML(n.sub)}</small></span>
        ${o.default ? `<span class="check">${icon("check_circle")}</span>` : ""}`;
      row.addEventListener("click", async () => {
        if (await window.api.audioSet(o.id)) toast(`聲音改從「${n.title}」出來`);
      });
      return row;
    }));
  }
  const names = audio.priority.length ? audio.priority : audio.outputs.map((o) => o.name);
  const move = (i, dir) => {
    const next = [...names];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    audio.priority = next;
    renderAudio();
    window.api.mgrSet({ audio: { priority: next } });
  };
  $("auPriority").replaceChildren(...names.map((name, i) => {
    const n = auSplit(name);
    const here = audio.outputs.some((o) => o.name === name);
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="num" style="width:26px;text-align:center;font-weight:700;color:var(--ink-soft)">${i + 1}</span>
      <span class="row-icon">${icon(auIcon(name))}</span>
      <span class="row-text"><b>${escapeHTML(n.title)}</b><small>${here ? "現在接著" : "現在沒接"}${n.sub ? "・" + escapeHTML(n.sub) : ""}</small></span>
      <span class="move"><button ${i === 0 ? "disabled" : ""}>↑</button><button ${i === names.length - 1 ? "disabled" : ""}>↓</button></span>`;
    const [up, down] = row.querySelectorAll(".move button");
    up.addEventListener("click", () => move(i, -1));
    down.addEventListener("click", () => move(i, 1));
    return row;
  }));
}
$("auAuto").addEventListener("change", async (e) => {
  await window.api.mgrSet({ audio: { auto: e.target.checked } });
  audio.auto = e.target.checked;
  toast(e.target.checked ? "會自動切換" : "不會自動切換");
});
window.api.onAudio?.((list) => {
  audio.outputs = list;
  for (const o of list) if (!audio.priority.includes(o.name)) audio.priority.push(o.name);
  if (document.querySelector('section[data-section="audio"].on')) renderAudio();
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
  $("weatherAuto").checked = state.settings.weatherAuto !== false;
  const li = state.locate || {};
  $("locMsg").textContent = li.error ? `定位失敗：${li.error}`
    : li.source === "windows" ? "用 Windows 定位服務（比較準）"
    : li.source === "ip" ? "用網路估的大概位置（Windows 定位服務沒開）"
    : "用 Windows 定位服務找你在哪裡；沒開的話用網路估大概的城市";
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
        await save({ weatherAuto: false, city: { name: r.name, lat: r.latitude, lon: r.longitude } }, `天氣改成 ${r.name}`);
        box.hidden = true;
        $("cityInput").value = "";
      });
      return row;
    }));
  } catch {
    box.innerHTML = `<div class="row"><span class="row-text"><b class="err">連不到網路</b></span></div>`;
  }
});

$("weatherAuto").addEventListener("change", (e) =>
  save({ weatherAuto: e.target.checked }, e.target.checked ? "會自動定位" : "不自動定位"));
$("locateNow").addEventListener("click", async () => {
  $("locateNow").disabled = true;
  $("locMsg").textContent = "定位中…（最多十幾秒）";
  const r = await window.api.weatherLocate();
  $("locateNow").disabled = false;
  state = await window.api.mgrGet();
  render();
  if (r.ok) toast(`現在在 ${r.city.name}`);
});

/* ───────── 一般 ───────── */
function renderGeneral() {
  $("autostart").checked = state.autostart;
  $("desktopLayer").checked = state.desktopLayer;
  $("dataFolder").textContent = state.dataFolder;
  $("version").textContent = state.version;
}
$("autostart").addEventListener("change", (e) =>
  save({ autostart: e.target.checked }, e.target.checked ? "開機時會自動啟動" : "已關閉自動啟動"));
$("desktopLayer").addEventListener("change", (e) =>
  save({ desktopLayer: e.target.checked }, e.target.checked ? "小組件放回桌面那一層" : "小組件不再固定在桌面那一層"));
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
  renderWeatherSource();
  renderPinInterval();
  renderWorldClocks();
}
// 從小組件右鍵改了大小、或日曆更新時，重新讀一次
window.api.onMgrRefresh?.(async () => { state = await window.api.mgrGet(); render(); });

(async () => {
  state = await window.api.mgrGet();
  render();
  go(params.get("section") || "widgets");
})();

/* ───────── 天氣資料來源：Open-Meteo／中央氣象署 ───────── */
function renderWeatherSource() {
  const src = state.weatherSource || "openmeteo";
  document.querySelectorAll('input[name="wsrc"]').forEach((r) => (r.checked = r.value === src));
  $("cwaBox").hidden = src !== "cwa";
  $("wsrcHint").textContent = src === "cwa"
    ? "天氣資料來自中央氣象署開放資料平臺（鄉鎮天氣預報）。"
    : "天氣資料來自 Open-Meteo（免費、不用註冊）。";
  if (src === "cwa" && !$("cwaMsg").dataset.set) {
    $("cwaMsg").textContent = state.cwaHasKey ? "已經設定好授權碼了（想換的話再貼一次）" : "到氣象資料開放平臺註冊後，在「會員資訊 → 取得授權碼」複製過來";
  }
}
document.querySelectorAll('input[name="wsrc"]').forEach((r) => r.addEventListener("change", () => {
  state.weatherSource = r.value;
  renderWeatherSource();
  save({ weatherSource: r.value }, r.value === "cwa" ? (state.cwaHasKey ? "改用中央氣象署" : "請貼上授權碼") : "改用 Open-Meteo");
}));
$("cwaSite").addEventListener("click", () => window.api.mgrOpenUrl("https://opendata.cwa.gov.tw/user/authkey"));
$("cwaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("cwaKey").value.trim();
  if (!key && !state.cwaHasKey) return;
  $("cwaMsg").dataset.set = "1";
  $("cwaMsg").textContent = "測試中…";
  const r = await window.api.weatherCwaTest(key);
  $("cwaKey").value = "";
  if (r.ok) {
    state.cwaHasKey = true;
    $("cwaMsg").textContent = `可以用了：${r.place} ${Math.round(r.temp)}°，${r.desc}`;
    save({ weatherSource: "cwa" });
  } else {
    $("cwaMsg").textContent = `沒成功：${r.error}`;
  }
});

/* ───────── Pinterest 換圖間隔（10～120 分鐘） ───────── */
function renderPinInterval() { $("pnInterval").value = String(state.settings.pinInterval || 30); }
$("pnInterval").addEventListener("change", (e) => save({ pinInterval: Number(e.target.value) }, "已套用"));

/* ───────── Pinterest 首頁推薦（讀網頁版首頁） ───────── */
async function renderPinHome() {
  const st = await window.api.pinHomeStatus();
  $("pnHomeLogin").hidden = st.loggedIn;
  $("pnHomeOn").hidden = !st.loggedIn;
  $("pnHomeOn").checked = st.on;
  $("pnHomeMore").hidden = !st.loggedIn;
  $("pnHomeMsg").textContent = !st.loggedIn
    ? "在程式的視窗裡登入一次 pinterest.com，之後會定時讀你的首頁"
    : st.on ? "開著：小組件會隨機播放你首頁推薦的圖（大約每小時讀一次首頁）" : "已登入，打開開關就會用首頁推薦";
}
$("pnHomeLogin").addEventListener("click", async () => {
  $("pnHomeMsg").textContent = "請在跳出來的視窗登入 Pinterest，登入好會自己關掉…";
  const r = await window.api.pinHomeLogin();
  toast(r.ok ? "已開啟首頁推薦" : "沒有登入");
  renderPinHome();
});
$("pnHomeOn").addEventListener("change", async (e) => {
  await window.api.pinHomeSet(e.target.checked);
  toast(e.target.checked ? "改用首頁推薦" : "改用圖版");
  renderPinHome();
});
$("pnHomeLogout").addEventListener("click", async () => {
  await window.api.pinHomeLogout();
  toast("已登出網頁");
  renderPinHome();
});
renderPinHome();

/* ───────── 世界時鐘的 4 個城市 ───────── */
const WORLD_CITIES = [
  ["台北", "Asia/Taipei"], ["東京", "Asia/Tokyo"], ["首爾", "Asia/Seoul"], ["上海", "Asia/Shanghai"], ["香港", "Asia/Hong_Kong"],
  ["新加坡", "Asia/Singapore"], ["曼谷", "Asia/Bangkok"], ["杜拜", "Asia/Dubai"], ["新德里", "Asia/Kolkata"],
  ["雪梨", "Australia/Sydney"], ["墨爾本", "Australia/Melbourne"], ["奧克蘭", "Pacific/Auckland"],
  ["倫敦", "Europe/London"], ["巴黎", "Europe/Paris"], ["柏林", "Europe/Berlin"], ["阿姆斯特丹", "Europe/Amsterdam"],
  ["蘇黎世", "Europe/Zurich"], ["莫斯科", "Europe/Moscow"], ["伊斯坦堡", "Europe/Istanbul"],
  ["紐約", "America/New_York"], ["多倫多", "America/Toronto"], ["芝加哥", "America/Chicago"], ["丹佛", "America/Denver"],
  ["洛杉磯", "America/Los_Angeles"], ["舊金山", "America/Los_Angeles"], ["溫哥華", "America/Vancouver"],
  ["檀香山", "Pacific/Honolulu"], ["墨西哥城", "America/Mexico_City"], ["聖保羅", "America/Sao_Paulo"],
  ["開羅", "Africa/Cairo"], ["約翰尼斯堡", "Africa/Johannesburg"],
];
function renderWorldClocks() {
  const list = state.settings.worldClocks || [];
  $("worldList").replaceChildren(...[0, 1, 2, 3].map((i) => {
    const row = document.createElement("div");
    row.className = "row";
    const cur = list[i] || {};
    row.innerHTML = `<span class="row-text"><b>第 ${i + 1} 個城市</b><small>${["左上", "右上", "左下", "右下"][i]}</small></span>
      <select class="select">${WORLD_CITIES.map(([n, tz]) => `<option value="${n}|${tz}" ${n === cur.name && tz === cur.tz ? "selected" : ""}>${n}</option>`).join("")}</select>`;
    row.querySelector("select").addEventListener("change", (e) => {
      const next = [0, 1, 2, 3].map((k) => ({ ...(state.settings.worldClocks || [])[k] }));
      const [name, tz] = e.target.value.split("|");
      next[i] = { name, tz };
      save({ worldClocks: next }, `已改成${name}`);
    });
    return row;
  }));
}

/* ───────── iPhone 充電即時顯示（捷徑） ───────── */
const PH_STATUS = { on: "開著，等 iPhone 傳過來", starting: "啟動中…", off: "關閉", busy: "連接埠被別的程式用了，重開電腦再試", error: "開不起來，看一下 debug.log" };
function renderPhone(info) {
  if (!info) return;
  $("phOn").checked = info.on;
  $("phBox").hidden = $("phSteps").hidden = !info.on;
  let st = PH_STATUS[info.status] || info.status;
  if (info.last) st = `上次收到：${new Date(info.last.at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}（${info.last.charging ? "充電中" : "沒在充電"}${info.last.level != null ? `，${info.last.level}%` : ""}）`;
  if (info.on && !info.ips.length) st = "找不到這台電腦的 Wi-Fi 位址，先連上 Wi-Fi";
  $("phStatus").textContent = st;
  $("phPlug").textContent = info.plugUrl;
  $("phUnplug").textContent = info.unplugUrl;
  $("phWatch").textContent = info.watchUrl;
}
const phRefresh = () => window.api.phoneInfo?.().then(renderPhone);
phRefresh();
setInterval(() => !$("phBox").hidden && phRefresh(), 5000);
$("phOn").addEventListener("change", async (e) => { renderPhone(await window.api.phoneSet(e.target.checked)); setTimeout(phRefresh, 800); });
$("phToken").addEventListener("click", async () => { renderPhone(await window.api.phoneNewToken()); toast("已換新密碼，iPhone 上的網址也要更新"); });
for (const b of document.querySelectorAll("[data-copy]")) b.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); toast("已複製"); } catch { toast("複製失敗"); }
});
