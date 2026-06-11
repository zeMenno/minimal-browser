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
}

export interface Workspace {
  id: string;
  name: string;
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

export type PaletteMode = "all" | "tabs" | "history" | "bookmarks" | "prompt";

export interface PalettePrompt {
  title: string;
  placeholder?: string;
  initial?: string;
  action: (value: string) => void;
}
