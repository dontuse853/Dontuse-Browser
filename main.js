const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  session,
  dialog,
  clipboard,
} = require("electron");
const path = require("path");
const fs = require("fs");
const config = require("./config");

// Look like regular Chrome so sites (YouTube, Google) don't treat us as an embedded app
const pkgName = require("./package.json").name;
app.userAgentFallback = app.userAgentFallback
  .replace(/\s*Electron\/\S+/, "")
  .replace(new RegExp(`\\s*${pkgName}/\\S+`), "");
app.setName(config.NAME);

const BASE_H = 82; // tab strip (38) + toolbar (44)
let win = null;
const tabs = new Map();
let activeId = null;
let nextId = 1;
let chromeHeight = BASE_H;
let htmlFullscreen = false;

/* ---------------- Bookmarks ---------------- */

let bookmarks = null;
const bmFile = () => path.join(app.getPath("userData"), "bookmarks.json");

function getBookmarks() {
  if (bookmarks) return bookmarks;
  try {
    bookmarks = JSON.parse(fs.readFileSync(bmFile(), "utf8"));
  } catch {
    bookmarks = config.DEFAULT_BOOKMARKS.slice();
  }
  return bookmarks;
}

function saveBookmarks() {
  try {
    fs.writeFileSync(bmFile(), JSON.stringify(bookmarks, null, 2));
  } catch {}
}

function toggleBookmark() {
  const wc = activeWC();
  if (!wc) return;
  const url = wc.getURL();
  if (!url || url.startsWith("file://")) return;
  const list = getBookmarks();
  const i = list.findIndex((b) => b.url === url);
  if (i >= 0) {
    list.splice(i, 1);
    toast("Bookmark removed");
  } else {
    list.push({ title: wc.getTitle() || url, url });
    toast("Bookmarked");
  }
  saveBookmarks();
  push();
}

/* ---------------- Helpers ---------------- */

function toURL(input) {
  const t = String(input || "").trim();
  if (!t) return "internal:newtab";
  if (/^https?:\/\//i.test(t)) return t;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(t)) return "http://" + t;
  if (!/\s/.test(t) && /^[^\/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t)) return "https://" + t;
  return config.SEARCH_URL.replace("%s", encodeURIComponent(t));
}

const displayUrl = (u) => (!u || u.startsWith("file://") ? "" : u);

function loadInto(wc, target) {
  const p = target.startsWith("internal:")
    ? wc.loadFile(path.join(__dirname, `${target.slice(9)}.html`))
    : wc.loadURL(target);
  p.catch(() => {});
}

const escapeHtml = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function errorPage(desc, code, url) {
  const t = config.THEME;
  const html = `<!DOCTYPE html><meta charset="utf-8"><title>Can't load page</title>
<body style="margin:0;background:${t.bg};color:${t.text};font:15px -apple-system,system-ui,sans-serif">
<div style="max-width:560px;margin:18vh auto;padding:0 24px">
<h2 style="margin:0 0 12px">This page can't be loaded</h2>
<p style="opacity:.8;word-break:break-all">${escapeHtml(url)}</p>
<p style="color:${t.accent}">${escapeHtml(desc)} (${escapeHtml(code)})</p></div></body>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function activeWC() {
  const t = tabs.get(activeId);
  return t && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
}

function toast(msg) {
  if (win && !win.webContents.isDestroyed()) win.webContents.send("toast", msg);
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; i < 1000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

/* ---------------- State sent to the interface ---------------- */

function snapshot() {
  const list = [];
  for (const t of tabs.values()) {
    const wc = t.view.webContents;
    if (wc.isDestroyed()) continue;
    list.push({
      id: t.id,
      title: wc.getTitle() || "New Tab",
      url: displayUrl(wc.getURL()),
      loading: wc.isLoading(),
      favicon: t.favicon,
    });
  }
  const wc = activeWC();
  let canGoBack = false;
  let canGoForward = false;
  let bookmarked = false;
  if (wc) {
    canGoBack = wc.navigationHistory.canGoBack();
    canGoForward = wc.navigationHistory.canGoForward();
    const url = wc.getURL();
    bookmarked = getBookmarks().some((b) => b.url === url);
  }
  return { activeId, tabs: list, canGoBack, canGoForward, bookmarked };
}

function push() {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("state", snapshot());
}

/* ---------------- Layout ---------------- */

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const top = htmlFullscreen ? 0 : chromeHeight;
  const tab = tabs.get(activeId);
  if (tab) tab.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
}

/* ---------------- Tabs ---------------- */

function createTab(target = "internal:newtab") {
  const id = nextId++;
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "page-preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const tab = { id, view, favicon: "" };
  tabs.set(id, tab);
  wire(tab);
  loadInto(view.webContents, target);
  switchTab(id);
  return tab;
}

function wire(tab) {
  const wc = tab.view.webContents;

  for (const ev of [
    "page-title-updated",
    "did-navigate",
    "did-navigate-in-page",
    "did-start-loading",
    "did-stop-loading",
  ]) {
    wc.on(ev, () => push());
  }

  wc.on("page-favicon-updated", (_e, favicons) => {
    tab.favicon = favicons[0] || "";
    push();
  });

  wc.on("did-fail-load", (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation cancelled, not a real error
    wc.loadURL(errorPage(desc, code, failedUrl)).catch(() => {});
  });

  // Links that open a new tab/window: real popups (sign-in windows) stay popups, the rest become tabs
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === "new-window") {
      return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    }
    createTab(url);
    return { action: "deny" };
  });

  // Fullscreen video (YouTube)
  wc.on("enter-html-full-screen", () => {
    htmlFullscreen = true;
    win.setFullScreen(true);
    layout();
  });
  wc.on("leave-html-full-screen", () => {
    htmlFullscreen = false;
    win.setFullScreen(false);
    layout();
  });

  // Right-click menu
  wc.on("context-menu", (_e, params) => {
    const items = [];
    if (params.linkURL) {
      items.push(
        { label: "Open Link in New Tab", click: () => createTab(params.linkURL) },
        { label: "Copy Link Address", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" }
      );
    }
    if (params.isEditable) {
      items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" });
    } else if (params.selectionText) {
      items.push({ role: "copy" });
    }
    items.push(
      { type: "separator" },
      { label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: "Forward", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Inspect Element", click: () => wc.inspectElement(params.x, params.y) }
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function switchTab(id) {
  const next = tabs.get(id);
  if (!next) return;
  const prev = tabs.get(activeId);
  if (prev && prev !== next) win.contentView.removeChildView(prev.view);
  activeId = id;
  win.contentView.addChildView(next.view);
  layout();
  next.view.webContents.focus();
  push();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const ids = [...tabs.keys()];
  const idx = ids.indexOf(id);
  try {
    win.contentView.removeChildView(tab.view);
  } catch {}
  tabs.delete(id);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();

  if (tabs.size === 0) {
    activeId = null;
    createTab();
    return;
  }
  if (id === activeId) {
    const rest = [...tabs.keys()];
    switchTab(rest[Math.min(idx, rest.length - 1)]);
  } else {
    push();
  }
}

function stepTab(d) {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const i = ids.indexOf(activeId);
  switchTab(ids[(i + d + ids.length) % ids.length]);
}

function navigate(input) {
  const wc = activeWC();
  if (!wc) return;
  loadInto(wc, toURL(input));
  wc.focus();
}

function find(text, forward = true, findNext = false) {
  const wc = activeWC();
  if (!wc) return;
  if (!text) return wc.stopFindInPage("clearSelection");
  wc.findInPage(text, { forward, findNext });
}

function zoom(delta) {
  const wc = activeWC();
  if (!wc) return;
  wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta);
}

/* ---------------- Commands from the interface ---------------- */

function run(name, arg) {
  const wc = activeWC();
  switch (name) {
    case "new-tab": return createTab();
    case "close-tab": return closeTab(arg ?? activeId);
    case "switch-tab": return switchTab(arg);
    case "nav": return navigate(arg);
    case "back": return wc && wc.navigationHistory.goBack();
    case "forward": return wc && wc.navigationHistory.goForward();
    case "reload": return wc && wc.reload();
    case "stop": return wc && wc.stop();
    case "bookmark": return toggleBookmark();
    case "find": return find(arg.text, arg.forward, arg.findNext);
    case "find-stop": return wc && wc.stopFindInPage("clearSelection");
    case "chrome-height":
      chromeHeight = Math.min(200, Math.max(40, Number(arg) || BASE_H));
      return layout();
    case "open-internal":
      if (["vpn", "newtab"].includes(arg)) createTab(`internal:${arg}`);
      return;
  }
}

ipcMain.handle("cmd", (event, name, arg) => {
  const fromUI = win && event.sender === win.webContents;
  const fromInternalPage = [...tabs.values()].some(
    (t) => t.view.webContents === event.sender && event.sender.getURL().startsWith("file://")
  );
  if (!fromUI && !(fromInternalPage && name === "nav")) return;
  return run(name, arg);
});

ipcMain.handle("state", () => snapshot());
ipcMain.handle("bookmarks:get", () => getBookmarks());
ipcMain.handle("config", () => ({
  name: config.NAME,
  theme: config.THEME,
  platform: process.platform,
}));

/* ---------------- Menu ---------------- */

function buildMenu() {
  const numbered = [];
  for (let i = 1; i <= 8; i++) {
    numbered.push({
      label: `Go to Tab ${i}`,
      accelerator: `CmdOrCtrl+${i}`,
      visible: false,
      click: () => {
        const id = [...tabs.keys()][i - 1];
        if (id) switchTab(id);
      },
    });
  }
  numbered.push({
    label: "Go to Last Tab",
    accelerator: "CmdOrCtrl+9",
    visible: false,
    click: () => {
      const ids = [...tabs.keys()];
      switchTab(ids[ids.length - 1]);
    },
  });

  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CmdOrCtrl+T", click: () => createTab() },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => closeTab(activeId) },
        { label: "Open Location", accelerator: "CmdOrCtrl+L", click: () => win.webContents.send("focus-url") },
        { label: "Find in Page", accelerator: "CmdOrCtrl+F", click: () => win.webContents.send("open-find") },
        { label: "Bookmark This Page", accelerator: "CmdOrCtrl+D", click: () => toggleBookmark() },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => run("reload") },
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => run("back") },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => run("forward") },
        { type: "separator" },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: () => zoom(0.5) },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: () => zoom(-0.5) },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoom(0) },
        { type: "separator" },
        { role: "togglefullscreen" },
        {
          label: "Developer Tools",
          accelerator: "Alt+CmdOrCtrl+I",
          click: () => {
            const wc = activeWC();
            if (wc) wc.openDevTools({ mode: "detach" });
          },
        },
      ],
    },
    {
      label: "Tabs",
      submenu: [
        { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => stepTab(1) },
        { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => stepTab(-1) },
        { label: "Next Tab (alt)", accelerator: "CmdOrCtrl+Alt+Right", click: () => stepTab(1) },
        { label: "Previous Tab (alt)", accelerator: "CmdOrCtrl+Alt+Left", click: () => stepTab(-1) },
        { type: "separator" },
        ...numbered,
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- Window ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: config.NAME,
    backgroundColor: config.THEME.bg,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    dialog.showErrorBox("Browser interface failed to load", `${desc} (${code})\n${url}`);
  });
  win.webContents.on("preload-error", (_e, file, err) => {
    dialog.showErrorBox("Preload error", `${file}\n${err}`);
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.once("ready-to-show", () => win.show());
  win.on("resize", layout);
  win.webContents.once("did-finish-load", () => createTab());
  win.on("closed", () => {
    for (const t of tabs.values()) {
      if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    }
    tabs.clear();
    activeId = null;
    win = null;
  });
}

function setupSession() {
  const ses = session.defaultSession;

  // Permissions: allow harmless ones, ask for camera/mic/location/notifications, block the rest
  const allow = ["fullscreen", "clipboard-sanitized-write"];
  const ask = ["media", "geolocation", "notifications"];
  ses.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (allow.includes(permission)) return callback(true);
    if (ask.includes(permission)) {
      let host = "This site";
      try { host = new URL(details.requestingUrl).hostname; } catch {}
      const r = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Allow", "Block"],
        defaultId: 1,
        cancelId: 1,
        message: `${host} wants to use: ${permission}`,
      });
      return callback(r.response === 0);
    }
    callback(false);
  });

  // Downloads go straight to the Downloads folder
  ses.on("will-download", (_e, item) => {
    const savePath = uniquePath(path.join(app.getPath("downloads"), item.getFilename()));
    item.setSavePath(savePath);
    item.once("done", (_ev, state) => {
      if (state === "completed") {
        toast(`Downloaded ${path.basename(savePath)}`);
        if (app.dock) app.dock.downloadFinished(savePath);
      } else {
        toast("Download failed");
      }
    });
  });
}

app.whenReady().then(() => {
  setupSession();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (!win) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
