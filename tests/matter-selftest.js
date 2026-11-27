// CI 用：開一台模擬的 Matter 冷氣＋電扇，用 matter-home.js 配對、讀狀態、控制，確認真的有變
// 執行：node tests/matter-selftest.js（需要 IPv6；GitHub 的 Windows 電腦有）
const os = require("os");
const fs = require("fs");
const path = require("path");
const { ServerNode, Environment } = require("@matter/main");
const { RoomAirConditionerDevice, FanDevice } = require("@matter/main/devices");
const { ThermostatServer } = require("@matter/main/behaviors");
const { createMatterHome } = require("../matter-home");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gw-matter-"));
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  Environment.default.vars.set("storage.path", path.join(tmp, "device"));
  const dev = await ServerNode.create({
    id: "fake-ac", network: { port: 5550 },
    commissioning: { passcode: 20202021, discriminator: 3840 },
    productDescription: { name: "Fake AC", deviceType: RoomAirConditionerDevice.deviceType },
    basicInformation: { vendorName: "Test", vendorId: 0xfff1, productName: "Fake IR", productId: 0x8000, nodeLabel: "AC", serialNumber: "1" },
  });
  const ac = await dev.add(RoomAirConditionerDevice.with(ThermostatServer.with("Cooling", "Heating", "AutoMode")), {
    id: "ac",
    thermostat: { localTemperature: 2600, occupiedCoolingSetpoint: 2200, occupiedHeatingSetpoint: 2000, systemMode: 3, controlSequenceOfOperation: 4, minSetpointDeadBand: 0 },
  });
  const fan = await dev.add(FanDevice, { id: "fan", fanControl: { fanMode: 0, fanModeSequence: 2, percentSetting: 0, percentCurrent: 0 } });
  await dev.start();
  const code = dev.state.commissioning.pairingCodes.manualPairingCode;
  console.log("device up, code", code);

  const home = createMatterHome({ storageDir: path.join(tmp, "controller"), log: (...a) => console.log("[home]", ...a) });
  const r = await home.pair(code);
  if (!r.ok) fail("pair: " + r.error);
  let items = await home.state();
  console.log("state", JSON.stringify(items));
  const a = items.find((i) => i.kind === "ac"), f = items.find((i) => i.kind === "fan");
  if (!a || !f) fail("ac/fan not found");
  if (a.setpoint !== 22) fail("setpoint " + a.setpoint);

  await home.set(a.id, { on: false }); await sleep(500);
  if (ac.state.onOff.onOff !== false) fail("ac off");
  await home.set(a.id, { on: true, setpoint: 25 }); await sleep(500);
  if (ac.state.onOff.onOff !== true || ac.state.thermostat.occupiedCoolingSetpoint !== 2500) fail("ac on/setpoint " + ac.state.thermostat.occupiedCoolingSetpoint);
  await home.set(f.id, { pct: 60 }); await sleep(500);
  if (fan.state.fanControl.percentSetting !== 60) fail("fan pct " + fan.state.fanControl.percentSetting);
  items = await home.state();
  console.log("after", JSON.stringify(items));
  console.log("MATTER SELFTEST OK");
  await home.close();
  await dev.close();
  process.exit(0);
})().catch((e) => fail(e.stack || e));
