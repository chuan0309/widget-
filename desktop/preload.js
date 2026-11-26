const { contextBridge, ipcRenderer } = require("electron");

// 只開放這幾個功能給畫面用，畫面本身碰不到電腦其他東西
contextBridge.exposeInMainWorld("api", {
  getState: () => ipcRenderer.invoke("get-state"),
  onDevices: (cb) => ipcRenderer.on("devices", (_e, list) => cb(list)),
  onPopupDevice: (cb) => ipcRenderer.on("popup:device", (_e, d) => cb(d)),
  closePopup: () => ipcRenderer.send("popup:close"),
});
