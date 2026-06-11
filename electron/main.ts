import { app, BrowserWindow, WebContentsView, ipcMain } from "electron";
import path from "node:path";
import { createStore, BrowserStore, Snapshot } from "./db";

const DEV = process.env.MB_DEV === "1";
const SMOKE = process.env.MB_SMOKE === "1";

let win: BrowserWindow | null = null;
let store: BrowserStore;

const views = new Map<string, WebContentsView>();
const desiredVisible = new Set<string>();
const pendingBounds = new Map<string, Electron.Rectangle>();
let overlayActive = false;

let htmlFullscreenTabId: string | null = null;
const savedBounds = new Map<string, Electron.Rectangle>();

function applyVisibility(tabId: string): void {
  const view = views.get(tabId);
  if (!view) return;
  view.setVisible(desiredVisible.has(tabId) && !overlayActive);
}

function sendToUI(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sendTabUpdate(tabId: string, patch: Record<string, unknown>): void {
  sendToUI("tab:updated", { tabId, ...patch });
}

/**
 * Maps Chromium key input to app shortcut names. Runs on before-input-event
 * of every tab's webContents so shortcuts work even while a page has focus.
 */
function shortcutOf(input: Electron.Input): string | null {
  if (input.type !== "keyDown") return null;
  const key = (input.key || "").toLowerCase();
  const ctrl = input.control || input.meta;
  if (key === "f12") return "devtools";
  if (ctrl && !input.alt) {
    if (input.shift) {
      if (key === "t") return "reopen-tab";
      return null;
    }
    if (key >= "1" && key <= "9") return `workspace-${key}`;
    const map: Record<string, string> = {
      k: "palette",
      p: "tab-switcher",
      l: "focus-address",
      b: "toggle-sidebar",
      t: "new-tab",
      w: "close-tab",
      d: "bookmark",
      r: "reload",
    };
    if (map[key]) return map[key];
  }
  if (input.alt && !ctrl && !input.shift) {
    const map: Record<string, string> = {
      arrowleft: "split-left",
      arrowright: "split-right",
      arrowup: "split-up",
      arrowdown: "split-down",
    };
    if (map[key]) return map[key];
  }
  return null;
}

function navState(wc: Electron.WebContents): { canGoBack: boolean; canGoForward: boolean } {
  return {
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };
}

function ensureView(tabId: string, url?: string): void {
  if (!win || views.has(tabId)) return;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  views.set(tabId, view);
  view.setBackgroundColor("#ffffff");
  view.setVisible(false);
  win.contentView.addChildView(view);

  const wc = view.webContents;

  wc.setWindowOpenHandler(({ url: targetUrl }) => {
    sendToUI("tab:open", { url: targetUrl, fromTabId: tabId });
    return { action: "deny" };
  });


  wc.on("enter-html-full-screen", () => {
    if (!win) return;
    htmlFullscreenTabId = tabId;
    const view = views.get(tabId);
    if(view) savedBounds.set(tabId, view.getBounds());
    view?.setBounds({
      x: 0,
      y: 0,
      width: win.getBounds().width,
      height: win.getBounds().height,
    })
    sendToUI("views:html-fullscreen", { active: true, tabId });
  })

  wc.on("leave-html-full-screen", () => {
    if (htmlFullscreenTabId !== tabId) return;
    htmlFullscreenTabId = null;
    const view = views.get(tabId);
    const prev = savedBounds.get(tabId);
    if (view && prev) view.setBounds(prev);
    savedBounds.delete(tabId);
    sendToUI("views:html-fullscreen", { active: false, tabId });
  });

  wc.on("page-title-updated", (_event, title) => {
    sendTabUpdate(tabId, { title });
    store.touchHistoryTitle(wc.getURL(), title);
  });

  wc.on("page-favicon-updated", (_event, favicons) => {
    if (favicons.length > 0) sendTabUpdate(tabId, { favicon: favicons[0] });
  });

  wc.on("did-start-loading", () => sendTabUpdate(tabId, { loading: true }));
  wc.on("did-stop-loading", () =>
    sendTabUpdate(tabId, { loading: false, ...navState(wc) })
  );

  wc.on("did-navigate", (_event, navUrl) => {
    sendTabUpdate(tabId, { url: navUrl, ...navState(wc) });
    if (!navUrl.startsWith("about:") && !navUrl.startsWith("data:")) {
      store.addHistory(navUrl, wc.getTitle());
    }
  });

  wc.on("did-navigate-in-page", (_event, navUrl, isMainFrame) => {
    if (!isMainFrame) return;
    sendTabUpdate(tabId, { url: navUrl, ...navState(wc) });
    if (!navUrl.startsWith("about:")) store.addHistory(navUrl, wc.getTitle());
  });

  wc.on("focus", () => sendToUI("tab:focused", { tabId }));

  wc.on("before-input-event", (event, input) => {
    const shortcut = shortcutOf(input);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "devtools") {
      wc.openDevTools({ mode: "detach" });
    } else {
      sendToUI("shortcut", shortcut);
    }
  });

  const cached = pendingBounds.get(tabId);
  if (cached) {
    view.setBounds(cached);
    pendingBounds.delete(tabId);
    desiredVisible.add(tabId);
    applyVisibility(tabId);
  }

  if (url && url !== "about:blank") {
    wc.loadURL(url).catch(() => {});
  }
}

function destroyView(tabId: string): void {
  const view = views.get(tabId);
  if (!view) return;
  win?.contentView.removeChildView(view);
  view.webContents.close();
  views.delete(tabId);
  desiredVisible.delete(tabId);
  pendingBounds.delete(tabId);
}

function registerIpc(): void {
  ipcMain.handle("state:load", () => store.load());
  ipcMain.handle("state:save", (_event, snapshot: Snapshot) => store.save(snapshot));
  ipcMain.handle("history:search", (_event, query: string) =>
    store.searchHistory(query ?? "")
  );
  ipcMain.handle("bookmarks:list", () => store.listBookmarks());
  ipcMain.handle("bookmarks:add", (_event, b: { title: string; url: string }) =>
    store.addBookmark(b)
  );
  ipcMain.handle("bookmarks:remove", (_event, id: number) => store.removeBookmark(id));

  ipcMain.on("tab:ensure", (_event, { tabId, url }: { tabId: string; url?: string }) =>
    ensureView(tabId, url)
  );

  ipcMain.on(
    "tab:bounds",
    (_event, { tabId, bounds }: { tabId: string; bounds: Electron.Rectangle }) => {
      if (htmlFullscreenTabId === tabId) return;
      const view = views.get(tabId);
      if (!view) {
        pendingBounds.set(tabId, bounds);
        return;
      }
      view.setBounds(bounds);
      desiredVisible.add(tabId);
      applyVisibility(tabId);
    }
  );

  ipcMain.on("tab:hide", (_event, { tabId }: { tabId: string }) => {
    desiredVisible.delete(tabId);
    pendingBounds.delete(tabId);
    applyVisibility(tabId);
  });

  ipcMain.on("tab:close", (_event, { tabId }: { tabId: string }) => destroyView(tabId));

  ipcMain.on("tab:navigate", (_event, { tabId, url }: { tabId: string; url: string }) => {
    ensureView(tabId);
    views.get(tabId)?.webContents.loadURL(url).catch(() => {});
  });

  ipcMain.on("tab:back", (_event, { tabId }: { tabId: string }) => {
    const wc = views.get(tabId)?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  });

  ipcMain.on("tab:forward", (_event, { tabId }: { tabId: string }) => {
    const wc = views.get(tabId)?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  });

  ipcMain.on("tab:reload", (_event, { tabId }: { tabId: string }) =>
    views.get(tabId)?.webContents.reload()
  );

  ipcMain.on("tab:stop", (_event, { tabId }: { tabId: string }) =>
    views.get(tabId)?.webContents.stop()
  );

  ipcMain.on("tab:focus", (_event, { tabId }: { tabId: string }) =>
    views.get(tabId)?.webContents.focus()
  );

  ipcMain.on("tab:devtools", (_event, { tabId }: { tabId: string }) =>
    views.get(tabId)?.webContents.openDevTools({ mode: "detach" })
  );

  // The renderer's DOM (command palette, drag overlays) renders *below* native
  // WebContentsViews, so modal UI asks main to temporarily hide all views.
  ipcMain.on("views:overlay", (_event, active: boolean) => {
    overlayActive = active;
    for (const tabId of views.keys()) applyVisibility(tabId);
  });
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (DEV) {
    const devUrl = "http://localhost:5173";
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await window.loadURL(devUrl);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    console.error("[main] could not reach vite dev server at", devUrl);
  } else {
    await window.loadFile(path.join(__dirname, "../dist/renderer/index.html"));
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: "#0b0e14",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0b0e14",
      symbolColor: "#8b949e",
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  if (SMOKE) {
    win.webContents.on("console-message", (_event, level, message) => {
      console.log(`[smoke][renderer:${level}]`, message);
    });
    win.webContents.on("did-finish-load", () => {
      console.log("[smoke] renderer loaded OK");
      setTimeout(() => app.quit(), 2500);
    });
    win.webContents.on(
      "did-fail-load",
      (_event, code, desc) => console.error("[smoke] renderer FAILED to load:", code, desc)
    );
  }

  win.on("closed", () => {
    win = null;
  });

  void loadRenderer(win);
}

app.whenReady().then(() => {
  store = createStore(app.getPath("userData"));
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
