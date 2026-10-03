const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronPanel", {
  onReady(handler) {
    ipcRenderer.on("panel-ready", (_event, info) => handler(info));
  },
});
