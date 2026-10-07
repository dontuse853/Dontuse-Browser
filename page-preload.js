// Preload for web pages. Only the browser's own local pages (file://) get an API.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("internal", {
    config: () => ipcRenderer.invoke("config"),
    bookmarks: () => ipcRenderer.invoke("bookmarks:get"),
    go: (text) => ipcRenderer.invoke("cmd", "nav", text),
    proxyGet: () => ipcRenderer.invoke("proxy:get"),
    proxySet: (cfg) => ipcRenderer.invoke("cmd", "proxy-set", cfg),
  });
}
