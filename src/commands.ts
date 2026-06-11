import { api } from "./api";
import { selectActiveTab, useBrowserStore, type BrowserState } from "./store";

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  execute: () => void;
}

/**
 * Every action in the browser is a command. The palette renders this list;
 * keyboard shortcuts call the same store actions.
 */
export function buildCommands(state: BrowserState): Command[] {
  const store = useBrowserStore.getState();
  const activeTab = selectActiveTab(state);

  const commands: Command[] = [
    {
      id: "new-tab",
      title: "New Tab",
      shortcut: "Ctrl+T",
      execute: () => {
        store.newTab();
        store.focusAddress();
      },
    },
    {
      id: "close-tab",
      title: "Close Tab",
      shortcut: "Ctrl+W",
      execute: () => {
        if (activeTab) store.closeTab(activeTab.id);
      },
    },
    {
      id: "reopen-tab",
      title: "Reopen Closed Tab",
      shortcut: "Ctrl+Shift+T",
      execute: () => store.reopenTab(),
    },
    {
      id: "split-right",
      title: "Split Right",
      shortcut: "Alt+→",
      execute: () => store.splitActive("right"),
    },
    {
      id: "split-left",
      title: "Split Left",
      shortcut: "Alt+←",
      execute: () => store.splitActive("left"),
    },
    {
      id: "split-down",
      title: "Split Down",
      shortcut: "Alt+↓",
      execute: () => store.splitActive("down"),
    },
    {
      id: "split-up",
      title: "Split Up",
      shortcut: "Alt+↑",
      execute: () => store.splitActive("up"),
    },
    {
      id: "close-split",
      title: "Close Split (keep tab in sidebar)",
      execute: () => store.closeActivePane(),
    },
    {
      id: "toggle-sidebar",
      title: "Toggle Sidebar",
      shortcut: "Ctrl+B",
      execute: () => store.toggleSidebar(),
    },
    {
      id: "reload",
      title: "Reload Page",
      shortcut: "Ctrl+R",
      execute: () => {
        if (activeTab) api.reload(activeTab.id);
      },
    },
    {
      id: "go-back",
      title: "Go Back",
      execute: () => {
        if (activeTab) api.goBack(activeTab.id);
      },
    },
    {
      id: "go-forward",
      title: "Go Forward",
      execute: () => {
        if (activeTab) api.goForward(activeTab.id);
      },
    },
    {
      id: "copy-url",
      title: "Copy Current URL",
      execute: () => {
        if (activeTab) void navigator.clipboard.writeText(activeTab.url);
      },
    },
    {
      id: "bookmark-tab",
      title: "Bookmark Current Tab",
      shortcut: "Ctrl+D",
      execute: () => {
        if (activeTab && activeTab.url !== "about:blank")
          void api.addBookmark({ title: activeTab.title, url: activeTab.url });
      },
    },
    {
      id: "search-history",
      title: "Search History",
      execute: () => store.openPalette("history"),
    },
    {
      id: "search-bookmarks",
      title: "Search Bookmarks",
      execute: () => store.openPalette("bookmarks"),
    },
    {
      id: "search-tabs",
      title: "Search Open Tabs",
      shortcut: "Ctrl+P",
      execute: () => store.openPalette("tabs"),
    },
    {
      id: "devtools-page",
      title: "Open DevTools for Page",
      shortcut: "F12",
      execute: () => {
        if (activeTab) api.openDevtools(activeTab.id);
      },
    },
    {
      id: "new-workspace",
      title: "New Workspace",
      execute: () =>
        store.openPalette("prompt", {
          title: "New workspace",
          placeholder: "Workspace name…",
          action: (value) => store.createWorkspace(value.trim() || "Untitled"),
        }),
    },
    {
      id: "rename-workspace",
      title: "Rename Workspace",
      execute: () => {
        const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
        store.openPalette("prompt", {
          title: `Rename "${ws?.name ?? ""}"`,
          placeholder: "New name…",
          initial: ws?.name,
          action: (value) => {
            if (value.trim()) store.renameWorkspace(state.activeWorkspaceId, value.trim());
          },
        });
      },
    },
  ];

  if (state.workspaces.length > 1) {
    commands.push({
      id: "delete-workspace",
      title: "Delete Current Workspace",
      subtitle: "Closes all of its tabs",
      execute: () => store.deleteWorkspace(state.activeWorkspaceId),
    });
  }

  state.workspaces.forEach((ws, i) => {
    if (ws.id !== state.activeWorkspaceId) {
      commands.push({
        id: `switch-ws-${ws.id}`,
        title: `Switch Workspace: ${ws.name}`,
        shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
        execute: () => store.switchWorkspace(ws.id),
      });
      if (activeTab) {
        commands.push({
          id: `move-tab-${ws.id}`,
          title: `Move Tab to Workspace: ${ws.name}`,
          subtitle: activeTab.title,
          execute: () => store.moveTabToWorkspace(activeTab.id, ws.id),
        });
      }
    }
  });

  return commands;
}
