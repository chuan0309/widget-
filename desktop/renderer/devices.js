// 判斷裝置類型：先看名稱（比較準），認不出來再看藍牙「裝置類別碼」（Class of Device）
const DEVICE_RULES = [
  ["headphones", /airpods max|inzone h\d|inzone(?! buds)|wh-\d|wh-1000|headphone|headset|耳罩|頭戴|qc ?\d+|quietcomfort|arctis|cloud (ii|alpha|flight)|blackshark|kraken/i],
  ["buds", /buds|airpods|pods|earbud|wf-\d|wf-1000|linkbuds|freebuds|liberty|tws|ear ?\(|nothing ear|耳機/i],
  ["gamepad", /controller|gamepad|xbox|dualsense|dualshock|joy-?con|8bitdo|手把/i],
  ["mouse", /mouse|mx (master|anywhere|ergo|vertical)|trackball|deathadder|viper|basilisk|pebble|滑鼠/i],
  ["keyboard", /keyboard|keys|鍵盤|k\d{3}\b|mx mechanical/i],
  ["speaker", /speaker|soundlink|soundcore|boom|flip \d|charge \d|srs-|喇叭|音箱/i],
  ["phone", /iphone|phone|galaxy (s|z|a)\d|pixel \d|手機/i],
  ["tablet", /ipad|tablet|galaxy tab|平板/i],
  ["watch", /watch|band|手錶/i],
];

function typeFromClassOfDevice(cod) {
  if (!cod) return null;
  const major = (cod >> 8) & 0x1f;
  const minor = (cod >> 2) & 0x3f;
  if (major === 1) return "pc";
  if (major === 2) return "phone";
  if (major === 4) return minor === 5 ? "speaker" : "headphones"; // 5 = 喇叭，其他多半是耳機
  if (major === 5) {
    const kind = (cod >> 6) & 0x3; // 1 鍵盤、2 滑鼠、3 鍵盤＋滑鼠
    if ((cod >> 2 & 0xf) === 1 || (cod >> 2 & 0xf) === 2) return "gamepad";
    if (kind === 2) return "mouse";
    if (kind === 1 || kind === 3) return "keyboard";
  }
  if (major === 7) return "watch";
  return null;
}

function deviceType(name = "", cod = null) {
  for (const [type, re] of DEVICE_RULES) if (re.test(name)) return type;
  return typeFromClassOfDevice(cod) || "other";
}

const DEVICE_ICONS = {
  buds: '<path d="M5 5a3 3 0 0 1 4.5 2.6v2.6A1.5 1.5 0 0 1 8 11.7V19"/><path d="M19 5a3 3 0 0 0-4.5 2.6v2.6a1.5 1.5 0 0 0 1.5 1.5V19"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  gamepad: '<path d="M6 8h12a4 4 0 0 1 4 4l-1 5a2.5 2.5 0 0 1-4.3 1.3L15 16H9l-1.7 2.3A2.5 2.5 0 0 1 3 17l-1-5a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01"/>',
  speaker: '<rect x="5" y="2" width="14" height="20" rx="3"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4"/>',
  other: '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
};

function deviceIcon(type) {
  return `<svg viewBox="0 0 24 24">${DEVICE_ICONS[type] || DEVICE_ICONS.other}</svg>`;
}
