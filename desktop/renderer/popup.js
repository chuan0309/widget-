document.body.className = `glass-${new URLSearchParams(location.search).get("glass") || "acrylic"}`;

const $ = (id) => document.getElementById(id);
const BUDS_ART = `
  <div class="case-shape"><div class="lid"></div><i class="led"></i></div>
  <div class="bud bl"></div>
  <div class="bud br"></div>`;

let shownType = null;
function render(device) {
  if (!device) return;
  $("name").textContent = device.name;

  const type = deviceType(device.name);
  if (type !== shownType) { // 同一台裝置更新電量時，插圖不要重新閃一次
    $("art").innerHTML = type === "buds" ? BUDS_ART : `<div class="orb">${deviceIcon(type)}</div>`;
    shownType = type;
  }

  const b = device.battery;
  $("batt").innerHTML = b == null ? "" :
    `<div class="ring ${b <= 20 ? "low" : ""}" style="--p:${b}"></div><span>${b}%</span>`;
}

window.api.onPopupDevice(render);
$("doneBtn").addEventListener("click", () => window.api.closePopup());
$("closeBtn").addEventListener("click", () => window.api.closePopup());
