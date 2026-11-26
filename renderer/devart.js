// 藍牙通知用的裝置插圖：白色、有光影的立體產品圖（像去背的產品照，但是自己畫的）
// deviceArt(type) → <svg>，type 跟 devices.js 的 deviceType() 一樣
(() => {
  const DEFS = `<defs>
    <linearGradient id="da-w" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eceef2"/><stop offset="1" stop-color="#c3c8d0"/>
    </linearGradient>
    <linearGradient id="da-w2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d4d8de"/>
    </linearGradient>
    <linearGradient id="da-k" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b3e45"/><stop offset="1" stop-color="#16181c"/>
    </linearGradient>
    <radialGradient id="da-scr" cx=".35" cy=".25" r=".9">
      <stop offset="0" stop-color="#3a4a7a"/><stop offset="1" stop-color="#0d1020"/>
    </radialGradient>
    <filter id="da-sh" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".35"/>
    </filter>
  </defs>`;

  const bud = `
    <rect x="17.5" y="23" width="7" height="30" rx="3.5" fill="url(#da-w2)"/>
    <rect x="18.6" y="47" width="4.8" height="4" rx="1.5" fill="#b9bec6"/>
    <circle cx="21" cy="19" r="9.5" fill="url(#da-w)"/>
    <ellipse cx="29.5" cy="21" rx="3.6" ry="4.8" fill="#d6dae0"/>
    <ellipse cx="17.5" cy="15.5" rx="2.4" ry="1.3" fill="#4a4d54" transform="rotate(-25 17.5 15.5)"/>`;

  const ART = {
    buds: `<g filter="url(#da-sh)"><g transform="translate(-2 2)">${bud}</g><g transform="translate(66 2) scale(-1 1)">${bud}</g></g>`,
    headphones: `<g filter="url(#da-sh)">
      <path d="M13 38 C13 12 51 12 51 38" fill="none" stroke="url(#da-w)" stroke-width="5" stroke-linecap="round"/>
      <rect x="7" y="31" width="14" height="22" rx="7" fill="url(#da-w)"/><rect x="43" y="31" width="14" height="22" rx="7" fill="url(#da-w)"/>
      <rect x="17" y="34" width="4" height="16" rx="2" fill="#c9cdd4"/><rect x="43" y="34" width="4" height="16" rx="2" fill="#c9cdd4"/></g>`,
    mouse: `<g filter="url(#da-sh)">
      <rect x="19" y="7" width="26" height="50" rx="13" fill="url(#da-w)"/>
      <path d="M32 8 V25" stroke="#c4c9d0" stroke-width="1.2"/>
      <rect x="30.3" y="13" width="3.4" height="8" rx="1.7" fill="#4a4d54"/></g>`,
    keyboard: `<g filter="url(#da-sh)">
      <rect x="4" y="18" width="56" height="28" rx="4.5" fill="url(#da-w)"/>
      ${[0, 1, 2].map((r) => Array.from({ length: 10 }, (_, c) =>
        `<rect x="${7.5 + c * 5}" y="${21.5 + r * 6}" width="4" height="4.4" rx="1" fill="#e3e6ea" stroke="#c2c7ce" stroke-width=".5"/>`).join("")).join("")}
      <rect x="17.5" y="39.5" width="29" height="4" rx="1" fill="#e3e6ea" stroke="#c2c7ce" stroke-width=".5"/></g>`,
    gamepad: `<g filter="url(#da-sh)">
      <path d="M19 18 h26 c8 0 12 8 14.5 19 c2.2 10 -2.5 15 -7 13 c-4 -2 -6 -9 -10.5 -9 h-20 c-4.5 0 -6.5 7 -10.5 9 c-4.5 2 -9.2 -3 -7 -13 C7 26 11 18 19 18z" fill="url(#da-w)"/>
      <rect x="24" y="20" width="16" height="9" rx="2.5" fill="#e4e7eb" stroke="#c6cbd2" stroke-width=".6"/>
      <circle cx="24" cy="36" r="4.2" fill="url(#da-k)"/><circle cx="40" cy="36" r="4.2" fill="url(#da-k)"/>
      <path d="M14 27 h5 M16.5 24.5 v5" stroke="#9aa0a8" stroke-width="2" stroke-linecap="round"/>
      <circle cx="48" cy="25" r="1.4" fill="#9aa0a8"/><circle cx="51" cy="28" r="1.4" fill="#9aa0a8"/><circle cx="45" cy="28" r="1.4" fill="#9aa0a8"/><circle cx="48" cy="31" r="1.4" fill="#9aa0a8"/></g>`,
    phone: `<g filter="url(#da-sh)">
      <rect x="18" y="4" width="28" height="56" rx="7" fill="#d9dce1"/>
      <rect x="19.3" y="5.3" width="25.4" height="53.4" rx="5.8" fill="url(#da-scr)"/>
      <rect x="27.5" y="8" width="9" height="2.8" rx="1.4" fill="#000"/></g>`,
    tablet: `<g filter="url(#da-sh)">
      <rect x="9" y="8" width="46" height="48" rx="5" fill="#d9dce1"/>
      <rect x="10.5" y="9.5" width="43" height="45" rx="3.8" fill="url(#da-scr)"/></g>`,
    watch: `<g filter="url(#da-sh)">
      <rect x="22" y="2" width="20" height="16" rx="4" fill="#e4e7eb"/><rect x="22" y="46" width="20" height="16" rx="4" fill="#e4e7eb"/>
      <rect x="16" y="14" width="32" height="36" rx="9" fill="url(#da-w)"/>
      <rect x="19" y="17" width="26" height="30" rx="7" fill="#0b0c10"/>
      <rect x="48" y="24" width="3" height="7" rx="1.5" fill="#c3c8d0"/></g>`,
    speaker: `<g filter="url(#da-sh)">
      <rect x="18" y="6" width="28" height="52" rx="14" fill="url(#da-w)"/>
      <ellipse cx="32" cy="12" rx="9" ry="3" fill="#d8dbe0"/>
      ${Array.from({ length: 5 }, (_, i) => `<path d="M21 ${24 + i * 6} H43" stroke="#cfd3d9" stroke-width="1.6" stroke-linecap="round"/>`).join("")}</g>`,
    laptop: `<g filter="url(#da-sh)">
      <rect x="12" y="12" width="40" height="28" rx="3" fill="#d9dce1"/><rect x="13.5" y="13.5" width="37" height="25" rx="2" fill="url(#da-scr)"/>
      <path d="M6 42 h52 l-3 6 h-46z" fill="url(#da-w)"/></g>`,
    pc: `<g filter="url(#da-sh)">
      <rect x="8" y="10" width="48" height="32" rx="3" fill="#d9dce1"/><rect x="9.5" y="11.5" width="45" height="29" rx="2" fill="url(#da-scr)"/>
      <path d="M28 42 h8 l2 9 h-12z" fill="url(#da-w2)"/><rect x="20" y="50" width="24" height="4" rx="2" fill="url(#da-w)"/></g>`,
    other: `<g filter="url(#da-sh)">
      <circle cx="32" cy="32" r="22" fill="url(#da-w)"/>
      <path d="M25 24 l14 14 -7 7 v-26 l7 7 -14 14" fill="none" stroke="#3478f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  };
  // 特定型號（照裝置名稱挑）：比一般圖示更像實際的樣子
  const MODEL = {
    // PS5 DualSense：兩側白、中間黑、上面大觸控板、藍色光條
    dualsense: `<g filter="url(#da-sh)">
      <path d="M18 17 h28 c8.5 0 12.5 8 15 19.5 c2.2 10.5 -2.8 15.5 -7.5 13.5 c-4 -1.8 -6 -8.5 -10.5 -8.5 h-22 c-4.5 0 -6.5 6.7 -10.5 8.5 c-4.7 2 -9.7 -3 -7.5 -13.5 C5.5 25 9.5 17 18 17z" fill="url(#da-w)"/>
      <path d="M20 27 h24 c2 0 3 1.5 3 3.5 v6 c0 3 -2 4.5 -5 4.5 h-20 c-3 0 -5 -1.5 -5 -4.5 v-6 c0 -2 1 -3.5 3 -3.5z" fill="url(#da-k)"/>
      <rect x="22" y="17.5" width="20" height="10.5" rx="2.5" fill="#f4f5f7" stroke="#c3c8cf" stroke-width=".6"/>
      <path d="M21.5 19 v8 M42.5 19 v8" stroke="#3d8bff" stroke-width="1.1" stroke-linecap="round" opacity=".9"/>
      <circle cx="25.5" cy="35" r="3.6" fill="#0d0e11" stroke="#4a4d54" stroke-width=".7"/><circle cx="38.5" cy="35" r="3.6" fill="#0d0e11" stroke="#4a4d54" stroke-width=".7"/>
      <circle cx="32" cy="32" r="1.3" fill="#9aa0a8"/>
      <path d="M12.5 26 h5 M15 23.5 v5" stroke="#a7adb5" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="49" cy="23.5" r="1.3" fill="#a7adb5"/><circle cx="52" cy="26.5" r="1.3" fill="#a7adb5"/><circle cx="46" cy="26.5" r="1.3" fill="#a7adb5"/><circle cx="49" cy="29.5" r="1.3" fill="#a7adb5"/></g>`,
    // 羅技 MX Master：石墨灰、人體工學、左邊大拇指托、銀色滾輪
    mxmaster: `<g filter="url(#da-sh)">
      <defs><linearGradient id="da-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a5e66"/><stop offset="1" stop-color="#25272c"/></linearGradient></defs>
      <path d="M27 5 c9 -1.5 17 3.5 18.5 13 l2.5 21 c1.2 11 -5.5 19 -15.5 19 c-9.5 0 -16 -5.5 -17 -13.5 l-1 -7 c-4 -1 -6.5 -4 -5.5 -8 c1 -3.5 4 -5 6.5 -5.5 l1.5 -9 C18 9.5 21.5 6 27 5z" fill="url(#da-g)"/>
      <path d="M8 31 c1 -3.5 4 -5 6.5 -5.5 l1.5 12 c-4 -0.5 -8.5 -2.5 -8 -6.5z" fill="#34373d" stroke="#1b1d21" stroke-width=".6"/>
      <path d="M32 6 V22" stroke="#1b1d21" stroke-width="1"/>
      <rect x="29.6" y="9" width="4.8" height="10" rx="2.4" fill="#c7cbd1"/>
      <rect x="10.5" y="28.5" width="5" height="2.4" rx="1.2" fill="#8a8f97"/>
      <circle cx="35" cy="26" r="1.1" fill="#8a8f97"/></g>`,
    // NuPhy Air60：60% 矮軸鍵盤，白鍵帽＋灰色功能鍵，橘色 Esc
    nuphy: `<g filter="url(#da-sh)">
      <rect x="3" y="19" width="58" height="27" rx="3.5" fill="url(#da-w)"/>
      ${[0, 1, 2, 3].map((r) => Array.from({ length: 12 }, (_, c) => {
        const x = 5.5 + c * 4.5 + (r % 2) * 0.8, y = 21.5 + r * 5;
        const mod = c === 0 || c === 11;
        const esc = r === 0 && c === 0;
        return `<rect x="${x.toFixed(1)}" y="${y}" width="3.8" height="4.1" rx=".9" fill="${esc ? "#ff7a3c" : mod ? "#9aa0a8" : "#f3f4f6"}" stroke="#c2c7ce" stroke-width=".4"/>`;
      }).join("")).join("")}
      <rect x="20" y="41.3" width="24" height="3.6" rx=".9" fill="#f3f4f6" stroke="#c2c7ce" stroke-width=".4"/>
      <rect x="5.5" y="41.3" width="12" height="3.6" rx=".9" fill="#9aa0a8"/><rect x="46.5" y="41.3" width="12" height="3.6" rx=".9" fill="#9aa0a8"/></g>`,
    // iPhone：鈦金屬邊框、動態島、側邊按鈕
    iphone: `<g filter="url(#da-sh)">
      <rect x="16.4" y="16" width="1.6" height="6" rx=".8" fill="#9a9ca0"/><rect x="16.4" y="24" width="1.6" height="8" rx=".8" fill="#9a9ca0"/><rect x="46" y="21" width="1.6" height="11" rx=".8" fill="#9a9ca0"/>
      <rect x="17.5" y="3.5" width="29" height="57" rx="7.5" fill="#a7a9ad"/>
      <rect x="18.6" y="4.6" width="26.8" height="54.8" rx="6.6" fill="#111"/>
      <rect x="20" y="6" width="24" height="52" rx="5.5" fill="url(#da-scr)"/>
      <rect x="27.5" y="8.2" width="9" height="2.8" rx="1.4" fill="#000"/></g>`,
    // AirPods Pro：短柄、矽膠耳塞
    airpods: `<g filter="url(#da-sh)">${[[-5, 1], [69, -1]].map(([tx, sx]) => `<g transform="translate(${tx} 4) scale(${sx} 1)">
      <rect x="17.5" y="24" width="7" height="22" rx="3.5" fill="url(#da-w2)"/>
      <rect x="18.8" y="40" width="4.4" height="4" rx="1.4" fill="#b9bec6"/>
      <circle cx="21" cy="19" r="9.5" fill="url(#da-w)"/>
      <ellipse cx="29.8" cy="20.5" rx="4.2" ry="5.4" fill="#e9ecef" stroke="#c9cdd3" stroke-width=".6"/>
      <ellipse cx="17" cy="15" rx="2.6" ry="1.3" fill="#4a4d54" transform="rotate(-25 17 15)"/></g>`).join("")}</g>`,
  };
  const MODEL_MATCH = [
    [/dualsense|ps5.*controller/i, "dualsense"],
    [/mx\s*master/i, "mxmaster"],
    [/nuphy|air\s?(60|75|96)|halo\s?(65|75|96)/i, "nuphy"],
    [/iphone/i, "iphone"],
    [/airpods/i, "airpods"],
  ];
  ART.headset = ART.headphones;
  // 先看名稱有沒有特定型號，沒有就用一般的類型圖
  window.deviceArtFor = (name, type) => {
    const hit = MODEL_MATCH.find(([re]) => re.test(String(name || "")));
    return `<svg class="art" viewBox="0 0 64 64" aria-hidden="true">${DEFS}${hit ? MODEL[hit[1]] : ART[type] || ART.other}</svg>`;
  };
  window.deviceArt = (type) => `<svg class="art" viewBox="0 0 64 64" aria-hidden="true">${DEFS}${ART[type] || ART.other}</svg>`;
})();
