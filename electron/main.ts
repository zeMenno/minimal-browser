import { app, BrowserWindow, WebContentsView, dialog, ipcMain, net, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import extractZip from "extract-zip";
import { createStore, BrowserStore, Snapshot } from "./db";
import { isBlocked } from "./blocklist";
import { initUpdater, checkForUpdates, quitAndInstall } from "./updater";

const DEV = process.env.MB_DEV === "1";
const SMOKE = process.env.MB_SMOKE === "1";

let win: BrowserWindow | null = null;
let store: BrowserStore;

const views = new Map<string, WebContentsView>();
const desiredVisible = new Set<string>();
const pendingBounds = new Map<string, Electron.Rectangle>();
let overlayActive = false;

// Per-site zoom: a domain -> zoomLevel map persisted across launches. Applied
// to a tab's webContents on navigation so each site remembers its zoom.
let zoomByDomain: Record<string, number> = {};

// Content blocker: per-tab counts of blocked tracker/ad requests, plus a
// webContents-id -> tabId reverse lookup so webRequest can attribute hits.
let blockerEnabled = true;
const blockedCounts = new Map<string, number>();
const wcIdToTab = new Map<number, string>();
const blockerSessions = new WeakSet<Electron.Session>();

let htmlFullscreenTabId: string | null = null;
const savedBounds = new Map<string, Electron.Rectangle>();

// Pop-out: tabs whose WebContentsView has been detached into a small
// always-on-top window. The view is owned by `popWindows[tabId]` while popped,
// and the normal visibility/bounds machinery is bypassed for these tabs.
const popWindows = new Map<string, BrowserWindow>();
const poppedTabs = new Set<string>();

interface DownloadEntry {
  id: number;
  url: string;
  filename: string;
  savePath: string;
  state: string;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
}
const downloads: DownloadEntry[] = [];
let downloadSeq = 0;
const downloadSessions = new WeakSet<Electron.Session>();

// ---------------------------------------------------------------------------
// Per-site permissions: sensitive capabilities (camera, mic, location, …) are
// prompted once per origin and the decision is remembered; everything else is
// granted automatically. Without these handlers Chromium silently denies such
// requests, so these sites break with no feedback to the user.
// ---------------------------------------------------------------------------
const PROMPTED_PERMISSIONS = new Set([
  "media",
  "geolocation",
  "notifications",
  "midiSysex",
  "hid",
  "serial",
  "usb",
  "bluetooth",
  "clipboard-read",
  "display-capture",
  "window-management",
  "idle-detection",
]);

let permissionGrants: Record<string, Record<string, boolean>> = {};
interface PendingPermission {
  origin: string | null;
  permission: string;
  callback: (granted: boolean) => void;
}
const pendingPermissions = new Map<number, PendingPermission>();
let permissionSeq = 0;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function permissionLabel(
  permission: string,
  details?: { mediaTypes?: Array<"video" | "audio"> }
): string {
  if (permission === "media") {
    const types = details?.mediaTypes ?? [];
    const cam = types.includes("video");
    const mic = types.includes("audio");
    if (cam && mic) return "use your camera and microphone";
    if (cam) return "use your camera";
    if (mic) return "use your microphone";
    return "use your camera or microphone";
  }
  const map: Record<string, string> = {
    geolocation: "know your location",
    notifications: "show notifications",
    "clipboard-read": "read your clipboard",
    midiSysex: "use your MIDI devices",
    hid: "access HID devices",
    serial: "access serial ports",
    usb: "access USB devices",
    bluetooth: "access Bluetooth devices",
    "display-capture": "capture your screen",
    "window-management": "manage windows across your displays",
    "idle-detection": "detect when you are idle",
  };
  return map[permission] ?? `use ${permission}`;
}

function attachPermissionHandlers(sess: Electron.Session): void {
  sess.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!PROMPTED_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    const origin = originOf(details.requestingUrl || wc?.getURL() || "");
    // A remembered decision for this origin short-circuits the prompt.
    if (origin && permissionGrants[origin]?.[permission] !== undefined) {
      callback(permissionGrants[origin][permission]);
      return;
    }
    if (!win || win.isDestroyed()) {
      callback(false);
      return;
    }
    const id = ++permissionSeq;
    pendingPermissions.set(id, { origin, permission, callback });
    sendToUI("permission:request", {
      id,
      origin: origin ?? "This site",
      permission,
      label: permissionLabel(permission, details as { mediaTypes?: Array<"video" | "audio"> }),
      tabId: wc ? wcIdToTab.get(wc.id) : undefined,
    });
  });

  sess.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (!PROMPTED_PERMISSIONS.has(permission)) return true;
    return !!(requestingOrigin && permissionGrants[requestingOrigin]?.[permission] === true);
  });
}

// ---------------------------------------------------------------------------
// Scroll restore: each tab's scroll offset is captured (keyed by URL) and
// persisted, then re-applied when the same URL finishes loading — so reopened
// tabs, reactivated suspended tabs and a relaunched app all land where you
// left off. Keyed by URL so navigating to a *different* page doesn't jump.
// ---------------------------------------------------------------------------
let scrollByTab: Record<string, { url: string; x: number; y: number }> = {};
let scrollPersistTimer: NodeJS.Timeout | null = null;

function persistScroll(): void {
  if (scrollPersistTimer) return;
  scrollPersistTimer = setTimeout(() => {
    scrollPersistTimer = null;
    if (store) store.setSetting("scrollByTab", JSON.stringify(scrollByTab));
  }, 4000);
}

async function captureScroll(tabId: string): Promise<void> {
  const wc = views.get(tabId)?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const url = wc.getURL();
  if (!url || url.startsWith("about:")) return;
  try {
    const pos = (await wc.executeJavaScript("[window.scrollX, window.scrollY]")) as
      | [number, number]
      | null;
    if (Array.isArray(pos) && typeof pos[0] === "number" && typeof pos[1] === "number") {
      scrollByTab[tabId] = { url, x: Math.round(pos[0]), y: Math.round(pos[1]) };
      persistScroll();
    }
  } catch {
    // page not ready or navigated away — ignore
  }
}

// A URL the OS handed us (default-browser launch / protocol link) before the
// renderer was ready to receive it.
let pendingOpenUrl: string | null = null;

// ---------------------------------------------------------------------------
// URL schemes: web pages load inside a WebContentsView; anything else
// (spotify:, vscode:, mailto:, slack:, …) is handed to the OS so the matching
// desktop app can open it — just like a normal browser.
// ---------------------------------------------------------------------------
const WEB_SCHEMES = new Set([
  "http",
  "https",
  "about",
  "data",
  "file",
  "view-source",
  "chrome",
  "devtools",
  "blob",
  "chrome-extension",
  "filesystem",
]);

function schemeOf(url: string): string | null {
  // Require a 2+ char scheme so Windows drive letters ("C:\…") aren't treated
  // as protocols. Real app schemes (spotify:, vscode:, mailto:) are longer.
  const m = /^([a-z][a-z0-9+.-]+):/i.exec((url ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

function isExternalProtocol(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme !== null && !WEB_SCHEMES.has(scheme);
}

function openExternalApp(url: string): void {
  void shell.openExternal(url).catch(() => {});
}

// ---------------------------------------------------------------------------
// Themed page scrollbars: a page's scrollbar lives inside the Chromium view,
// so the app's CSS can't reach it. We inject a pill scrollbar styled with the
// active theme accent into every page and re-inject when the theme changes.
// ---------------------------------------------------------------------------
let scrollbarAccent = "#7aa2f7";
const scrollbarCssKeys = new Map<string, string>();

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return [122, 162, 247];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function scrollbarCss(accent: string): string {
  const [r, g, b] = hexToRgb(accent);
  // No !important: sites that intentionally theme their own scrollbars win.
  return `
    ::-webkit-scrollbar { width: 12px; height: 12px; }
    ::-webkit-scrollbar-thumb {
      background: rgba(${r}, ${g}, ${b}, 0.45);
      border-radius: 999px;
      border: 3px solid transparent;
      background-clip: padding-box;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(${r}, ${g}, ${b}, 0.7); }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-corner { background: transparent; }
  `;
}

async function injectScrollbar(tabId: string): Promise<void> {
  const view = views.get(tabId);
  if (!view || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  const previous = scrollbarCssKeys.get(tabId);
  try {
    const key = await wc.insertCSS(scrollbarCss(scrollbarAccent));
    scrollbarCssKeys.set(tabId, key);
    if (previous) await wc.removeInsertedCSS(previous).catch(() => {});
  } catch {
    // page navigated away or isn't ready yet; the next dom-ready re-injects
  }
}

// ---------------------------------------------------------------------------
// Extensions: unpacked Chrome extensions loaded into every workspace session.
// Electron supports a subset of the chrome.* APIs (content scripts work well;
// browser-action popups and Web Store installs do not).
// ---------------------------------------------------------------------------
const knownSessions = new Set<Electron.Session>();
let extensionPaths: string[] = [];

/** Electron ≥36 moved extension methods to ses.extensions; support both. */
function extensionApi(sess: Electron.Session): {
  loadExtension(dir: string, opts?: { allowFileAccess?: boolean }): Promise<Electron.Extension>;
  removeExtension(id: string): void;
  getAllExtensions(): Electron.Extension[];
} {
  const anySess = sess as unknown as { extensions?: never };
  return (anySess.extensions ?? sess) as ReturnType<typeof extensionApi>;
}

async function loadExtensionInto(sess: Electron.Session, dir: string): Promise<string | null> {
  try {
    const already = extensionApi(sess)
      .getAllExtensions()
      .find((e) => path.normalize(e.path) === path.normalize(dir));
    if (already) return null;
    await extensionApi(sess).loadExtension(dir, { allowFileAccess: true });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[ext] failed to load ${dir}:`, message);
    return message;
  }
}

/** One-time setup for each (possibly partitioned) session. */
function prepareSession(sess: Electron.Session): void {
  if (knownSessions.has(sess)) return;
  knownSessions.add(sess);
  attachDownloadHandler(sess);
  attachContentBlocker(sess);
  attachPermissionHandlers(sess);
  for (const dir of extensionPaths) void loadExtensionInto(sess, dir);
}

/** Cancel requests to known tracker/ad hosts and tally per-tab hits. */
function attachContentBlocker(sess: Electron.Session): void {
  if (blockerSessions.has(sess)) return;
  blockerSessions.add(sess);
  sess.webRequest.onBeforeRequest((details, callback) => {
    if (!blockerEnabled || !details.url || !isBlocked(details.url)) {
      callback({});
      return;
    }
    const tabId = details.webContentsId ? wcIdToTab.get(details.webContentsId) : undefined;
    if (tabId) {
      const next = (blockedCounts.get(tabId) ?? 0) + 1;
      blockedCounts.set(tabId, next);
      sendTabUpdate(tabId, { blocked: next });
    }
    callback({ cancel: true });
  });
}

/** Track downloads on a session (workspaces have separate partitions). */
function attachDownloadHandler(sess: Electron.Session): void {
  if (downloadSessions.has(sess)) return;
  downloadSessions.add(sess);
  sess.on("will-download", (_event, item) => {
    const entry: DownloadEntry = {
      id: ++downloadSeq,
      url: item.getURL(),
      filename: item.getFilename(),
      savePath: "",
      state: "progressing",
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    downloads.unshift(entry);
    if (downloads.length > 100) downloads.pop();
    const notify = () => sendToUI("download:updated", { ...entry });
    item.on("updated", (_ev, state) => {
      entry.state = state === "interrupted" ? "interrupted" : "progressing";
      entry.receivedBytes = item.getReceivedBytes();
      entry.savePath = item.getSavePath();
      notify();
    });
    item.once("done", (_ev, state) => {
      entry.state = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.savePath = item.getSavePath();
      notify();
    });
    notify();
  });
}

function applyVisibility(tabId: string): void {
  if (poppedTabs.has(tabId)) return;
  const view = views.get(tabId);
  if (!view) return;
  // While a tab is in HTML fullscreen it covers the whole window; every other
  // tab's view must be hidden so split-view siblings don't show through.
  if (htmlFullscreenTabId !== null) {
    view.setVisible(tabId === htmlFullscreenTabId);
    return;
  }
  view.setVisible(desiredVisible.has(tabId) && !overlayActive);
}

function sendToUI(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sendTabUpdate(tabId: string, patch: Record<string, unknown>): void {
  sendToUI("tab:updated", { tabId, ...patch });
}

/** Pull the first http(s) or external-app URL out of a launch argv. */
function urlFromArgv(argv: string[]): string | null {
  // argv[0] is the executable (electron.exe in dev); never treat it as a URL.
  for (const arg of argv.slice(1)) {
    // Skip switches ("--foo") and filesystem paths ("C:\…", ".", "/abs").
    if (arg.startsWith("-") || /^([a-z]:[\\/]|[.\\/])/i.test(arg)) continue;
    if (/^https?:\/\//i.test(arg) || isExternalProtocol(arg)) return arg;
  }
  return null;
}

/**
 * Open a URL the OS handed us (default-browser launch or `open-url`). If the
 * renderer isn't ready yet we stash it and flush once it has loaded.
 */
function openUrlInUI(url: string): void {
  if (!win || win.webContents.isLoading()) {
    pendingOpenUrl = url;
    return;
  }
  if (win.isMinimized()) win.restore();
  win.focus();
  sendToUI("tab:open", { url, active: true });
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
  // Ctrl+Alt+Arrow moves keyboard focus between split panes.
  if (ctrl && input.alt && !input.shift) {
    const map: Record<string, string> = {
      arrowleft: "focus-pane-left",
      arrowright: "focus-pane-right",
      arrowup: "focus-pane-up",
      arrowdown: "focus-pane-down",
    };
    if (map[key]) return map[key];
  }
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
      f: "find",
      "0": "zoom-reset",
      "=": "zoom-in",
      "+": "zoom-in",
      "-": "zoom-out",
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

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Apply the stored zoom for a tab's current domain (default 0 if none). */
function applyZoom(tabId: string): void {
  const wc = views.get(tabId)?.webContents;
  if (!wc || wc.isDestroyed()) return;
  const domain = domainOf(wc.getURL());
  const level = domain ? zoomByDomain[domain] ?? 0 : 0;
  wc.setZoomLevel(level);
}

function navState(wc: Electron.WebContents): { canGoBack: boolean; canGoForward: boolean } {
  return {
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };
}

function ensureView(tabId: string, url?: string, partition?: string): void {
  if (!win || views.has(tabId)) return;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Each workspace gets its own persistent session (cookies/logins)
      ...(partition ? { partition } : {}),
    },
  });
  views.set(tabId, view);
  view.setBackgroundColor("#ffffff");
  view.setVisible(false);
  win.contentView.addChildView(view);

  const wc = view.webContents;
  wcIdToTab.set(wc.id, tabId);
  prepareSession(wc.session);

  wc.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isExternalProtocol(targetUrl)) {
      openExternalApp(targetUrl);
      return { action: "deny" };
    }
    sendToUI("tab:open", { url: targetUrl, fromTabId: tabId });
    return { action: "deny" };
  });

  // In-page links to external apps (spotify:, vscode:, mailto:, …) never load
  // as a page; intercept the navigation and let the OS open the app instead.
  wc.on("will-navigate", (event, navUrl) => {
    if (isExternalProtocol(navUrl)) {
      event.preventDefault();
      openExternalApp(navUrl);
    }
  });

  wc.on("dom-ready", () => void injectScrollbar(tabId));

  // Restore the saved scroll offset once the same page has finished loading.
  wc.on("did-finish-load", () => {
    const pos = scrollByTab[tabId];
    if (pos && pos.url === wc.getURL() && (pos.x || pos.y)) {
      wc.executeJavaScript(`window.scrollTo(${pos.x}, ${pos.y})`).catch(() => {});
    }
  });


  wc.on("enter-html-full-screen", () => {
    if (!win) return;
    htmlFullscreenTabId = tabId;
    const view = views.get(tabId);
    if(view) savedBounds.set(tabId, view.getBounds());
    if (view) {
      view.setBounds({
        x: 0,
        y: 0,
        width: win.getBounds().width,
        height: win.getBounds().height,
      });
      // Raise above sibling views and hide the rest of the split.
      win.contentView.addChildView(view);
    }
    for (const id of views.keys()) applyVisibility(id);
    sendToUI("views:html-fullscreen", { active: true, tabId });
  })

  wc.on("leave-html-full-screen", () => {
    if (htmlFullscreenTabId !== tabId) return;
    htmlFullscreenTabId = null;
    const view = views.get(tabId);
    const prev = savedBounds.get(tabId);
    if (view && prev) view.setBounds(prev);
    savedBounds.delete(tabId);
    // Restore the normal visibility of every split-view sibling.
    for (const id of views.keys()) applyVisibility(id);
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
    // Each top-level navigation starts a fresh blocked-request tally.
    blockedCounts.set(tabId, 0);
    applyZoom(tabId);
    sendTabUpdate(tabId, { url: navUrl, blocked: 0, ...navState(wc) });
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

  // Audio indicator: fires whenever the tab starts/stops producing sound, so
  // the sidebar can show a speaker glyph. Electron has shipped two signatures
  // for this event ((event, audible) and ({ audible })); handle both.
  wc.on("audio-state-changed", (...args: unknown[]) => {
    const first = args[0] as { audible?: boolean } | undefined;
    const audible =
      first && typeof first === "object" && "audible" in first
        ? Boolean(first.audible)
        : Boolean(args[1]);
    sendTabUpdate(tabId, { audible });
  });

  wc.on("found-in-page", (_event, result) => {
    sendToUI("tab:found", {
      tabId,
      matches: result.matches,
      active: result.activeMatchOrdinal,
    });
  });

  wc.on("before-input-event", (event, input) => {
    const shortcut = shortcutOf(input);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "devtools") {
      wc.openDevTools({ mode: "detach" });
      return;
    }
    // Shortcuts that open UI in the renderer need keyboard focus moved off
    // the page's webContents first, or the renderer input never receives keys.
    if (["palette", "tab-switcher", "focus-address", "find"].includes(shortcut)) {
      win?.webContents.focus();
    }
    sendToUI("shortcut", shortcut);
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

/** Detach a tab's view into a small always-on-top window. */
function popOutView(tabId: string): void {
  if (!win || poppedTabs.has(tabId)) return;
  const view = views.get(tabId);
  if (!view) return;
  poppedTabs.add(tabId);
  win.contentView.removeChildView(view);

  const popWin = new BrowserWindow({
    width: 480,
    height: 320,
    minWidth: 240,
    minHeight: 160,
    alwaysOnTop: true,
    backgroundColor: "#0b0e14",
    title: "Pop-out",
  });
  popWin.setMenuBarVisibility(false);
  popWindows.set(tabId, popWin);
  popWin.contentView.addChildView(view);

  const fit = () => {
    if (popWin.isDestroyed()) return;
    const b = popWin.getContentBounds();
    view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
    view.setVisible(true);
  };
  fit();
  popWin.on("resize", fit);

  let handled = false;
  popWin.on("close", () => {
    if (handled) return;
    handled = true;
    if (!popWin.isDestroyed()) popWin.contentView.removeChildView(view);
    reattachPoppedView(tabId);
  });
}

/** Return a popped-out view to the main window and tell the UI to re-place it. */
function reattachPoppedView(tabId: string): void {
  poppedTabs.delete(tabId);
  popWindows.delete(tabId);
  const view = views.get(tabId);
  if (!view || !win || win.isDestroyed()) return;
  win.contentView.addChildView(view);
  view.setVisible(false);
  applyVisibility(tabId);
  sendToUI("tab:popin", { tabId });
}

function destroyView(tabId: string): void {
  const view = views.get(tabId);
  if (!view) return;
  if (poppedTabs.has(tabId)) {
    poppedTabs.delete(tabId);
    const popWin = popWindows.get(tabId);
    popWindows.delete(tabId);
    if (popWin && !popWin.isDestroyed()) {
      popWin.removeAllListeners("close");
      popWin.contentView.removeChildView(view);
      popWin.destroy();
    }
  }
  win?.contentView.removeChildView(view);
  if (!view.webContents.isDestroyed()) {
    wcIdToTab.delete(view.webContents.id);
    view.webContents.close();
  }
  views.delete(tabId);
  desiredVisible.delete(tabId);
  pendingBounds.delete(tabId);
  scrollbarCssKeys.delete(tabId);
  blockedCounts.delete(tabId);
}

/**
 * Live search suggestions from Google's autocomplete endpoint. Runs in the
 * main process so there are no CORS restrictions. Uses `client=firefox`, which
 * returns a compact JSON array: [query, [suggestion, …]]. Always resolves
 * (empty array on any failure or timeout) so the address bar degrades to
 * local-only results gracefully.
 */
function fetchSearchSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      request.abort();
      done([]);
    }, 2500);

    const url =
      "https://suggestqueries.google.com/complete/search?client=firefox&q=" +
      encodeURIComponent(q);
    const request = net.request(url);
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        response.on("data", () => {});
        response.on("end", () => done([]));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const list = Array.isArray(parsed) && Array.isArray(parsed[1]) ? parsed[1] : [];
          done(list.filter((s: unknown): s is string => typeof s === "string").slice(0, 10));
        } catch {
          done([]);
        }
      });
    });
    request.on("error", () => done([]));
    request.end();
  });
}

/**
 * Current weather for the Netherlands (Amsterdam) from Open-Meteo's free,
 * key-less API. Fetched in the main process so the start page has no CORS
 * concerns. Resolves to null on any failure so the UI degrades gracefully.
 */
function fetchWeather(): Promise<{ temperature: number; code: number; location: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: { temperature: number; code: number; location: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      request.abort();
      done(null);
    }, 4000);

    const url =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=52.37&longitude=4.90&current=temperature_2m,weather_code";
    const request = net.request(url);
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        response.on("data", () => {});
        response.on("end", () => done(null));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const cur = parsed?.current;
          if (cur && typeof cur.temperature_2m === "number") {
            done({
              temperature: cur.temperature_2m,
              code: typeof cur.weather_code === "number" ? cur.weather_code : 0,
              location: "Amsterdam",
            });
          } else {
            done(null);
          }
        } catch {
          done(null);
        }
      });
    });
    request.on("error", () => done(null));
    request.end();
  });
}

function registerIpc(): void {
  ipcMain.handle("state:load", () => store.load());
  ipcMain.handle("state:save", (_event, snapshot: Snapshot) => store.save(snapshot));
  ipcMain.handle("history:search", (_event, query: string) =>
    store.searchHistory(query ?? "")
  );
  ipcMain.handle("history:autocomplete", (_event, query: string) =>
    store.autocompleteHistory(query ?? "")
  );
  ipcMain.handle("suggest:fetch", (_event, query: string) => fetchSearchSuggestions(query ?? ""));
  ipcMain.handle("weather:fetch", () => fetchWeather());
  ipcMain.on(
    "permission:respond",
    (
      _event,
      { id, granted, remember }: { id: number; granted: boolean; remember: boolean }
    ) => {
      const pending = pendingPermissions.get(id);
      if (!pending) return;
      pendingPermissions.delete(id);
      pending.callback(!!granted);
      if (remember && pending.origin) {
        permissionGrants[pending.origin] = {
          ...permissionGrants[pending.origin],
          [pending.permission]: !!granted,
        };
        store.setSetting("permissionGrants", JSON.stringify(permissionGrants));
      }
    }
  );

  ipcMain.handle("blocker:state", () => ({ enabled: blockerEnabled }));
  ipcMain.handle("blocker:toggle", () => {
    blockerEnabled = !blockerEnabled;
    store.setSetting("blockerEnabled", blockerEnabled ? "1" : "0");
    return { enabled: blockerEnabled };
  });
  ipcMain.handle("bookmarks:list", () => store.listBookmarks());
  ipcMain.handle("bookmarks:add", (_event, b: { title: string; url: string }) =>
    store.addBookmark(b)
  );
  ipcMain.handle("bookmarks:remove", (_event, id: number) => store.removeBookmark(id));

  // Full-text search across the live (non-suspended) tabs in every workspace.
  // Each view reports whether its page text contains the query, plus a snippet.
  ipcMain.handle("tabs:searchContent", async (_event, query: string) => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return [];
    const code = `(() => {
      const t = (document.body && document.body.innerText) || '';
      const i = t.toLowerCase().indexOf(${JSON.stringify(q)});
      if (i < 0) return null;
      const start = Math.max(0, i - 40);
      return t.slice(start, i + ${q.length} + 80).replace(/\\s+/g, ' ').trim();
    })()`;
    const results: { tabId: string; snippet: string }[] = [];
    await Promise.all(
      [...views.entries()].map(async ([tabId, view]) => {
        const wc = view.webContents;
        if (wc.isDestroyed()) return;
        const url = wc.getURL();
        if (!url || url.startsWith("about:")) return;
        try {
          const snippet = (await wc.executeJavaScript(code)) as string | null;
          if (typeof snippet === "string" && snippet) results.push({ tabId, snippet });
        } catch {
          // page not ready / cross-origin frame restrictions — skip
        }
      })
    );
    return results;
  });

  ipcMain.on(
    "tab:ensure",
    (
      _event,
      { tabId, url, partition }: { tabId: string; url?: string; partition?: string }
    ) => ensureView(tabId, url, partition)
  );

  // Suspend = destroy the native view but keep the tab's data in the renderer.
  // Refuses while the page is playing audio so music tabs survive.
  ipcMain.on("tab:suspend", (_event, { tabId }: { tabId: string }) => {
    const view = views.get(tabId);
    if (!view || htmlFullscreenTabId === tabId) return;
    if (view.webContents.isCurrentlyAudible()) return;
    destroyView(tabId);
    sendToUI("tab:suspended", { tabId });
  });

  ipcMain.on(
    "tab:bounds",
    (_event, { tabId, bounds }: { tabId: string; bounds: Electron.Rectangle }) => {
      if (htmlFullscreenTabId === tabId || poppedTabs.has(tabId)) return;
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
    if (poppedTabs.has(tabId)) return;
    // Capture the scroll offset before the view is hidden / later suspended.
    void captureScroll(tabId);
    desiredVisible.delete(tabId);
    pendingBounds.delete(tabId);
    applyVisibility(tabId);
  });

  ipcMain.on("tab:popout", (_event, { tabId }: { tabId: string }) => popOutView(tabId));

  ipcMain.on("tab:close", (_event, { tabId }: { tabId: string }) => {
    // A permanently closed tab no longer needs its remembered scroll offset.
    delete scrollByTab[tabId];
    destroyView(tabId);
  });

  ipcMain.on(
    "tab:navigate",
    (
      _event,
      { tabId, url, partition }: { tabId: string; url: string; partition?: string }
    ) => {
      if (isExternalProtocol(url)) {
        openExternalApp(url);
        return;
      }
      ensureView(tabId, undefined, partition);
      views.get(tabId)?.webContents.loadURL(url).catch(() => {});
    }
  );

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

  ipcMain.on(
    "tab:setMuted",
    (_event, { tabId, muted }: { tabId: string; muted: boolean }) => {
      const wc = views.get(tabId)?.webContents;
      if (!wc || wc.isDestroyed()) return;
      wc.setAudioMuted(muted);
      sendTabUpdate(tabId, { muted });
    }
  );

  // Toggle Picture-in-Picture for the tab's most relevant video. Runs with a
  // simulated user gesture (2nd arg) so requestPictureInPicture() is allowed.
  ipcMain.on("tab:pip", (_event, { tabId }: { tabId: string }) => {
    const wc = views.get(tabId)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const code = `(() => {
      if (document.pictureInPictureElement) { document.exitPictureInPicture(); return; }
      const vids = Array.from(document.querySelectorAll('video'));
      if (!vids.length) return;
      const v = vids.find((x) => !x.paused && !x.ended) ||
        vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (v && v.requestPictureInPicture) v.requestPictureInPicture().catch(() => {});
    })()`;
    wc.executeJavaScript(code, true).catch(() => {});
  });

  // Play/pause the tab's media: pause everything that's playing, else play.
  ipcMain.on("tab:mediaToggle", (_event, { tabId }: { tabId: string }) => {
    const wc = views.get(tabId)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const code = `(() => {
      const media = Array.from(document.querySelectorAll('video, audio'));
      if (!media.length) return;
      const playing = media.filter((m) => !m.paused && !m.ended);
      if (playing.length) playing.forEach((m) => m.pause());
      else { const m = media[0]; if (m.play) m.play().catch(() => {}); }
    })()`;
    wc.executeJavaScript(code, true).catch(() => {});
  });

  ipcMain.on(
    "tab:zoom",
    (_event, { tabId, dir }: { tabId: string; dir: "in" | "out" | "reset" }) => {
      const wc = views.get(tabId)?.webContents;
      if (!wc || wc.isDestroyed()) return;
      const domain = domainOf(wc.getURL());
      const current = domain ? zoomByDomain[domain] ?? 0 : wc.getZoomLevel();
      let next: number;
      if (dir === "reset") next = 0;
      else next = Math.max(-3, Math.min(5, current + (dir === "in" ? 0.5 : -0.5)));
      wc.setZoomLevel(next);
      if (domain) {
        if (next === 0) delete zoomByDomain[domain];
        else zoomByDomain[domain] = next;
        store.setSetting("zoomByDomain", JSON.stringify(zoomByDomain));
      }
    }
  );

  ipcMain.on("tab:devtools", (_event, { tabId }: { tabId: string }) =>
    views.get(tabId)?.webContents.openDevTools({ mode: "detach" })
  );

  ipcMain.on(
    "tab:find",
    (
      _event,
      {
        tabId,
        text,
        forward,
        findNext,
      }: { tabId: string; text: string; forward: boolean; findNext: boolean }
    ) => {
      if (text) views.get(tabId)?.webContents.findInPage(text, { forward, findNext });
    }
  );

  ipcMain.on("tab:stopFind", (_event, { tabId }: { tabId: string }) =>
    views.get(tabId)?.webContents.stopFindInPage("clearSelection")
  );

  ipcMain.on("tab:openExternal", (_event, { url }: { url: string }) => {
    if (/^https?:\/\//i.test(url) || isExternalProtocol(url)) openExternalApp(url);
  });

  ipcMain.handle("extensions:add", async () => {
    if (!win) return { ok: false, error: "No window" };
    const result = await dialog.showOpenDialog(win, {
      title: "Select an unpacked extension folder (contains manifest.json)",
      properties: ["openDirectory"],
    });
    const dir = result.filePaths[0];
    if (result.canceled || !dir) return { ok: false };
    return installExtensionDir(dir);
  });

  // Install straight from a Chrome Web Store URL: download the .crx from
  // Google's update endpoint, strip the CRX header, unzip, load unpacked.
  ipcMain.handle("extensions:addFromUrl", async (_event, input: string) => {
    try {
      const id = (input ?? "").match(/[a-p]{32}/)?.[0];
      if (!id) return { ok: false, error: "No extension id found in that URL" };
      const crxUrl =
        `https://clients2.google.com/service/update2/crx?response=redirect` +
        `&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
      const response = await fetch(crxUrl, { redirect: "follow" });
      if (!response.ok) return { ok: false, error: `Download failed (HTTP ${response.status})` };
      const buf = Buffer.from(await response.arrayBuffer());
      const zipStart = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      if (zipStart < 0) return { ok: false, error: "Downloaded file is not a valid extension" };

      const extRoot = path.join(app.getPath("userData"), "extensions");
      const dir = path.join(extRoot, id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const zipPath = path.join(extRoot, `${id}.zip`);
      fs.writeFileSync(zipPath, buf.subarray(zipStart));
      await extractZip(zipPath, { dir });
      fs.rmSync(zipPath, { force: true });
      // Web Store packaging metadata confuses Chromium's unpacked loader
      fs.rmSync(path.join(dir, "_metadata"), { recursive: true, force: true });

      return await installExtensionDir(dir);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("extensions:list", () =>
    extensionPaths.map((dir) => {
      for (const sess of knownSessions) {
        const ext = extensionApi(sess)
          .getAllExtensions()
          .find((e) => path.normalize(e.path) === path.normalize(dir));
        if (ext) return { path: dir, name: ext.name, version: ext.version };
      }
      return { path: dir, name: path.basename(dir), version: "" };
    })
  );

  ipcMain.handle("extensions:remove", (_event, dir: string) => {
    extensionPaths = extensionPaths.filter((p) => p !== dir);
    store.setSetting("extensions", JSON.stringify(extensionPaths));
    for (const sess of knownSessions) {
      const ext = extensionApi(sess)
        .getAllExtensions()
        .find((e) => path.normalize(e.path) === path.normalize(dir));
      if (ext) extensionApi(sess).removeExtension(ext.id);
    }
    return true;
  });

  ipcMain.handle("downloads:list", () => downloads);
  ipcMain.handle("downloads:open", (_event, id: number) => {
    const d = downloads.find((x) => x.id === id);
    if (d?.savePath && d.state === "completed") void shell.openPath(d.savePath);
  });
  ipcMain.handle("downloads:show", (_event, id: number) => {
    const d = downloads.find((x) => x.id === id);
    if (d?.savePath) shell.showItemInFolder(d.savePath);
  });

  ipcMain.on(
    "window:titlebar",
    (_event, { color, symbolColor }: { color: string; symbolColor: string }) => {
      try {
        win?.setTitleBarOverlay({ color, symbolColor, height: 38 });
      } catch {
        // not supported on this platform
      }
    }
  );

  // The renderer's DOM (command palette, drag overlays) renders *below* native
  // WebContentsViews, so modal UI asks main to temporarily hide all views.
  ipcMain.on("views:overlay", (_event, active: boolean) => {
    overlayActive = active;
    for (const tabId of views.keys()) applyVisibility(tabId);
  });

  ipcMain.on("views:scrollbar", (_event, { accent }: { accent: string }) => {
    if (accent) scrollbarAccent = accent;
    for (const tabId of views.keys()) void injectScrollbar(tabId);
  });

  // Default-browser registration. setAsDefaultProtocolClient claims the
  // http/https ProgID for the current user; on Windows the StartMenuInternet
  // capabilities written by the installer let us appear in the "Default apps"
  // list, which we open so the user can confirm the choice.
  ipcMain.handle("app:setDefaultBrowser", () => {
    app.setAsDefaultProtocolClient("http");
    app.setAsDefaultProtocolClient("https");
    if (process.platform === "win32") void shell.openExternal("ms-settings:defaultapps");
    return {
      http: app.isDefaultProtocolClient("http"),
      https: app.isDefaultProtocolClient("https"),
    };
  });

  ipcMain.handle("app:isDefaultBrowser", () => ({
    http: app.isDefaultProtocolClient("http"),
    https: app.isDefaultProtocolClient("https"),
  }));

  // Manual "check for updates"; the auto-updater also polls on its own. A no-op
  // in dev/unpackaged builds where the updater was never initialised.
  ipcMain.handle("update:check", () => {
    if (app.isPackaged) checkForUpdates();
    return { checking: app.isPackaged };
  });
  // Restart into the downloaded update (green-arrow click).
  ipcMain.on("update:install", () => quitAndInstall());
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

  win.webContents.on("did-finish-load", () => {
    if (!pendingOpenUrl) return;
    const url = pendingOpenUrl;
    pendingOpenUrl = null;
    // Give the renderer a beat to mount its IPC listeners before delivering.
    setTimeout(() => sendToUI("tab:open", { url, active: true }), 400);
  });

  win.on("closed", () => {
    win = null;
  });

  void loadRenderer(win);
}

async function installExtensionDir(
  dir: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!fs.existsSync(path.join(dir, "manifest.json"))) {
    return { ok: false, error: "That folder has no manifest.json" };
  }
  if (!extensionPaths.includes(dir)) {
    extensionPaths.push(dir);
    store.setSetting("extensions", JSON.stringify(extensionPaths));
  }
  let error: string | null = null;
  for (const sess of knownSessions) {
    error = (await loadExtensionInto(sess, dir)) ?? error;
  }
  if (error) {
    extensionPaths = extensionPaths.filter((p) => p !== dir);
    store.setSetting("extensions", JSON.stringify(extensionPaths));
    return { ok: false, error };
  }
  return { ok: true, name: extensionNameOf(dir) };
}

function extensionNameOf(dir: string): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    return typeof manifest.name === "string" ? manifest.name : path.basename(dir);
  } catch {
    return path.basename(dir);
  }
}

// A single instance owns the window; a second launch (e.g. clicking a link
// while we're the default browser) forwards its URL to the running instance.
const gotSingleInstanceLock = SMOKE || app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = urlFromArgv(argv);
    if (url) {
      openUrlInUI(url);
    } else if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // macOS delivers protocol/file opens through this event.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    openUrlInUI(url);
  });

  app.whenReady().then(() => {
    store = createStore(app.getPath("userData"));
    try {
      extensionPaths = JSON.parse(store.getSetting("extensions") ?? "[]");
      if (!Array.isArray(extensionPaths)) extensionPaths = [];
    } catch {
      extensionPaths = [];
    }
    blockerEnabled = store.getSetting("blockerEnabled") !== "0";
    try {
      zoomByDomain = JSON.parse(store.getSetting("zoomByDomain") ?? "{}");
      if (typeof zoomByDomain !== "object" || zoomByDomain === null) zoomByDomain = {};
    } catch {
      zoomByDomain = {};
    }
    try {
      permissionGrants = JSON.parse(store.getSetting("permissionGrants") ?? "{}");
      if (typeof permissionGrants !== "object" || permissionGrants === null) {
        permissionGrants = {};
      }
    } catch {
      permissionGrants = {};
    }
    try {
      scrollByTab = JSON.parse(store.getSetting("scrollByTab") ?? "{}");
      if (typeof scrollByTab !== "object" || scrollByTab === null) scrollByTab = {};
    } catch {
      scrollByTab = {};
    }

    // Claim http/https so the OS can offer us as a browser choice. Only in a
    // packaged build — in dev this would register the electron.exe path as the
    // system handler and pollute the registry.
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient("http");
      app.setAsDefaultProtocolClient("https");
    }

    pendingOpenUrl = urlFromArgv(process.argv);

    registerIpc();
    createWindow();

    // Auto-update only in real installs: dev runs from source and SMOKE is a
    // headless boot check, neither of which has a GitHub release to update from.
    if (app.isPackaged && !SMOKE) {
      initUpdater((channel, payload) => sendToUI(channel, payload));
    }

    // Periodically snapshot the scroll offset of on-screen tabs so a crash or
    // a plain quit still restores roughly where the user was.
    setInterval(() => {
      for (const tabId of desiredVisible) void captureScroll(tabId);
      for (const tabId of poppedTabs) void captureScroll(tabId);
    }, 4000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
