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
import { partitionOf, selectActiveTab, selectVisibleTabIds, useBrowserStore } from "./store";
import { api, type PersistedState } from "./api";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { SplitView } from "./components/SplitView";
import { CommandPalette } from "./components/CommandPalette";
import { ThemePicker } from "./components/ThemePicker";
import { IntroOverlay } from "./components/IntroOverlay";
import { TabContextMenu } from "./components/TabContextMenu";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { MediaPanel } from "./components/MediaPanel";
import { chromeGradient, mixHex } from "./theme";
import type { PermissionRequest, SplitSide, Tab } from "./types";

export default function App() {
  const hydrated = useBrowserStore((s) => s.hydrated);
  const htmlFullscreen = useBrowserStore((s) => s.htmlFullscreen);
  const theme = useBrowserStore((s) => s.theme);
  useHydration();
  useBlockerSync();
  useMainProcessEvents();
  useViewSync();
  useTabSuspension();
  useOverlaySync();
  usePersistence();
  useDomShortcuts();

  // The native window-control buttons (min/max/close) live in a titleBarOverlay
  // drawn by the OS, so their colors must be pushed to the main process.
  useEffect(() => {
    api.setTitleBar(
      theme ? mixHex(theme.b, "#0b0e14", 0.3) : "#0b0e14",
      theme ? "#cdd6e4" : "#8b949e"
    );
    // Page scrollbars live inside the Chromium view, so the accent is pushed
    // to the main process which injects the matching pill style per page.
    api.setScrollbarAccent(theme ? theme.a : "#7aa2f7");
  }, [theme]);

  if (!hydrated) {
    return <div className="flex h-screen items-center justify-center bg-[#0b0e14]" />;
  }

  return (
    <TabDndContext>
      <div
        className="flex h-screen flex-col bg-[#0b0e14] text-[#c9d1d9]"
        style={
          theme
            ? ({
                background: chromeGradient(theme),
                // Re-tint every chrome surface so no default blue leaks through
                "--mb-pane": mixHex(theme.b, "#0c0e13", 0.1),
                "--mb-pane-border": mixHex(theme.a, "#0c0e13", 0.25),
                "--mb-pane-active": mixHex(theme.a, "#0c0e13", 0.7),
                "--mb-surface": mixHex(theme.b, "#0d1015", 0.16),
                "--mb-hover": mixHex(theme.a, "#0d1015", 0.16),
                "--mb-selected": mixHex(theme.a, "#0d1015", 0.32),
                "--mb-selected-soft": mixHex(theme.a, "#0d1015", 0.2),
                "--mb-modal": mixHex(theme.b, "#0e1116", 0.14),
                "--mb-accent": mixHex(theme.a, "#ffffff", 0.8),
              } as React.CSSProperties)
            : undefined
        }
      >
        {htmlFullscreen ? null : <TopBar />}
        <div className="flex min-h-0 flex-1">
          {htmlFullscreen ? null : <Sidebar />}
          <main className="flex min-h-0 min-w-0 flex-1">
            <SplitView />
          </main>
        </div>
      </div>
      <CommandPalette />
      <ThemePicker />
      <IntroOverlay />
      <TabContextMenu />
      <PermissionPrompt />
      <MediaPanel />
    </TabDndContext>
  );
}

function useHydration() {
  const hydrate = useBrowserStore((s) => s.hydrate);
  useEffect(() => {
    void api.loadState().then(hydrate);
  }, [hydrate]);
}

/** Mirror the main-process content-blocker on/off state into the store. */
function useBlockerSync() {
  useEffect(() => {
    void api.isBlockerEnabled().then((r) => {
      useBrowserStore.getState().setBlockerEnabled(r.enabled);
    });
  }, []);
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
    const offOpen = api.on("tab:open", (payload: { url: string; active?: boolean }) => {
      const store = useBrowserStore.getState();
      // window.open / target=_blank open in the background; URLs handed to us
      // as the default browser open in the foreground (active: true).
      const tabId = store.newTab(payload.url, { activate: payload.active === true });
      api.ensureTab(tabId, payload.url);
    });
    const offShortcut = api.on("shortcut", (name: string) => handleShortcut(name));
    const offFullscreen = api.on(
      "views:html-fullscreen",
      (payload: { active: boolean }) => {
        useBrowserStore.getState().setHtmlFullscreen(payload.active);
      }
    );
    const offSuspended = api.on("tab:suspended", (payload: { tabId: string }) => {
      useBrowserStore.getState().updateTabMeta(payload.tabId, { suspended: true });
    });
    const offPopin = api.on("tab:popin", (payload: { tabId: string }) => {
      useBrowserStore.getState().popInTab(payload.tabId);
    });
    const downloadStates = new Map<number, string>();
    const offDownload = api.on(
      "download:updated",
      (payload: { id: number; state: string }) => {
        downloadStates.set(payload.id, payload.state);
        let active = 0;
        for (const state of downloadStates.values()) {
          if (state === "progressing") active++;
        }
        useBrowserStore.getState().setActiveDownloadCount(active);
      }
    );
    const offPermission = api.on(
      "permission:request",
      (payload: PermissionRequest) => {
        useBrowserStore.getState().addPermissionRequest(payload);
      }
    );
    return () => {
      offUpdated();
      offFocused();
      offOpen();
      offShortcut();
      offFullscreen();
      offSuspended();
      offPopin();
      offDownload();
      offPermission();
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
    case "find":
      if (activeTab) store.setFindOpen(true);
      break;
    case "split-left":
    case "split-right":
    case "split-up":
    case "split-down":
      store.splitActive(name.slice(6) as SplitSide);
      break;
    case "focus-pane-left":
    case "focus-pane-right":
    case "focus-pane-up":
    case "focus-pane-down":
      store.focusPaneDir(name.slice(11) as SplitSide);
      break;
    case "zoom-in":
      if (activeTab) api.zoom(activeTab.id, "in");
      break;
    case "zoom-out":
      if (activeTab) api.zoom(activeTab.id, "out");
      break;
    case "zoom-reset":
      if (activeTab) api.zoom(activeTab.id, "reset");
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
      else if (ctrl && e.altKey && !e.shiftKey) {
        name =
          (
            {
              arrowleft: "focus-pane-left",
              arrowright: "focus-pane-right",
              arrowup: "focus-pane-up",
              arrowdown: "focus-pane-down",
            } as Record<string, string>
          )[key] ?? null;
      } else if (ctrl && !e.altKey && !e.shiftKey) {
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
                f: "find",
                "0": "zoom-reset",
                "=": "zoom-in",
                "+": "zoom-in",
                "-": "zoom-out",
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
          const tab = state.tabs[tabId];
          // about:blank tabs render the in-app start page (DOM), so they get no
          // native view — creating one would paint an empty page over it.
          if (tab && tab.url === "about:blank") {
            api.hideTab(tabId);
            continue;
          }
          api.ensureTab(tabId, tab?.url, tab ? partitionOf(tab.workspaceId) : undefined);
          // A recreated view starts unmuted; reapply the tab's mute state.
          if (tab?.muted) api.setMuted(tabId, true);
          if (tab?.suspended) {
            // Deferred: can't write to the store while it's notifying
            setTimeout(
              () => useBrowserStore.getState().updateTabMeta(tabId, { suspended: false }),
              0
            );
          }
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

const SUSPEND_AFTER_MS = 15 * 60_000;

/**
 * Suspends background tabs: after a tab has been hidden for a while its
 * native view is destroyed (memory back to the OS) while the tab itself
 * stays in the sidebar and reloads on activation. Main refuses to suspend
 * tabs that are playing audio.
 */
function useTabSuspension() {
  useEffect(() => {
    const hiddenSince = new Map<string, number>();
    const unsub = useBrowserStore.subscribe((state) => {
      if (!state.hydrated) return;
      const visible = new Set(selectVisibleTabIds(state));
      for (const tabId of Object.keys(state.tabs)) {
        if (visible.has(tabId) || state.tabs[tabId].suspended) {
          hiddenSince.delete(tabId);
        } else if (!hiddenSince.has(tabId)) {
          hiddenSince.set(tabId, Date.now());
        }
      }
      for (const tabId of hiddenSince.keys()) {
        if (!state.tabs[tabId]) hiddenSince.delete(tabId);
      }
    });
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [tabId, since] of hiddenSince) {
        if (now - since > SUSPEND_AFTER_MS) api.suspendTab(tabId);
      }
    }, 60_000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);
}

/**
 * Native views render above the DOM, so whenever modal UI (palette, drag,
 * divider resize) is showing we hide them; pane fallbacks take their place.
 */
function useOverlaySync() {
  useEffect(() => {
    let prev: boolean | null = null;
    const apply = (state: ReturnType<typeof useBrowserStore.getState>) => {
      const overlay =
        state.paletteOpen ||
        state.dragging ||
        state.resizing ||
        state.themePickerOpen ||
        state.introPlaying ||
        state.addressOpen ||
        state.tabMenu != null ||
        state.permissionRequests.length > 0 ||
        state.mediaPanelOpen;
      if (overlay !== prev) {
        prev = overlay;
        api.setOverlay(overlay);
      }
    };
    apply(useBrowserStore.getState());
    return useBrowserStore.subscribe(apply);
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
                pinned: t.pinned ? 1 : 0,
              };
            })
          ),
          settings: {
            activeWorkspaceId: state.activeWorkspaceId,
            sidebarOpen: state.sidebarOpen ? "1" : "0",
            themeA: state.theme?.a ?? "",
            themeB: state.theme?.b ?? "",
            closedTabs: JSON.stringify(state.closedTabs),
            customEngines: JSON.stringify(state.customEngines),
            tabGroups: JSON.stringify(
              Object.fromEntries(
                Object.values(state.tabs)
                  .filter((t) => t.group)
                  .map((t) => [t.id, t.group])
              )
            ),
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
          <div className="flex items-center gap-2 rounded border border-[var(--mb-pane-border)] bg-[var(--mb-selected)] px-3 py-1.5 text-[13px] text-[#cdd6e4] shadow-xl">
            {draggedTab.favicon && <img src={draggedTab.favicon} alt="" className="h-3.5 w-3.5" />}
            <span className="max-w-[200px] truncate">{draggedTab.title || draggedTab.url}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
