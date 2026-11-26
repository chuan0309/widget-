// 日曆小組件的資料：只用登入的 Google 帳號（Google Calendar API，見 google.js）
// 每 15 分鐘重新讀一次；小組件、管理程式打開時會先拿快取

const REFRESH_MS = 15 * 60 * 1000;

function createCalendar({ onUpdate, google }) {
  let cache = { events: [], sources: [], at: 0 };
  let timer = null;

  function range() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1); // 這個月 1 號（月曆要用）
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 45);
    return [from, to];
  }

  const hasAny = () => !!google?.isLoggedIn();

  async function refresh() {
    if (!hasAny()) {
      cache = { events: [], sources: [], at: Date.now() };
      onUpdate?.(snapshot());
      return snapshot();
    }
    const [from, to] = range();
    let g;
    try { g = await google.fetchEvents(from, to); }
    catch (e) { g = { events: [], sources: [{ name: "Google 日曆", color: "#0a84ff", error: e.message, loginExpired: !!e.loginExpired }] }; }
    cache = { events: [...g.events].sort((a, b) => a.start - b.start), sources: g.sources, at: Date.now() };
    onUpdate?.(snapshot());
    return snapshot();
  }

  function snapshot() {
    return { needSetup: !hasAny(), events: cache.events, sources: cache.sources, at: cache.at };
  }

  async function get() {
    if (Date.now() - cache.at > REFRESH_MS || cache.at === 0) return refresh();
    return snapshot();
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS);
    refresh().catch(() => {});
  }

  return { get, refresh, start };
}

module.exports = { createCalendar };
