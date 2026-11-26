const $ = (id) => document.getElementById(id);
const notch = $("notch");

const SHOW_MS = 4500; // 打開後停多久
let closeTimer = null;

function render(device) {
  if (!device) return;
  const low = device.alert === "low";
  notch.classList.toggle("low", low);
  $("name").textContent = device.name; // 直接用 Windows 裡的名稱
  $("sub").textContent = low ? "電量偏低，記得充電" : "已連線";
  // 白色立體產品插圖（重新放進去，入場動畫才會每次都播）
  $("dev").innerHTML = deviceArtFor(device.name, deviceType(device.name, device.cod));
  // 跟著小組件的背景：淺色＝白底黑字，其他＝黑底白字
  document.body.classList.toggle("light", device.theme === "light");
  const b = device.battery;
  $("batt").innerHTML = b == null ? "" : `<span class="ring ${b <= 20 ? "low" : ""}"></span>${b}%`;
  // 讓圓環從 0 跑到目前電量
  requestAnimationFrame(() => $("batt").querySelector(".ring")?.style.setProperty("--p", b));
}

function open(device) {
  render(device);
  notch.classList.add("pill");
  requestAnimationFrame(() => notch.classList.add("open"));
  clearTimeout(closeTimer);
  closeTimer = setTimeout(close, SHOW_MS);
}

function close() {
  clearTimeout(closeTimer);
  notch.classList.remove("open");
  // 先縮回小瀏海，再收進螢幕上緣，最後告訴主程式把視窗藏起來
  setTimeout(() => notch.classList.remove("pill"), 380);
  setTimeout(() => window.api.closePopup(), 900);
}

window.api.onPopupDevice((d) => (d ? open(d) : null));
window.api.onPopupClose?.(() => notch.classList.contains("pill") && close());

// 滑鼠移到瀏海上時才接收點擊；點一下就收起來；停在上面時不要自動收
notch.addEventListener("mouseenter", () => { window.api.popupMouse(true); clearTimeout(closeTimer); });
notch.addEventListener("mouseleave", () => {
  window.api.popupMouse(false);
  if (notch.classList.contains("open")) closeTimer = setTimeout(close, 1500);
});
notch.addEventListener("click", close);
