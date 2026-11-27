// Matter：用 matter.js 當「第二個控制器」加入你的 Matter 設備（多重管理）
// - 不會影響 iPhone 家庭 App、Tapo App 原本的控制；完全在家裡網路，不用帳號、不經過雲端
// - 配對：在 iPhone 家庭 App 對設備按「開啟配對模式」拿到 11 碼（或 MT: 開頭的 QR 內容），貼進管理程式
// - 讀到的冷氣（溫控器）、電扇、開關會變成「家庭」小組件的方塊
// 這個檔案不依賴 Electron，CI 會拿模擬的 Matter 冷氣直接測

const path = require("path");

const KIND_ORDER = { ac: 0, fan: 1, switch: 2 };

function createMatterHome({ storageDir, log = () => {} }) {
  let M = null;           // 延後載入 matter.js（很大，用到才載）
  let controller = null;
  let starting = null;
  const nodes = new Map(); // nodeId(string) → PairedNode
  const lastMode = new Map(); // 冷氣上次的模式（關掉再開時回到這個）

  function lib() {
    if (M) return M;
    const main = require("@matter/main");
    M = {
      Environment: main.Environment,
      CommissioningController: require("@project-chip/matter.js").CommissioningController,
      types: require("@matter/main/types"),
      clusters: require("@matter/main/clusters"),
    };
    return M;
  }

  async function start() {
    if (controller) return controller;
    starting ||= (async () => {
      const { Environment, CommissioningController } = lib();
      const env = Environment.default;
      env.vars.set("storage.path", storageDir);
      env.vars.set("log.level", "warn");
      const c = new CommissioningController({
        environment: { environment: env, id: "glass-widgets" },
        autoConnect: false,
        adminFabricLabel: "Glass Widgets",
      });
      await c.start();
      controller = c;
      log("matter started", c.getCommissionedNodes().length);
      return c;
    })().finally(() => { starting = null; });
    return starting;
  }

  const hasPaired = async () => (await start()).getCommissionedNodes().length > 0;

  // 11 碼／21 碼的手動配對碼，或 QR 碼內容（MT:...）
  function parseCode(code) {
    const { ManualPairingCodeCodec, QrPairingCodeCodec } = lib().types;
    const s = String(code || "").trim();
    if (/^MT:/i.test(s)) {
      const d = QrPairingCodeCodec.decode(s.toUpperCase())[0];
      return { identifierData: { longDiscriminator: d.discriminator }, passcode: d.passcode };
    }
    const digits = s.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 21) throw new Error("配對碼要是 11 碼數字（或 MT: 開頭的 QR 內容）");
    const d = ManualPairingCodeCodec.decode(digits);
    return { identifierData: { shortDiscriminator: d.shortDiscriminator }, passcode: d.passcode };
  }

  async function pair(code, { knownAddress } = {}) {
    let parsed;
    try { parsed = parseCode(code); } catch (e) { return { error: e.message }; }
    try {
      const c = await start();
      const { GeneralCommissioning } = lib().clusters;
      const nodeId = await c.commissionNode({
        commissioning: { regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor, regulatoryCountryCode: "XX" },
        discovery: { identifierData: parsed.identifierData, discoveryCapabilities: { onIpNetwork: true }, ...(knownAddress ? { knownAddress } : {}) },
        passcode: parsed.passcode,
      });
      log("matter paired", String(nodeId));
      return { ok: true, nodeId: String(nodeId) };
    } catch (e) {
      log("matter pair failed", e.message);
      return { error: "配對失敗：" + (e.message || e) + "（配對碼 15 分鐘內有效；電腦和設備要在同一個網路）" };
    }
  }

  async function node(nodeId) {
    const key = String(nodeId);
    let n = nodes.get(key);
    if (!n) {
      n = await (await start()).getNode(nodeId);
      nodes.set(key, n);
    }
    if (!n.initialized) {
      n.connect();
      await Promise.race([
        new Promise((r) => n.events.initialized.once(r)),
        new Promise((_, rej) => setTimeout(() => rej(new Error("設備沒有回應")), 20000)),
      ]);
    }
    return n;
  }

  const cl = (ep, cluster) => ep.getClusterClient(cluster.Complete ?? cluster.Cluster ?? cluster);
  const all = (n) => [...n.parts.values()].filter((ep) => ep.getNumber?.() !== 0);

  async function nameOf(ep, n) {
    const { BridgedDeviceBasicInformation } = lib().clusters;
    try {
      const b = cl(ep, BridgedDeviceBasicInformation);
      const label = b && (await b.getNodeLabelAttribute()) || (b && (await b.getProductNameAttribute?.()));
      if (label) return label;
    } catch {}
    return ep.name && !/^endpoint/i.test(ep.name) ? ep.name : n.basicInformation?.nodeLabel || n.basicInformation?.productName || "Matter 設備";
  }

  // 所有配對過的設備 → 小組件方塊
  async function state() {
    const c = await start();
    const { OnOff, Thermostat, FanControl } = lib().clusters;
    const items = [];
    for (const id of c.getCommissionedNodes()) {
      let n;
      try { n = await node(id); }
      catch (e) { items.push({ id: `m${id}`, kind: "switch", name: "Matter 設備", room: "沒有回應", on: false, reachable: false }); continue; }
      for (const ep of all(n)) {
        const t = cl(ep, Thermostat), f = cl(ep, FanControl), o = cl(ep, OnOff);
        if (!t && !f && !o) continue;
        const base = { id: `m${id}-${ep.getNumber()}`, name: await nameOf(ep, n), room: "", reachable: true };
        try {
          if (t) {
            const mode = await t.getSystemModeAttribute();
            if (mode) lastMode.set(base.id, mode);
            const on = o ? await o.getOnOffAttribute() : mode !== 0;
            const local = await t.getLocalTemperatureAttribute().catch(() => null);
            const cool = await t.getOccupiedCoolingSetpointAttribute().catch(() => null);
            items.push({ ...base, kind: "ac", on: !!on, mode, temp: local != null ? local / 100 : null, setpoint: cool != null ? cool / 100 : null });
          } else if (f) {
            const pct = await f.getPercentSettingAttribute().catch(() => null);
            const fm = await f.getFanModeAttribute();
            const on = o ? await o.getOnOffAttribute() : fm !== 0;
            items.push({ ...base, kind: "fan", on: !!on, pct: pct ?? null });
          } else {
            items.push({ ...base, kind: "switch", on: !!(await o.getOnOffAttribute()) });
          }
        } catch (e) {
          items.push({ ...base, kind: t ? "ac" : f ? "fan" : "switch", on: false, reachable: false });
        }
      }
    }
    return items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }

  function endpointOf(id) {
    const m = String(id).match(/^m(\d+)-(\d+)$/);
    if (!m) throw new Error("不認得的設備");
    return { nodeId: m[1], ep: Number(m[2]) };
  }

  // action：{ on: true/false } ／ { setpoint: 24 } ／ { pct: 50 }
  async function set(id, action = {}) {
    try {
      const { nodeId, ep } = endpointOf(id);
      const { OnOff, Thermostat, FanControl, types } = { ...lib().clusters, types: lib().types };
      const n = await node(BigInt(nodeId));
      const e = n.parts.get(ep) || all(n).find((x) => x.getNumber() === ep);
      if (!e) throw new Error("找不到這個設備");
      const o = cl(e, OnOff), t = cl(e, Thermostat), f = cl(e, FanControl);
      if ("on" in action) {
        if (o) await (action.on ? o.on() : o.off());
        else if (t) await t.setSystemModeAttribute(action.on ? (lastMode.get(id) || 3) : 0);
        else if (f) await f.setFanModeAttribute(action.on ? 3 /* 高 */ : 0);
      }
      if (typeof action.setpoint === "number" && t) {
        const v = Math.round(Math.min(30, Math.max(16, action.setpoint)) * 100);
        await t.setOccupiedCoolingSetpointAttribute(v);
      }
      if (typeof action.pct === "number" && f) {
        await f.setPercentSettingAttribute(Math.round(Math.min(100, Math.max(0, action.pct))));
      }
      return { ok: true };
    } catch (e) {
      log("matter set failed", id, e.message);
      return { error: e.message || String(e) };
    }
  }

  async function unpairAll() {
    const c = await start();
    for (const id of c.getCommissionedNodes()) {
      try { await (await node(id)).decommission(); } catch (e) { log("matter decommission failed", e.message); }
    }
    nodes.clear();
  }

  async function close() {
    for (const n of nodes.values()) { try { n.close(); } catch {} }
    nodes.clear();
    if (controller) { try { await controller.close(); } catch {} controller = null; }
  }

  return { start, hasPaired, pair, state, set, unpairAll, close, parseCode };
}

module.exports = { createMatterHome, defaultStorage: (userData) => path.join(userData, "matter") };
