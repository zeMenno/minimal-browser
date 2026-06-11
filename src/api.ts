import type { HistoryEntry, BookmarkEntry } from "./types";

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
  listBookmarks: () => window.api.invoke("bookmarks:list") as Promise<BookmarkEntry[]>,
  addBookmark: (b: { title: string; url: string }) => window.api.invoke("bookmarks:add", b),
  removeBookmark: (id: number) => window.api.invoke("bookmarks:remove", id),

  ensureTab: (tabId: string, url?: string) => window.api.send("tab:ensure", { tabId, url }),
  setTabBounds: (tabId: string, bounds: Rect) => window.api.send("tab:bounds", { tabId, bounds }),
  hideTab: (tabId: string) => window.api.send("tab:hide", { tabId }),
  closeTab: (tabId: string) => window.api.send("tab:close", { tabId }),
  navigate: (tabId: string, url: string) => window.api.send("tab:navigate", { tabId, url }),
  goBack: (tabId: string) => window.api.send("tab:back", { tabId }),
  goForward: (tabId: string) => window.api.send("tab:forward", { tabId }),
  reload: (tabId: string) => window.api.send("tab:reload", { tabId }),
  focusTab: (tabId: string) => window.api.send("tab:focus", { tabId }),
  openDevtools: (tabId: string) => window.api.send("tab:devtools", { tabId }),
  setOverlay: (active: boolean) => window.api.send("views:overlay", active),

  on: (channel: string, fn: (payload: never) => void) =>
    window.api.on(channel, fn as (payload: unknown) => void),
};

/** Turn address-bar input into a URL (or a search query URL). */
export function normalizeUrl(input: string): string {
  const text = input.trim();
  if (!text) return "about:blank";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return text;
  if (!text.includes(" ") && text.includes(".")) return `https://${text}`;
  if (text === "localhost" || /^localhost:\d+/.test(text)) return `http://${text}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
