const $ = (id) => document.getElementById(id);
const BASE_H = 82;
const FIND_H = 118;
let state = { tabs: [], activeId: null };

async function init() {
  const cfg = await api.config();
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(cfg.theme)) root.setProperty(`--${k}`, v);
  if (cfg.platform !== "darwin") document.body.classList.add("no-traffic");
  document.title = cfg.name;

  api.onState(render);
  api.onFocusUrl(() => { $("url").focus(); $("url").select(); });
  api.onOpenFind(openFind);
  api.onToast(showToast);
  render(await api.state());
}

function render(s) {
  state = s;
  const tabsEl = $("tabs");
  tabsEl.textContent = "";

  for (const t of s.tabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === s.activeId ? " active" : "");
    el.dataset.id = t.id;

    const ico = document.createElement("span");
    ico.className = "ico" + (t.loading ? " spin" : "");
    if (!t.loading) {
      if (t.favicon) {
        const img = document.createElement("img");
        img.src = t.favicon;
        img.onerror = () => img.remove();
        ico.append(img);
      } else {
        ico.textContent = "◦";
      }
    }

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = t.title;

    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "✕";

    el.append(ico, title, close);
    tabsEl.append(el);
  }

  const active = s.tabs.find((t) => t.id === s.activeId);
  $("back").disabled = !s.canGoBack;
  $("forward").disabled = !s.canGoForward;
  $("reload").textContent = active && active.loading ? "✕" : "↻";
  $("star").textContent = s.bookmarked ? "★" : "☆";
  $("star").classList.toggle("on", !!s.bookmarked);
  if (document.activeElement !== $("url")) $("url").value = active ? active.url : "";
}

// Tabs
$("tabs").addEventListener("click", (e) => {
  const tabEl = e.target.closest(".tab");
  if (!tabEl) return;
  const id = Number(tabEl.dataset.id);
  if (e.target.classList.contains("close")) api.cmd("close-tab", id);
  else api.cmd("switch-tab", id);
});
$("tabs").addEventListener("auxclick", (e) => {
  const tabEl = e.target.closest(".tab");
  if (tabEl && e.button === 1) api.cmd("close-tab", Number(tabEl.dataset.id));
});
$("newtab").addEventListener("click", () => api.cmd("new-tab"));

// Toolbar
$("back").addEventListener("click", () => api.cmd("back"));
$("forward").addEventListener("click", () => api.cmd("forward"));
$("reload").addEventListener("click", () => {
  const active = state.tabs.find((t) => t.id === state.activeId);
  api.cmd(active && active.loading ? "stop" : "reload");
});
$("star").addEventListener("click", () => api.cmd("bookmark"));
$("vpn").addEventListener("click", () => api.cmd("open-internal", "vpn"));

const url = $("url");
url.addEventListener("focus", () => url.select());
url.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    api.cmd("nav", url.value);
    url.blur();
  } else if (e.key === "Escape") {
    url.blur();
    render(state);
  }
});
url.addEventListener("blur", () => render(state));

// Find in page
const findInput = $("find-input");
function openFind() {
  $("findbar").hidden = false;
  api.cmd("chrome-height", FIND_H);
  findInput.focus();
  findInput.select();
}
function closeFind() {
  $("findbar").hidden = true;
  api.cmd("chrome-height", BASE_H);
  api.cmd("find-stop");
}
findInput.addEventListener("input", () =>
  api.cmd("find", { text: findInput.value, forward: true, findNext: false })
);
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") api.cmd("find", { text: findInput.value, forward: !e.shiftKey, findNext: true });
  if (e.key === "Escape") closeFind();
});
$("find-next").addEventListener("click", () => api.cmd("find", { text: findInput.value, forward: true, findNext: true }));
$("find-prev").addEventListener("click", () => api.cmd("find", { text: findInput.value, forward: false, findNext: true }));
$("find-close").addEventListener("click", closeFind);

// Toast
let toastTimer;
function showToast(msg) {
  $("toast").textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").textContent = ""), 3000);
}

if (!window.api) {
  document.body.textContent = "Interface failed to start: preload.js did not load.";
} else {
  init().catch((err) => {
    $("toast").textContent = "Interface error: " + err.message;
  });
}
