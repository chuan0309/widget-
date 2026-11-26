const { contextBridge, ipcRenderer } = require("electron");

// 只開放這幾個功能給畫面用，畫面本身碰不到電腦其他東西
contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("get-state"),
  onDevices: (cb) => ipcRenderer.on("devices", (_e, list) => cb(list)),
  onPopupDevice: (cb) => ipcRenderer.on("popup:device", (_e, d) => cb(d)),
  closePopup: () => ipcRenderer.send("popup:close"),
  getPins: () => ipcRenderer.invoke("pins:get"),
  setPinterest: (url) => ipcRenderer.invoke("pins:set", url),
  resetPinterest: () => ipcRenderer.send("pins:reset"),
  openPin: (link) => ipcRenderer.send("open-pin", link),
  pinterestStatus: () => ipcRenderer.invoke("pins:status"),
  pinterestLogin: (clientId, clientSecret) => ipcRenderer.invoke("pins:login", { clientId, clientSecret }),
  pinterestBoards: () => ipcRenderer.invoke("pins:boards"),
  pinterestChoose: (source) => ipcRenderer.invoke("pins:choose", source),
  pinterestLogout: () => ipcRenderer.send("pins:logout"),
});
