// Apple 風格的彩色天氣圖示（32×32）：白雲、黃太陽、藍雨滴、白雪花、黃閃電、白月亮
const WX_SUN = "#ffd60a", WX_RAIN = "#5ac8fa", WX_CLOUD = "#fff", WX_MOON = "#fff";
const wxCloud = (dx = 0, dy = 0, s = 1, fill = WX_CLOUD) =>
  `<path transform="translate(${dx} ${dy}) scale(${s})" fill="${fill}" d="M9.5 25h13.2a5.3 5.3 0 0 0 .9-10.53A7.3 7.3 0 0 0 9.6 14.2 5.4 5.4 0 0 0 9.5 25z"/>`;
const wxSun = (cx, cy, r, rays = true) => {
  let g = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${WX_SUN}"/>`;
  if (rays) for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, r1 = r * 1.45, r2 = r * 1.95;
    g += `<line x1="${(cx + r1 * Math.cos(a)).toFixed(2)}" y1="${(cy + r1 * Math.sin(a)).toFixed(2)}" x2="${(cx + r2 * Math.cos(a)).toFixed(2)}" y2="${(cy + r2 * Math.sin(a)).toFixed(2)}" stroke="${WX_SUN}" stroke-width="${(r * 0.32).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return g;
};
const wxMoon = (dx, dy, s) => `<path transform="translate(${dx} ${dy}) scale(${s})" fill="${WX_MOON}" d="M12.9 3.2A9.4 9.4 0 1 0 23 15.8 7.6 7.6 0 0 1 12.9 3.2z"/>`;
const wxDrops = (n = 3) => Array.from({ length: n }, (_, i) =>
  `<line x1="${11.4 + i * 4.8}" y1="24.8" x2="${9.6 + i * 4.8}" y2="30" stroke="${WX_RAIN}" stroke-width="2.5" stroke-linecap="round"/>`).join("");
const wxFlake = (cx, cy, r) => {
  let g = "";
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 2;
    const x = r * Math.cos(a), y = r * Math.sin(a);
    g += `<line x1="${(cx - x).toFixed(2)}" y1="${(cy - y).toFixed(2)}" x2="${(cx + x).toFixed(2)}" y2="${(cy + y).toFixed(2)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
    for (const sgn of [1, -1]) {
      const bx = cx + sgn * x * 0.62, by = cy + sgn * y * 0.62;
      for (const t of [0.5, -0.5]) {
        const b = a + t * 1.6;
        g += `<line x1="${bx.toFixed(2)}" y1="${by.toFixed(2)}" x2="${(bx + sgn * r * 0.32 * Math.cos(b)).toFixed(2)}" y2="${(by + sgn * r * 0.32 * Math.sin(b)).toFixed(2)}" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`;
      }
    }
  }
  return g;
};
// kind：clear / partly / cloudy / fog / drizzle / rain / snow / storm；night：晚上
function wxIcon(kind, night = false) {
  let g = "";
  switch (kind) {
    case "clear": g = night ? wxMoon(3, 3, 1.05) : wxSun(16, 16, 6.2); break;
    case "partly": g = (night ? wxMoon(10, 0, 0.76) : wxSun(20.2, 11.2, 5)) + wxCloud(-2.8, 3, 0.98); break;
    case "cloudy": g = wxCloud(-0.5, -2.5, 1.02); break;
    case "fog": g = wxCloud(-0.5, -6, 1) + `<g stroke="rgba(255,255,255,0.8)" stroke-width="2" stroke-linecap="round"><line x1="7" y1="24" x2="25" y2="24"/><line x1="9" y1="28" x2="23" y2="28"/></g>`; break;
    case "drizzle": g = wxCloud(-0.5, -5.5, 1) + wxDrops(2).replace(/x1="11.4/g, 'x1="13.8').replace(/x2="9.6/g, 'x2="12'); break;
    case "rain": g = wxCloud(-0.5, -5.5, 1) + wxDrops(3); break;
    case "snow": g = wxFlake(16, 16, 11); break;
    case "storm": g = wxCloud(-0.5, -5.5, 1) + `<path fill="${WX_SUN}" d="M17.2 19.5 12.6 26h3.6l-1.5 5 5.3-7.2h-3.7l1.5-4.3z"/>`; break;
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
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain";
  if (code <= 77 || code === 85 || code === 86) return "snow";
  return "storm";
}
