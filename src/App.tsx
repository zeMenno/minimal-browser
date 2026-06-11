import { useEffect, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import { selectActiveTab, selectVisibleTabIds, useBrowserStore } from "./store";
import { api, type PersistedState } from "./api";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { SplitView } from "./components/SplitView";
import { CommandPalette } from "./components/CommandPalette";
import type { SplitSide, Tab } from "./types";

export default function App() {
  const hydrated = useBrowserStore((s) => s.hydrated);
  const htmlFullscreen = useBrowserStore((s) => s.htmlFullscreen);
  useHydration();
  useMainProcessEvents();
  useViewSync();
  useOverlaySync();
  usePersistence();
  useDomShortcuts();

  if (!hydrated) {
    return <div className="flex h-screen items-center justify-center bg-[#0b0e14]" />;
  }

  return (
    <TabDndContext>
      <div className="flex h-screen flex-col bg-[#0b0e14] text-[#c9d1d9]">
        {htmlFullscreen ? null : <TopBar />}
        <div className="flex min-h-0 flex-1">
          {htmlFullscreen ? null : <Sidebar />}
          <main className="flex min-h-0 min-w-0 flex-1 bg-[#0b0e14]">
            <SplitView />
          </main>
        </div>
      </div>
      <CommandPalette />
    </TabDndContext>
  );
}

function useHydration() {
  const hydrate = useBrowserStore((s) => s.hydrate);
  useEffect(() => {
    void api.loadState().then(hydrate);
  }, [hydrate]);
}

/** Routes events pushed from the Electron main process into the store. */
function useMainProcessEvents() {
  useEffect(() => {
    const offUpdated = api.on(
      "tab:updated",
      (payload: { tabId: string } & Partial<Tab>) => {
        const { tabId, ...patch } = payload;
        useBrowserStore.getState().updateTabMeta(tabId, patch);
      }
    );
    const offFocused = api.on("tab:focused", (payload: { tabId: string }) => {
      useBrowserStore.getState().handleTabFocused(payload.tabId);
    });
    const offOpen = api.on("tab:open", (payload: { url: string }) => {
      const store = useBrowserStore.getState();
      // window.open / target=_blank: open as background sidebar tab
      const tabId = store.newTab(payload.url, { activate: false });
      api.ensureTab(tabId, payload.url);
    });
    const offShortcut = api.on("shortcut", (name: string) => handleShortcut(name));
    return () => {
      offUpdated();
      offFocused();
      offOpen();
      offShortcut();
    };
  }, []);
}

function handleShortcut(name: string): void {
  const store = useBrowserStore.getState();
  const activeTab = selectActiveTab(store);
  switch (name) {
    case "palette":
      store.paletteOpen ? store.closePalette() : store.openPalette("all");
      break;
    case "tab-switcher":
      store.openPalette("tabs");
      break;
    case "focus-address":
      if (!activeTab) store.newTab();
      store.focusAddress();
      break;
    case "toggle-sidebar":
      store.toggleSidebar();
      break;
    case "new-tab":
      store.newTab();
      store.focusAddress();
      break;
    case "close-tab":
      if (activeTab) store.closeTab(activeTab.id);
      break;
    case "reopen-tab":
      store.reopenTab();
      break;
    case "bookmark":
      if (activeTab && activeTab.url !== "about:blank")
        void api.addBookmark({ title: activeTab.title, url: activeTab.url });
      break;
    case "reload":
      if (activeTab) api.reload(activeTab.id);
      break;
    case "split-left":
    case "split-right":
    case "split-up":
    case "split-down":
      store.splitActive(name.slice(6) as SplitSide);
      break;
    default:
      if (name.startsWith("workspace-")) {
        store.switchWorkspaceByIndex(parseInt(name.slice(10), 10) - 1);
      }
  }
}

/** Window-level keyboard shortcuts (when focus is in the app UI, not a page). */
function useDomShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      let name: string | null = null;
      if (ctrl && !e.altKey && e.shiftKey && key === "t") name = "reopen-tab";
      else if (ctrl && !e.altKey && !e.shiftKey) {
        if (key >= "1" && key <= "9") name = `workspace-${key}`;
        else
          name =
            (
              {
                k: "palette",
                p: "tab-switcher",
                l: "focus-address",
                b: "toggle-sidebar",
                t: "new-tab",
                w: "close-tab",
                d: "bookmark",
                r: "reload",
              } as Record<string, string>
            )[key] ?? null;
      } else if (e.altKey && !ctrl && !e.shiftKey) {
        name =
          (
            {
              arrowleft: "split-left",
              arrowright: "split-right",
              arrowup: "split-up",
              arrowdown: "split-down",
            } as Record<string, string>
          )[key] ?? null;
      }
      if (name) {
        e.preventDefault();
        handleShortcut(name);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Keeps native WebContentsViews in sync with the store: creates views for
 * tabs visible in the active workspace's layout, hides the rest, destroys
 * views for tabs that no longer exist.
 */
function useViewSync() {
  const prevVisible = useRef<Set<string>>(new Set());
  const prevAll = useRef<Set<string>>(new Set());

  useEffect(() => {
    return useBrowserStore.subscribe((state) => {
      if (!state.hydrated) return;
      const visible = new Set(selectVisibleTabIds(state));
      const all = new Set(Object.keys(state.tabs));

      for (const tabId of visible) {
        if (!prevVisible.current.has(tabId)) {
          api.ensureTab(tabId, state.tabs[tabId]?.url);
        }
      }
      for (const tabId of prevVisible.current) {
        if (!visible.has(tabId) && all.has(tabId)) api.hideTab(tabId);
      }
      for (const tabId of prevAll.current) {
        if (!all.has(tabId)) api.closeTab(tabId);
      }
      prevVisible.current = visible;
      prevAll.current = all;
    });
  }, []);
}

/**
 * Native views render above the DOM, so whenever modal UI (palette, drag,
 * divider resize) is showing we hide them; pane fallbacks take their place.
 */
function useOverlaySync() {
  useEffect(() => {
    let prev = false;
    return useBrowserStore.subscribe((state) => {
      const overlay = state.paletteOpen || state.dragging || state.resizing;
      if (overlay !== prev) {
        prev = overlay;
        api.setOverlay(overlay);
      }
    });
  }, []);
}

/** Debounced persistence of workspaces, tabs, layouts and settings. */
function usePersistence() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return useBrowserStore.subscribe((state) => {
      if (!state.hydrated) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const snapshot: PersistedState = {
          workspaces: state.workspaces.map((w, i) => ({
            id: w.id,
            name: w.name,
            position: i,
            layout: JSON.stringify({
              root: state.layouts[w.id] ?? null,
              activePane: state.activePane[w.id] ?? null,
            }),
          })),
          tabs: state.workspaces.flatMap((w) =>
            (state.tabOrder[w.id] ?? []).map((tabId, i) => {
              const t = state.tabs[tabId];
              return {
                id: t.id,
                workspace_id: w.id,
                title: t.title,
                url: t.url,
                icon: t.favicon ?? null,
                position: i,
              };
            })
          ),
          settings: {
            activeWorkspaceId: state.activeWorkspaceId,
            sidebarOpen: state.sidebarOpen ? "1" : "0",
          },
        };
        void api.saveState(snapshot);
      }, 350);
    });
  }, []);
}

/** Drag & drop: sidebar reordering plus dropping tabs onto pane zones. */
function TabDndContext({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const [draggedTab, setDraggedTab] = useState<Tab | null>(null);

  const onDragStart = (event: DragStartEvent) => {
    const store = useBrowserStore.getState();
    const tab = store.tabs[String(event.active.id)];
    if (tab) {
      setDraggedTab(tab);
      store.setDragging(true);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const store = useBrowserStore.getState();
    store.setDragging(false);
    setDraggedTab(null);
    const tabId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || !store.tabs[tabId]) return;

    if (overId.startsWith("zone:")) {
      const [, paneId, zone] = overId.split(":");
      store.dropTabOnPane(tabId, paneId, zone as "center" | SplitSide);
      return;
    }
    // Otherwise: sidebar reorder
    if (store.tabs[overId] && overId !== tabId) {
      const ws = store.activeWorkspaceId;
      const order = store.tabOrder[ws] ?? [];
      const from = order.indexOf(tabId);
      const to = order.indexOf(overId);
      if (from !== -1 && to !== -1) store.reorderTabs(ws, from, to);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        useBrowserStore.getState().setDragging(false);
        setDraggedTab(null);
      }}
    >
      {children}
      <DragOverlay>
        {draggedTab && (
          <div className="flex items-center gap-2 rounded border border-[#2a3340] bg-[#1a2332] px-3 py-1.5 text-[13px] text-[#cdd6e4] shadow-xl">
            {draggedTab.favicon && <img src={draggedTab.favicon} alt="" className="h-3.5 w-3.5" />}
            <span className="max-w-[200px] truncate">{draggedTab.title || draggedTab.url}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
