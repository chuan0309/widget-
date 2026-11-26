const { contextBridge, ipcRenderer } = require("electron");

// 只開放這幾個功能給畫面用，畫面本身碰不到電腦其他東西
contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("get-state"),
  onBackdrop: (cb) => ipcRenderer.on("backdrop", (_e, data) => cb(data)),
  onDevices: (cb) => ipcRenderer.on("devices", (_e, list) => cb(list)),
  onPopupDevice: (cb) => ipcRenderer.on("popup:device", (_e, d) => cb(d)),
  closePopup: () => ipcRenderer.send("popup:close"),
  getPins: () => ipcRenderer.invoke("pins:get"),
  setPinterest: (url) => ipcRenderer.invoke("pins:set", url),
  resetPinterest: () => ipcRenderer.send("pins:reset"),
  openPin: (link) => ipcRenderer.send("open-pin", link),
  onPinsChanged: (cb) => ipcRenderer.on("pins:changed", () => cb()),
  // 管理程式用
  mgrGet: () => ipcRenderer.invoke("mgr:get"),
  mgrSet: (patch) => ipcRenderer.invoke("mgr:set", patch),
  mgrResetPositions: () => ipcRenderer.send("mgr:reset-positions"),
  mgrShowWidgets: () => ipcRenderer.send("mgr:show-widgets"),
  mgrTestPopup: () => ipcRenderer.send("mgr:test-popup"),
  mgrOpenFolder: () => ipcRenderer.send("mgr:open-folder"),
  mgrQuit: () => ipcRenderer.send("mgr:quit"),
  mgrPinsChanged: () => ipcRenderer.send("mgr:pins-changed"),
  onGoto: (cb) => ipcRenderer.on("mgr:goto", (_e, section) => cb(section)),
  pinterestStatus: () => ipcRenderer.invoke("pins:status"),
  pinterestLogin: (clientId, clientSecret) => ipcRenderer.invoke("pins:login", { clientId, clientSecret }),
  pinterestBoards: () => ipcRenderer.invoke("pins:boards"),
  pinterestChoose: (source) => ipcRenderer.invoke("pins:choose", source),
  pinterestLogout: () => ipcRenderer.send("pins:logout"),
});
