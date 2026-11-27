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

// 家庭小組件的圖示：可以自己選；沒選就照名稱挑（舒睡→月亮、春花→花、銀河→星星、極光→波浪…）
const HOME_ICON_CHOICES = [["", "自動"], ["scene", "星光"], ["moon", "月亮"], ["star", "星星"], ["sun", "太陽"], ["flower", "花"], ["wave", "極光"], ["drop", "水滴"], ["fire", "火"], ["heart", "愛心"], ["bed", "床"], ["book", "閱讀"], ["film", "電影"], ["bulb", "燈泡"], ["ac", "冷氣"], ["fan", "電扇"], ["snow", "雪花"], ["home", "房子"], ["schedule", "時鐘"]];
// 圖示可以是內建的名字，也可以是使用者自己挑的照片（data:image/...，存在設定裡）
const homeIconHTML = (name) => (String(name).startsWith("data:image/") ? `<img class="hm-photo" src="${name}" alt="" />` : icon(name));
function homeAutoIcon(it) {
  if (it.kind === "room") return "home";
  if (it.kind === "light" || it.kind === "off") return "bulb";
  if (it.kind === "ac") return "ac";
  if (it.kind === "fan") return "fan";
  if (it.kind === "switch") return "bulb";
  const n = String(it.name || "");
  if (/睡|夜|晚|月|sleep|night|moon|relax|放鬆/i.test(n)) return "moon";
  if (/花|春|櫻|flower|blossom|spring/i.test(n)) return "flower";
  if (/銀河|星|galaxy|star/i.test(n)) return "star";
  if (/極光|aurora|海|浪|漂|ocean|wave/i.test(n)) return "wave";
  if (/日|陽|晨|黃金|sun|energize|活力/i.test(n)) return "sun";
  if (/愛|心|love|romance/i.test(n)) return "heart";
  return it.smart ? "schedule" : "scene";
}
const homeIconName = (it, icons) => icons?.[it.id] || homeAutoIcon(it);
