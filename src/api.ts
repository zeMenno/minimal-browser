import type {
  HistoryEntry,
  BookmarkEntry,
  DownloadEntry,
  ExtensionInfo,
  WeatherNow,
} from "./types";

interface RawApi {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  send(channel: string, payload?: unknown): void;
  on(channel: string, fn: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    api: RawApi;
  }
}

export interface PersistedWorkspace {
  id: string;
  name: string;
  position: number;
  layout: string | null;
}

export interface PersistedTab {
  id: string;
  workspace_id: string;
  title: string;
  url: string;
  icon: string | null;
  position: number;
  pinned: number;
}

export interface PersistedState {
  workspaces: PersistedWorkspace[];
  tabs: PersistedTab[];
  settings: Record<string, string>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const api = {
  loadState: () => window.api.invoke("state:load") as Promise<PersistedState>,
  saveState: (snapshot: PersistedState) => window.api.invoke("state:save", snapshot),
  searchHistory: (query: string) =>
    window.api.invoke("history:search", query) as Promise<HistoryEntry[]>,
  autocompleteHistory: (query: string) =>
    window.api.invoke("history:autocomplete", query) as Promise<HistoryEntry[]>,
  fetchSearchSuggestions: (query: string) =>
    window.api.invoke("suggest:fetch", query) as Promise<string[]>,
  fetchWeather: () => window.api.invoke("weather:fetch") as Promise<WeatherNow | null>,
  toggleBlocker: () => window.api.invoke("blocker:toggle") as Promise<{ enabled: boolean }>,
  isBlockerEnabled: () =>
    window.api.invoke("blocker:state") as Promise<{ enabled: boolean }>,
  listBookmarks: () => window.api.invoke("bookmarks:list") as Promise<BookmarkEntry[]>,
  addBookmark: (b: { title: string; url: string }) => window.api.invoke("bookmarks:add", b),
  removeBookmark: (id: number) => window.api.invoke("bookmarks:remove", id),

  ensureTab: (tabId: string, url?: string, partition?: string) =>
    window.api.send("tab:ensure", { tabId, url, partition }),
  setTabBounds: (tabId: string, bounds: Rect) => window.api.send("tab:bounds", { tabId, bounds }),
  hideTab: (tabId: string) => window.api.send("tab:hide", { tabId }),
  closeTab: (tabId: string) => window.api.send("tab:close", { tabId }),
  suspendTab: (tabId: string) => window.api.send("tab:suspend", { tabId }),
  zoom: (tabId: string, dir: "in" | "out" | "reset") =>
    window.api.send("tab:zoom", { tabId, dir }),
  popoutTab: (tabId: string) => window.api.send("tab:popout", { tabId }),
  setMuted: (tabId: string, muted: boolean) =>
    window.api.send("tab:setMuted", { tabId, muted }),
  respondPermission: (id: number, granted: boolean, remember: boolean) =>
    window.api.send("permission:respond", { id, granted, remember }),
  pip: (tabId: string) => window.api.send("tab:pip", { tabId }),
  mediaToggle: (tabId: string) => window.api.send("tab:mediaToggle", { tabId }),
  searchTabContent: (query: string) =>
    window.api.invoke("tabs:searchContent", query) as Promise<
      { tabId: string; snippet: string }[]
    >,
  navigate: (tabId: string, url: string, partition?: string) =>
    window.api.send("tab:navigate", { tabId, url, partition }),
  goBack: (tabId: string) => window.api.send("tab:back", { tabId }),
  goForward: (tabId: string) => window.api.send("tab:forward", { tabId }),
  reload: (tabId: string) => window.api.send("tab:reload", { tabId }),
  focusTab: (tabId: string) => window.api.send("tab:focus", { tabId }),
  openDevtools: (tabId: string) => window.api.send("tab:devtools", { tabId }),
  setOverlay: (active: boolean) => window.api.send("views:overlay", active),
  setScrollbarAccent: (accent: string) => window.api.send("views:scrollbar", { accent }),
  setDefaultBrowser: () =>
    window.api.invoke("app:setDefaultBrowser") as Promise<{ http: boolean; https: boolean }>,
  isDefaultBrowser: () =>
    window.api.invoke("app:isDefaultBrowser") as Promise<{ http: boolean; https: boolean }>,
  find: (tabId: string, text: string, forward: boolean, findNext: boolean) =>
    window.api.send("tab:find", { tabId, text, forward, findNext }),
  stopFind: (tabId: string) => window.api.send("tab:stopFind", { tabId }),
  openExternal: (url: string) => window.api.send("tab:openExternal", { url }),
  setTitleBar: (color: string, symbolColor: string) =>
    window.api.send("window:titlebar", { color, symbolColor }),
  listDownloads: () => window.api.invoke("downloads:list") as Promise<DownloadEntry[]>,
  openDownload: (id: number) => window.api.invoke("downloads:open", id),
  showDownload: (id: number) => window.api.invoke("downloads:show", id),
  addExtension: () =>
    window.api.invoke("extensions:add") as Promise<{
      ok: boolean;
      name?: string;
      error?: string;
    }>,
  addExtensionFromUrl: (input: string) =>
    window.api.invoke("extensions:addFromUrl", input) as Promise<{
      ok: boolean;
      name?: string;
      error?: string;
    }>,
  listExtensions: () => window.api.invoke("extensions:list") as Promise<ExtensionInfo[]>,
  removeExtension: (path: string) => window.api.invoke("extensions:remove", path),

  checkForUpdate: () =>
    window.api.invoke("update:check") as Promise<{ checking: boolean }>,
  installUpdate: () => window.api.send("update:install"),

  on: (channel: string, fn: (payload: never) => void) =>
    window.api.on(channel, fn as (payload: unknown) => void),
};

export interface Bang {
  home: string;
  search: (q: string) => string;
}

/** Search shortcuts: `!gh zustand` jumps straight to a GitHub search. */
export const BANGS: Record<string, Bang> = {
  g: { home: "https://www.google.com", search: (q) => `https://www.google.com/search?q=${q}` },
  d: { home: "https://duckduckgo.com", search: (q) => `https://duckduckgo.com/?q=${q}` },
  gh: { home: "https://github.com", search: (q) => `https://github.com/search?q=${q}` },
  npm: { home: "https://www.npmjs.com", search: (q) => `https://www.npmjs.com/search?q=${q}` },
  mdn: {
    home: "https://developer.mozilla.org",
    search: (q) => `https://developer.mozilla.org/en-US/search?q=${q}`,
  },
  so: {
    home: "https://stackoverflow.com",
    search: (q) => `https://stackoverflow.com/search?q=${q}`,
  },
  yt: {
    home: "https://www.youtube.com",
    search: (q) => `https://www.youtube.com/results?search_query=${q}`,
  },
  w: {
    home: "https://en.wikipedia.org",
    search: (q) => `https://en.wikipedia.org/w/index.php?search=${q}`,
  },
};

/**
 * User-defined search engines, registered at runtime from persisted settings.
 * Stored as `%s`-templated search URLs and exposed through the same bang
 * machinery as the built-ins, so `!key query` and tab-to-search just work.
 */
const customBangs: Record<string, Bang> = {};

export function setCustomEngines(
  engines: Record<string, { home: string; search: string }>
): void {
  for (const k of Object.keys(customBangs)) delete customBangs[k];
  for (const [key, e] of Object.entries(engines)) {
    customBangs[key.toLowerCase()] = {
      home: e.home,
      search: (q) => e.search.replace(/%s/g, q),
    };
  }
}

function lookupBang(key: string): Bang | undefined {
  return BANGS[key] ?? customBangs[key];
}

/** All known engine keys + home URLs (built-in and custom), for tab-to-search. */
export function knownEngines(): { key: string; home: string }[] {
  return [
    ...Object.entries(BANGS).map(([key, b]) => ({ key, home: b.home })),
    ...Object.entries(customBangs).map(([key, b]) => ({ key, home: b.home })),
  ];
}

/** Schemes that load as a page in a view; everything else is an external app. */
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

/** Human-readable names for the known bang engines (used in suggestions). */
export const BANG_LABELS: Record<string, string> = {
  g: "Google",
  d: "DuckDuckGo",
  gh: "GitHub",
  npm: "npm",
  mdn: "MDN",
  so: "Stack Overflow",
  yt: "YouTube",
  w: "Wikipedia",
};

/** Parse a `!bang query` input, returning the matched bang and its query. */
export function parseBang(
  input: string
): { key: string; bang: Bang; query: string } | null {
  const m = input.trim().match(/^!(\w+)(?:\s+(.*))?$/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const bang = lookupBang(key);
  if (!bang) return null;
  return { key, bang, query: (m[2] ?? "").trim() };
}

/** True for app links like `spotify:`, `vscode:`, `mailto:` that the OS opens. */
export function isExternalProtocol(url: string): boolean {
  // 2+ char scheme so Windows drive letters ("C:\…") aren't seen as protocols.
  const m = /^([a-z][a-z0-9+.-]+):/i.exec((url ?? "").trim());
  return m !== null && !WEB_SCHEMES.has(m[1].toLowerCase());
}

/** Turn address-bar input into a URL (or a search query URL). */
export function normalizeUrl(input: string): string {
  const text = input.trim();
  if (!text) return "about:blank";
  const bangMatch = text.match(/^!(\w+)(?:\s+(.*))?$/);
  if (bangMatch) {
    const bang = lookupBang(bangMatch[1].toLowerCase());
    if (bang) {
      const query = (bangMatch[2] ?? "").trim();
      return query ? bang.search(encodeURIComponent(query)) : bang.home;
    }
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return text;
  if (!text.includes(" ") && text.includes(".")) return `https://${text}`;
  if (text === "localhost" || /^localhost:\d+/.test(text)) return `http://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
