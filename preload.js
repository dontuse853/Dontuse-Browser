// Preload for the browser's own interface (tabs + toolbar)
const { contextBridge, ipcRenderer } = require("electron");
const on = (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld("api", {
  config: () => ipcRenderer.invoke("config"),
  state: () => ipcRenderer.invoke("state"),
  cmd: (name, arg) => ipcRenderer.invoke("cmd", name, arg),
  onState: (cb) => on("state", cb),
  onFocusUrl: (cb) => on("focus-url", cb),
  onOpenFind: (cb) => on("open-find", cb),
  onToast: (cb) => on("toast", cb),
});
