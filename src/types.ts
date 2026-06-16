export type SplitDir = "row" | "col";
export type SplitSide = "left" | "right" | "up" | "down";

export interface LeafNode {
  id: string;
  type: "leaf";
  tabId: string;
}

export interface SplitNode {
  id: string;
  type: "split";
  dir: SplitDir;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = LeafNode | SplitNode;

export interface Tab {
  id: string;
  workspaceId: string;
  title: string;
  url: string;
  favicon?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  pinned?: boolean;
  suspended?: boolean;
  lastActiveAt?: number;
  blocked?: number;
  poppedOut?: boolean;
  muted?: boolean;
  audible?: boolean;
  group?: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface PermissionRequest {
  id: number;
  origin: string;
  permission: string;
  label: string;
  tabId?: string;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visited_at: number;
}

export interface BookmarkEntry {
  id: number;
  title: string;
  url: string;
  folder: string | null;
}

export interface DownloadEntry {
  id: number;
  url: string;
  filename: string;
  savePath: string;
  state: string;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
}

export interface ExtensionInfo {
  path: string;
  name: string;
  version: string;
}

export interface WeatherNow {
  temperature: number;
  code: number;
  location: string;
}

export type PaletteMode =
  | "all"
  | "tabs"
  | "tabsearch"
  | "history"
  | "bookmarks"
  | "downloads"
  | "extensions"
  | "prompt";

export interface PalettePrompt {
  title: string;
  placeholder?: string;
  initial?: string;
  action: (value: string) => void;
}
