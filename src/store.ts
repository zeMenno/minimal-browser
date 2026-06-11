import { create } from "zustand";
import type {
  LayoutNode,
  PaletteMode,
  PalettePrompt,
  SplitSide,
  Tab,
  Workspace,
} from "./types";
import {
  findLeaf,
  findLeafByTab,
  leaves,
  makeLeaf,
  removeNode,
  sanitize,
  splitLeaf,
  uid,
  updateNode,
} from "./layout";
import { api, normalizeUrl, type PersistedState } from "./api";

interface ClosedTab {
  tab: Tab;
  workspaceId: string;
}

export interface BrowserState {
  htmlFullscreen: boolean;
  hydrated: boolean;
  workspaces: Workspace[];
  tabs: Record<string, Tab>;
  tabOrder: Record<string, string[]>;
  layouts: Record<string, LayoutNode | null>;
  activePane: Record<string, string | null>;
  activeWorkspaceId: string;
  closedTabs: ClosedTab[];
  sidebarOpen: boolean;
  paletteOpen: boolean;
  paletteMode: PaletteMode;
  palettePrompt: PalettePrompt | null;
  dragging: boolean;
  resizing: boolean;
  focusAddressNonce: number;

  hydrate: (data: PersistedState) => void;
  newTab: (url?: string, opts?: { activate?: boolean; workspaceId?: string }) => string;
  openUrl: (input: string) => void;
  closeTab: (tabId: string) => void;
  reopenTab: () => void;
  activateTab: (tabId: string) => void;
  setActivePane: (paneId: string) => void;
  splitActive: (side: SplitSide) => void;
  closeActivePane: () => void;
  setSizes: (splitId: string, sizes: number[]) => void;
  dropTabOnPane: (tabId: string, paneId: string, zone: "center" | SplitSide) => void;
  reorderTabs: (workspaceId: string, fromIndex: number, toIndex: number) => void;
  switchWorkspace: (id: string) => void;
  switchWorkspaceByIndex: (index: number) => void;
  createWorkspace: (name: string) => void;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  moveTabToWorkspace: (tabId: string, workspaceId: string) => void;
  updateTabMeta: (tabId: string, patch: Partial<Tab>) => void;
  handleTabFocused: (tabId: string) => void;
  toggleSidebar: () => void;
  openPalette: (mode: PaletteMode, prompt?: PalettePrompt) => void;
  closePalette: () => void;
  setDragging: (dragging: boolean) => void;
  setResizing: (resizing: boolean) => void;
  focusAddress: () => void;
  setHtmlFullscreen: (active: boolean) => void;
}

function makeTab(workspaceId: string, url: string): Tab {
  return {
    id: uid(),
    workspaceId,
    title: url === "about:blank" ? "New Tab" : url.replace(/^https?:\/\//, ""),
    url,
  };
}

/** Place a tab into the active pane of the given workspace (pure helper). */
function placeTab(
  state: BrowserState,
  workspaceId: string,
  tabId: string
): Pick<BrowserState, "layouts" | "activePane"> {
  const layout = state.layouts[workspaceId];
  if (!layout) {
    const leaf = makeLeaf(tabId);
    return {
      layouts: { ...state.layouts, [workspaceId]: leaf },
      activePane: { ...state.activePane, [workspaceId]: leaf.id },
    };
  }
  // If the tab is already visible in some pane, just focus that pane
  const existing = findLeafByTab(layout, tabId);
  if (existing) {
    return {
      layouts: state.layouts,
      activePane: { ...state.activePane, [workspaceId]: existing.id },
    };
  }
  const paneId = state.activePane[workspaceId] ?? leaves(layout)[0]?.id;
  if (!paneId || !findLeaf(layout, paneId)) {
    const leaf = makeLeaf(tabId);
    return {
      layouts: { ...state.layouts, [workspaceId]: leaf },
      activePane: { ...state.activePane, [workspaceId]: leaf.id },
    };
  }
  const next = updateNode(layout, paneId, (node) =>
    node.type === "leaf" ? { ...node, tabId } : node
  );
  return {
    layouts: { ...state.layouts, [workspaceId]: next },
    activePane: { ...state.activePane, [workspaceId]: paneId },
  };
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  htmlFullscreen: false,
  hydrated: false,
  workspaces: [],
  tabs: {},
  tabOrder: {},
  layouts: {},
  activePane: {},
  activeWorkspaceId: "",
  closedTabs: [],
  sidebarOpen: true,
  paletteOpen: false,
  paletteMode: "all",
  palettePrompt: null,
  dragging: false,
  resizing: false,
  focusAddressNonce: 0,

  hydrate: (data) => {
    if (data.workspaces.length === 0) {
      // First launch: seed a default workspace with one tab
      const ws: Workspace = { id: uid(), name: "Main" };
      const tab = makeTab(ws.id, "https://github.com");
      const leaf = makeLeaf(tab.id);
      set({
        hydrated: true,
        workspaces: [ws],
        tabs: { [tab.id]: tab },
        tabOrder: { [ws.id]: [tab.id] },
        layouts: { [ws.id]: leaf },
        activePane: { [ws.id]: leaf.id },
        activeWorkspaceId: ws.id,
        sidebarOpen: true,
      });
      return;
    }

    const tabs: Record<string, Tab> = {};
    const tabOrder: Record<string, string[]> = {};
    const layouts: Record<string, LayoutNode | null> = {};
    const activePane: Record<string, string | null> = {};
    const workspaces: Workspace[] = data.workspaces.map((w) => ({ id: w.id, name: w.name }));

    for (const w of workspaces) {
      tabOrder[w.id] = [];
      layouts[w.id] = null;
      activePane[w.id] = null;
    }
    for (const t of data.tabs) {
      if (!tabOrder[t.workspace_id]) continue;
      tabs[t.id] = {
        id: t.id,
        workspaceId: t.workspace_id,
        title: t.title || t.url,
        url: t.url,
        favicon: t.icon ?? undefined,
      };
      tabOrder[t.workspace_id].push(t.id);
    }
    for (const w of data.workspaces) {
      try {
        const parsed = w.layout ? JSON.parse(w.layout) : null;
        const root = sanitize(parsed?.root ?? null, (tabId) => !!tabs[tabId]);
        layouts[w.id] = root;
        const firstLeaf = leaves(root)[0];
        activePane[w.id] =
          root && parsed?.activePane && findLeaf(root, parsed.activePane)
            ? parsed.activePane
            : firstLeaf?.id ?? null;
      } catch {
        layouts[w.id] = null;
      }
    }

    const savedActive = data.settings["activeWorkspaceId"];
    set({
      hydrated: true,
      workspaces,
      tabs,
      tabOrder,
      layouts,
      activePane,
      activeWorkspaceId: workspaces.some((w) => w.id === savedActive)
        ? savedActive
        : workspaces[0].id,
      sidebarOpen: data.settings["sidebarOpen"] !== "0",
    });
  },

  newTab: (url = "about:blank", opts = {}) => {
    const state = get();
    const workspaceId = opts.workspaceId ?? state.activeWorkspaceId;
    const tab = makeTab(workspaceId, url);
    const activate = opts.activate !== false && workspaceId === state.activeWorkspaceId;
    set((s) => {
      const base = {
        tabs: { ...s.tabs, [tab.id]: tab },
        tabOrder: { ...s.tabOrder, [workspaceId]: [...(s.tabOrder[workspaceId] ?? []), tab.id] },
      };
      return activate ? { ...base, ...placeTab(s, workspaceId, tab.id) } : base;
    });
    return tab.id;
  },

  openUrl: (input) => {
    const url = normalizeUrl(input);
    const state = get();
    const ws = state.activeWorkspaceId;
    const paneId = state.activePane[ws];
    const leaf = paneId ? findLeaf(state.layouts[ws], paneId) : null;
    if (leaf) {
      api.navigate(leaf.tabId, url);
    } else {
      const tabId = state.newTab(url);
      api.ensureTab(tabId, url);
    }
  },

  closeTab: (tabId) => {
    const state = get();
    const tab = state.tabs[tabId];
    if (!tab) return;
    const ws = tab.workspaceId;
    set((s) => {
      const tabs = { ...s.tabs };
      delete tabs[tabId];
      const order = (s.tabOrder[ws] ?? []).filter((id) => id !== tabId);
      let layout = s.layouts[ws];
      let pane = s.activePane[ws];
      const leaf = findLeafByTab(layout, tabId);
      if (layout && leaf) {
        layout = removeNode(layout, leaf.id);
        if (!layout && order.length > 0) {
          // Last pane closed but background tabs remain: show the next one
          const idx = Math.min(
            (s.tabOrder[ws] ?? []).indexOf(tabId),
            order.length - 1
          );
          const nextLeaf = makeLeaf(order[Math.max(0, idx)]);
          layout = nextLeaf;
          pane = nextLeaf.id;
        } else if (pane === leaf.id || !pane || !findLeaf(layout, pane)) {
          pane = leaves(layout)[0]?.id ?? null;
        }
      }
      return {
        tabs,
        tabOrder: { ...s.tabOrder, [ws]: order },
        layouts: { ...s.layouts, [ws]: layout },
        activePane: { ...s.activePane, [ws]: pane },
        closedTabs: [...s.closedTabs, { tab, workspaceId: ws }].slice(-25),
      };
    });
  },

  reopenTab: () => {
    const state = get();
    const last = state.closedTabs[state.closedTabs.length - 1];
    if (!last) return;
    const ws = state.workspaces.some((w) => w.id === last.workspaceId)
      ? last.workspaceId
      : state.activeWorkspaceId;
    const tab: Tab = { ...last.tab, workspaceId: ws };
    set((s) => ({
      closedTabs: s.closedTabs.slice(0, -1),
      tabs: { ...s.tabs, [tab.id]: tab },
      tabOrder: { ...s.tabOrder, [ws]: [...(s.tabOrder[ws] ?? []), tab.id] },
      activeWorkspaceId: ws,
      ...placeTab({ ...s, activeWorkspaceId: ws } as BrowserState, ws, tab.id),
    }));
  },

  activateTab: (tabId) => {
    const state = get();
    const tab = state.tabs[tabId];
    if (!tab) return;
    set((s) => ({
      activeWorkspaceId: tab.workspaceId,
      ...placeTab(s, tab.workspaceId, tabId),
    }));
    api.focusTab(tabId);
  },

  setActivePane: (paneId) => {
    set((s) => ({ activePane: { ...s.activePane, [s.activeWorkspaceId]: paneId } }));
  },

  splitActive: (side) => {
    const state = get();
    const ws = state.activeWorkspaceId;
    const layout = state.layouts[ws];
    if (!layout) {
      state.newTab();
      state.focusAddress();
      return;
    }
    const paneId = state.activePane[ws] ?? leaves(layout)[0].id;
    const tab = makeTab(ws, "about:blank");
    const newLeaf = makeLeaf(tab.id);
    set((s) => ({
      tabs: { ...s.tabs, [tab.id]: tab },
      tabOrder: { ...s.tabOrder, [ws]: [...(s.tabOrder[ws] ?? []), tab.id] },
      layouts: { ...s.layouts, [ws]: splitLeaf(s.layouts[ws]!, paneId, side, newLeaf) },
      activePane: { ...s.activePane, [ws]: newLeaf.id },
    }));
    state.focusAddress();
  },

  closeActivePane: () => {
    const state = get();
    const ws = state.activeWorkspaceId;
    const layout = state.layouts[ws];
    const paneId = state.activePane[ws];
    if (!layout || !paneId || layout.type === "leaf") return;
    set((s) => {
      const next = removeNode(s.layouts[ws]!, paneId);
      return {
        layouts: { ...s.layouts, [ws]: next },
        activePane: { ...s.activePane, [ws]: leaves(next)[0]?.id ?? null },
      };
    });
  },

  setSizes: (splitId, sizes) => {
    set((s) => {
      const ws = s.activeWorkspaceId;
      const layout = s.layouts[ws];
      if (!layout) return s;
      return {
        layouts: {
          ...s.layouts,
          [ws]: updateNode(layout, splitId, (node) =>
            node.type === "split" ? { ...node, sizes } : node
          ),
        },
      };
    });
  },

  dropTabOnPane: (tabId, paneId, zone) => {
    const state = get();
    const ws = state.activeWorkspaceId;
    let layout = state.layouts[ws];
    if (!layout) return;
    const target = findLeaf(layout, paneId);
    if (!target) return;
    if (target.tabId === tabId) return;

    // If the dragged tab is already visible in another pane, vacate it first
    const source = findLeafByTab(layout, tabId);
    if (source) {
      const removed = removeNode(layout, source.id);
      if (!removed || !findLeaf(removed, paneId)) return;
      layout = removed;
    }

    if (zone === "center") {
      layout = updateNode(layout, paneId, (node) =>
        node.type === "leaf" ? { ...node, tabId } : node
      );
      set((s) => ({
        layouts: { ...s.layouts, [ws]: layout },
        activePane: { ...s.activePane, [ws]: paneId },
      }));
    } else {
      const newLeaf = makeLeaf(tabId);
      layout = splitLeaf(layout, paneId, zone, newLeaf);
      set((s) => ({
        layouts: { ...s.layouts, [ws]: layout },
        activePane: { ...s.activePane, [ws]: newLeaf.id },
      }));
    }
  },

  reorderTabs: (workspaceId, fromIndex, toIndex) => {
    set((s) => {
      const order = [...(s.tabOrder[workspaceId] ?? [])];
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      return { tabOrder: { ...s.tabOrder, [workspaceId]: order } };
    });
  },

  switchWorkspace: (id) => {
    if (get().workspaces.some((w) => w.id === id)) set({ activeWorkspaceId: id });
  },

  switchWorkspaceByIndex: (index) => {
    const ws = get().workspaces[index];
    if (ws) set({ activeWorkspaceId: ws.id });
  },

  createWorkspace: (name) => {
    const ws: Workspace = { id: uid(), name: name || "Untitled" };
    const tab = makeTab(ws.id, "about:blank");
    const leaf = makeLeaf(tab.id);
    set((s) => ({
      workspaces: [...s.workspaces, ws],
      tabs: { ...s.tabs, [tab.id]: tab },
      tabOrder: { ...s.tabOrder, [ws.id]: [tab.id] },
      layouts: { ...s.layouts, [ws.id]: leaf },
      activePane: { ...s.activePane, [ws.id]: leaf.id },
      activeWorkspaceId: ws.id,
    }));
    get().focusAddress();
  },

  renameWorkspace: (id, name) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
    }));
  },

  deleteWorkspace: (id) => {
    const state = get();
    if (state.workspaces.length <= 1) return;
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id);
      const tabs = { ...s.tabs };
      for (const tabId of s.tabOrder[id] ?? []) delete tabs[tabId];
      const tabOrder = { ...s.tabOrder };
      delete tabOrder[id];
      const layouts = { ...s.layouts };
      delete layouts[id];
      const activePane = { ...s.activePane };
      delete activePane[id];
      return {
        workspaces,
        tabs,
        tabOrder,
        layouts,
        activePane,
        activeWorkspaceId:
          s.activeWorkspaceId === id ? workspaces[0].id : s.activeWorkspaceId,
      };
    });
  },

  moveTabToWorkspace: (tabId, workspaceId) => {
    const state = get();
    const tab = state.tabs[tabId];
    if (!tab || tab.workspaceId === workspaceId) return;
    const sourceWs = tab.workspaceId;
    set((s) => {
      let sourceLayout = s.layouts[sourceWs];
      let sourcePane = s.activePane[sourceWs];
      const leaf = findLeafByTab(sourceLayout, tabId);
      if (sourceLayout && leaf) {
        sourceLayout = removeNode(sourceLayout, leaf.id);
        if (sourcePane === leaf.id || (sourceLayout && sourcePane && !findLeaf(sourceLayout, sourcePane))) {
          sourcePane = leaves(sourceLayout)[0]?.id ?? null;
        }
      }
      return {
        tabs: { ...s.tabs, [tabId]: { ...tab, workspaceId } },
        tabOrder: {
          ...s.tabOrder,
          [sourceWs]: (s.tabOrder[sourceWs] ?? []).filter((id) => id !== tabId),
          [workspaceId]: [...(s.tabOrder[workspaceId] ?? []), tabId],
        },
        layouts: { ...s.layouts, [sourceWs]: sourceLayout },
        activePane: { ...s.activePane, [sourceWs]: sourcePane },
      };
    });
  },

  updateTabMeta: (tabId, patch) => {
    set((s) => (s.tabs[tabId] ? { tabs: { ...s.tabs, [tabId]: { ...s.tabs[tabId], ...patch } } } : s));
  },

  handleTabFocused: (tabId) => {
    const state = get();
    const ws = state.activeWorkspaceId;
    const leaf = findLeafByTab(state.layouts[ws], tabId);
    if (leaf && state.activePane[ws] !== leaf.id) {
      set((s) => ({ activePane: { ...s.activePane, [ws]: leaf.id } }));
    }
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  openPalette: (mode, prompt) =>
    set({ paletteOpen: true, paletteMode: mode, palettePrompt: prompt ?? null }),

  closePalette: () => set({ paletteOpen: false, palettePrompt: null }),

  setDragging: (dragging) => set({ dragging }),
  setResizing: (resizing) => set({ resizing }),
  focusAddress: () => set((s) => ({ focusAddressNonce: s.focusAddressNonce + 1 })),
  setHtmlFullscreen: (active) => set({ htmlFullscreen: active }),
}));

/** The tab shown in the active pane of the active workspace, if any. */
export function selectActiveTab(state: BrowserState): Tab | null {
  const ws = state.activeWorkspaceId;
  const paneId = state.activePane[ws];
  const layout = state.layouts[ws];
  const leaf = paneId ? findLeaf(layout, paneId) : leaves(layout)[0] ?? null;
  return leaf ? state.tabs[leaf.tabId] ?? null : null;
}

/** Tab ids currently visible (leaves of the active workspace's layout). */
export function selectVisibleTabIds(state: BrowserState): string[] {
  return leaves(state.layouts[state.activeWorkspaceId]).map((l) => l.tabId);
}
