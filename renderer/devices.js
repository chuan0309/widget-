// 判斷裝置類型：先看名稱（比較準），認不出來再看藍牙「裝置類別碼」（Class of Device）
const DEVICE_RULES = [
  ["headphones", /airpods max|inzone h\d|inzone(?! buds)|wh-\d|wh-1000|headphone|headset|耳罩|頭戴|qc ?\d+|quietcomfort|arctis|cloud (ii|alpha|flight)|blackshark|kraken/i],
  ["budscase", /充電盒|charging case|airpods.*\bcase\b/i],
  ["buds", /buds|airpods|pods|earbud|wf-\d|wf-1000|linkbuds|freebuds|liberty|tws|ear ?\(|nothing ear|耳機/i],
  ["gamepad", /controller|gamepad|xbox|dualsense|dualshock|joy-?con|8bitdo|手把/i],
  ["mouse", /mouse|mx (master|anywhere|ergo|vertical)|trackball|deathadder|viper|basilisk|pebble|g\s?pro|lift|滑鼠/i],
  ["keyboard", /keyboard|keys|鍵盤|k\d{3}\b|mx mechanical|nuphy|air\s?(60|75|96)|halo\s?(65|75|96)|keychron|hhkb|happy hacking|lofree|akko|ducky|blackwidow|magic keyboard/i],
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

// 圖示都用 icons.js 裡的 Material Symbols
function deviceIcon(type) {
  return icon(type);
}
