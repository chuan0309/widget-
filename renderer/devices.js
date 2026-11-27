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

// 裝置圖示：照 Mac「電池」小工具重畫的 Apple 風格（24×24，自己畫的，不是 Apple 的檔案）
// 有螢幕的裝置是「外框＋淡淡的螢幕」雙色：外框挖空，螢幕再用半透明補回去，
// 這樣不管底色是白、黑、藍，看起來都是雙色
const rr = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const hollow = (outer, inner) => `<path fill-rule="evenodd" d="${outer}${inner}"/><path class="scr" d="${inner}"/>`;
const DEV_ICONS = {
  laptop: hollow(rr(3.5, 4.6, 17, 11.1, 1.7), rr(5, 6.1, 14, 8.2, 0.4)) + `<path d="M1.2 16.6h21.6v.6c0 1-.8 1.8-1.8 1.8H3c-1 0-1.8-.8-1.8-1.8z"/>`,
  pc: hollow(rr(1.8, 3, 20.4, 13.6, 1.8), rr(3.2, 4.4, 17.6, 10.8, 0.6)) + `<path d="M10 16.6h4l.6 3.4h2v1.4H7.4V20h2z"/>`,
  phone: hollow(rr(6.6, 1.8, 10.8, 20.4, 2.8), rr(7.9, 3.1, 8.2, 17.8, 1.7)) + `<rect x="10.4" y="4" width="3.2" height="1.1" rx=".55"/>`,
  tablet: hollow(rr(3.8, 1.8, 16.4, 20.4, 2.4), rr(5.2, 3.2, 13.6, 17.6, 1.2)),
  watch: `<path d="M8.6 1.6h6.8l.8 3.4H7.8zM7.8 19h8.4l-.8 3.4H8.6z"/>` + hollow(rr(5.6, 4.4, 12.8, 15.2, 3.6), rr(7, 5.8, 10, 12.4, 2.4)) + `<rect x="18.4" y="8.6" width="1.4" height="3.2" rx=".6"/>`,
  keyboard: `<path fill-rule="evenodd" d="M3.4 6.2h17.2c1.2 0 2.1.9 2.1 2.1v7.4c0 1.2-.9 2.1-2.1 2.1H3.4c-1.2 0-2.1-.9-2.1-2.1V8.3c0-1.2.9-2.1 2.1-2.1zM4 8.4v1.6h1.6V8.4zm2.8 0v1.6h1.6V8.4zm2.8 0v1.6h1.6V8.4zm2.8 0v1.6H14V8.4zm2.8 0v1.6h1.6V8.4zm2.8 0v1.6H20V8.4zM5.4 11.2v1.6H7v-1.6zm2.8 0v1.6h1.6v-1.6zm2.8 0v1.6h1.6v-1.6zm2.8 0v1.6h1.6v-1.6zm2.8 0v1.6h1.6v-1.6zM7 14v1.6h10V14z"/>`,
  mouse: `<path fill-rule="evenodd" d="M12 1.8c3.6 0 6.2 2.6 6.2 6.4v7.6c0 3.8-2.6 6.4-6.2 6.4s-6.2-2.6-6.2-6.4V8.2c0-3.8 2.6-6.4 6.2-6.4zM11.4 3.4v6h1.2v-6z"/>`,
  gamepad: `<path fill-rule="evenodd" d="M7.2 5.6h9.6c2.6 0 4.3 1.6 5 4.3l1.2 5.4c.6 2.6-1 4.5-3 4.5-1.3 0-2.2-.7-3-1.9l-1.1-1.8H8.1L7 17.9c-.8 1.2-1.7 1.9-3 1.9-2 0-3.6-1.9-3-4.5l1.2-5.4c.7-2.7 2.4-4.3 5-4.3zM6.4 8.8v1.6H4.8v1.6h1.6v1.6H8V12h1.6v-1.6H8V8.8zm10.8 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9zm-1.9 1.9a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9zm3.8 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9zm-1.9 1.9a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9z"/>`,
  buds: `<path fill-rule="evenodd" d="M6.6 3.4c2.2 0 3.9 1.5 3.9 3.6v.6c0 .9-.4 1.6-1 2.1v8.9c0 .9-.6 1.5-1.4 1.5s-1.4-.6-1.4-1.5v-7.3c-2.1-.1-3.8-1.6-3.8-3.7v-.6c0-2 1.6-3.6 3.7-3.6z${circ(5, 7.4, 1.2)}"/>` +
    `<path fill-rule="evenodd" d="M17.4 3.4c-2.2 0-3.9 1.5-3.9 3.6v.6c0 .9.4 1.6 1 2.1v8.9c0 .9.6 1.5 1.4 1.5s1.4-.6 1.4-1.5v-7.3c2.1-.1 3.8-1.6 3.8-3.7v-.6c0-2-1.6-3.6-3.7-3.6z${circ(19, 7.4, 1.2)}"/>`,
  budscase: `<path fill-rule="evenodd" d="M7.4 4.6h9.2c3.2 0 5.6 2.4 5.6 5.6v4.2c0 2.8-2.2 5-5 5H6.8c-2.8 0-5-2.2-5-5v-4.2c0-3.2 2.4-5.6 5.6-5.6zM1.9 9.4v1h20.2v-1z${circ(12, 14.4, 0.9)}"/>`,
  headphones: `<path d="M12 2.6c-5.1 0-9.2 4-9.2 9.1v2.4h2V11.7c0-4 3.2-7.1 7.2-7.1s7.2 3.1 7.2 7.1v2.4h2v-2.4c0-5.1-4.1-9.1-9.2-9.1z"/><rect x="2.2" y="12.4" width="5.6" height="9" rx="2.2"/><rect x="16.2" y="12.4" width="5.6" height="9" rx="2.2"/>`,
  speaker: hollow(`M12 2.2c3.7 0 6.6 1.4 6.6 3.4v12.8c0 2-2.9 3.4-6.6 3.4s-6.6-1.4-6.6-3.4V5.6c0-2 2.9-3.4 6.6-3.4z`, `M6.8 5.6a5.2 2 0 1 0 10.4 0a5.2 2 0 1 0 -10.4 0z`),
};
function deviceIcon(type) {
  const p = DEV_ICONS[type];
  // 沒有重畫的種類（例如「其他」）還是用 Material Symbols
  return p ? `<svg class="ms dev" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>` : icon(type);
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
