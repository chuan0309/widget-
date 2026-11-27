// Apple（SF Symbols 多色版）風格的天氣圖示，32×32
// 雲：平底、左小右大兩個鼓包；太陽／月亮被雲擋住時，中間留一道透明細縫（跟 Apple 一樣）
const WX_SUN = "#ffd60a", WX_RAIN = "#40b8f5", WX_CLOUD = "#fff", WX_BOLT = "#ffd60a";
// 雲的形狀（圓＋長方形拼起來）；k＝放大倍率、(x,y)＝左下角位移
const cloudShapes = (x = 0, y = 0, k = 1) => {
  const c = (cx, cy, r) => `<circle cx="${(x + cx * k).toFixed(2)}" cy="${(y + cy * k).toFixed(2)}" r="${(r * k).toFixed(2)}"/>`;
  return c(9.2, 19.6, 4.6) + c(16.6, 15.2, 7.4) + c(23.4, 19.9, 4.3) +
    `<rect x="${(x + 9.2 * k).toFixed(2)}" y="${(y + 17 * k).toFixed(2)}" width="${(14.2 * k).toFixed(2)}" height="${(7.2 * k).toFixed(2)}"/>`;
};
const wxCloud = (x, y, k, fill = WX_CLOUD) => `<g fill="${fill}">${cloudShapes(x, y, k)}</g>`;
// 把後面的東西（太陽、月亮）挖掉雲的輪廓＋一圈縫
// id 固定（同一種圖示每次畫出來都一樣），內容沒變就不用重畫
const behindCloud = (id, inner, x, y, k, gap = 1.6) => {
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/>` +
    `<g fill="#000" stroke="#000" stroke-width="${gap * 2}">${cloudShapes(x, y, k)}</g></mask><g mask="url(#${id})">${inner}</g>`;
};
const wxSun = (cx, cy, r) => {
  let g = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${WX_SUN}"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, r1 = r * 1.5, r2 = r * 1.98;
    g += `<line x1="${(cx + r1 * Math.cos(a)).toFixed(2)}" y1="${(cy + r1 * Math.sin(a)).toFixed(2)}" x2="${(cx + r2 * Math.cos(a)).toFixed(2)}" y2="${(cy + r2 * Math.sin(a)).toFixed(2)}" stroke="${WX_SUN}" stroke-width="${(r * 0.3).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return g;
};
// 彎月（白）＋小星星
const wxMoon = (x, y, k) => `<path fill="#fff" transform="translate(${x} ${y}) scale(${k})" d="M13.2 3.4a10 10 0 1 0 12.4 13.9A8.2 8.2 0 0 1 13.2 3.4z"/>`;
const wxStar = (cx, cy, r) => `<path fill="#fff" d="M${cx} ${cy - r}Q${cx + r * .18} ${cy - r * .18} ${cx + r} ${cy}Q${cx + r * .18} ${cy + r * .18} ${cx} ${cy + r}Q${cx - r * .18} ${cy + r * .18} ${cx - r} ${cy}Q${cx - r * .18} ${cy - r * .18} ${cx} ${cy - r}z"/>`;
const drop = (x, y, len = 4.2, w = 2.3, color = WX_RAIN) => `<line x1="${x}" y1="${y}" x2="${(x - len * 0.38).toFixed(2)}" y2="${(y + len).toFixed(2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const dot = (x, y, r = 1.25, color = WX_RAIN) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const flake = (cx, cy, r = 2.2) => {
  let g = "";
  for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3 + Math.PI / 2, dx = r * Math.cos(a), dy = r * Math.sin(a);
    g += `<line x1="${(cx - dx).toFixed(2)}" y1="${(cy - dy).toFixed(2)}" x2="${(cx + dx).toFixed(2)}" y2="${(cy + dy).toFixed(2)}" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`; }
  return g;
};
// kind：clear / partly / cloudy / fog / drizzle / rain / heavy / snow / sleet / storm / sunrise / sunset；night：晚上
function wxIcon(kind, night = false) {
  let g = "";
  const up = [0.4, -5.4, 1]; // 下面要放雨滴時，雲往上移
  switch (kind) {
    case "clear": g = night ? wxMoon(1.5, 2.5, 0.98) + wxStar(25.5, 6.5, 2.6) + wxStar(21.5, 13, 1.6) : wxSun(16, 16, 6); break;
    case "partly": {
      const cl = [-1.6, 3.2, 0.98];
      g = behindCloud(night ? "wxm-pn" : "wxm-pd", night ? wxMoon(12.4, -2.6, 0.8) : wxSun(20.6, 11.2, 4.7), ...cl) + wxCloud(...cl);
      break;
    }
    case "cloudy": g = wxCloud(-0.4, -2.2, 1.02); break;
    case "fog": g = wxCloud(...up) + `<g stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".85"><line x1="6.5" y1="24" x2="25.5" y2="24"/><line x1="9.5" y1="28.4" x2="22.5" y2="28.4"/></g>`; break;
    case "drizzle": g = wxCloud(...up) + dot(11.5, 24.4) + dot(16.5, 24.4) + dot(21.5, 24.4) + dot(9.6, 28.6) + dot(14.6, 28.6) + dot(19.6, 28.6); break;
    case "rain": g = wxCloud(...up) + drop(11.6, 23.6) + drop(17, 25.2) + drop(22.4, 23.6); break;
    case "heavy": g = wxCloud(...up) + drop(9.6, 23.4, 5.4) + drop(14.2, 24.6, 5.4) + drop(18.8, 23.4, 5.4) + drop(23.4, 24.6, 5.4); break;
    case "snow": g = wxCloud(...up) + flake(11.2, 25.6) + flake(16.6, 28.4) + flake(22, 25.6); break;
    case "sleet": g = wxCloud(...up) + drop(11.6, 23.6) + flake(16.8, 27.4) + drop(22.4, 23.6); break;
    case "storm": g = wxCloud(...up) + drop(10.2, 23.8, 3.6) + drop(23.6, 23.8, 3.6) + `<path fill="${WX_BOLT}" d="M17.6 20.6 12.9 26.9h3.5l-1.5 4.8 5.6-7.2h-3.6l1.6-3.9z"/>`; break;
    case "sunrise": case "sunset": {
      const id = `wxc-${kind}`;
      const half = `<clipPath id="${id}"><rect x="0" y="0" width="32" height="22"/></clipPath>`;
      const arrow = kind === "sunset"
        ? `<path d="M16 1.4v5M13.4 4.4 16 7l2.6-2.6" stroke="${WX_SUN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
        : `<path d="M16 7V1.6M13.4 4.2 16 1.6l2.6 2.6" stroke="${WX_SUN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
      g = half + `<g clip-path="url(#${id})">${wxSun(16, 22, 5.6)}</g>` + arrow + `<line x1="4" y1="24.2" x2="28" y2="24.2" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
      break;
    }
  }
  return `<svg class="wx" viewBox="0 0 32 32" aria-hidden="true">${g}</svg>`;
}
// WMO 天氣代碼 → 圖示種類
function wxKind(code) {
  if (code <= 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloudy";
  if (code <= 48) return "fog";
  if (code <= 55) return "drizzle";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "sleet";
  if (code === 65 || code === 82) return "heavy";
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain";
  if (code <= 77 || code === 85 || code === 86) return "snow";
  return "storm";
}
