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
  ART.headset = ART.headphones;
  window.deviceArt = (type) => `<svg class="art" viewBox="0 0 64 64" aria-hidden="true">${DEFS}${ART[type] || ART.other}</svg>`;
})();
