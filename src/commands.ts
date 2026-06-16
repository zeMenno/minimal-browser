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
      id: "copy-markdown-link",
      title: "Copy as Markdown Link",
      subtitle: activeTab ? `[${activeTab.title}](${activeTab.url})` : undefined,
      execute: () => {
        if (activeTab)
          void navigator.clipboard.writeText(`[${activeTab.title}](${activeTab.url})`);
      },
    },
    {
      id: "open-external",
      title: "Open in System Browser",
      execute: () => {
        if (activeTab) api.openExternal(activeTab.url);
      },
    },
    {
      id: "view-source",
      title: "View Page Source",
      execute: () => {
        if (activeTab && /^https?:/.test(activeTab.url))
          store.newTab(`view-source:${activeTab.url}`);
      },
    },
    {
      id: "duplicate-tab",
      title: "Duplicate Tab",
      execute: () => {
        if (activeTab) store.newTab(activeTab.url);
      },
    },
    {
      id: "popout-tab",
      title: "Pop Out Tab",
      subtitle: "Float this tab in a small always-on-top window",
      execute: () => {
        if (activeTab && activeTab.url !== "about:blank") store.popOutTab(activeTab.id);
      },
    },
    {
      id: "zoom-in",
      title: "Zoom In",
      subtitle: "Remembered per site",
      shortcut: "Ctrl++",
      execute: () => {
        if (activeTab) api.zoom(activeTab.id, "in");
      },
    },
    {
      id: "zoom-out",
      title: "Zoom Out",
      subtitle: "Remembered per site",
      shortcut: "Ctrl+-",
      execute: () => {
        if (activeTab) api.zoom(activeTab.id, "out");
      },
    },
    {
      id: "zoom-reset",
      title: "Reset Zoom",
      shortcut: "Ctrl+0",
      execute: () => {
        if (activeTab) api.zoom(activeTab.id, "reset");
      },
    },
    {
      id: "find-in-page",
      title: "Find in Page",
      shortcut: "Ctrl+F",
      execute: () => {
        if (activeTab) store.setFindOpen(true);
      },
    },
    {
      id: "search-tab-content",
      title: "Search Text in Open Tabs",
      subtitle: "Find a phrase across the content of every open tab",
      execute: () => store.openPalette("tabsearch"),
    },
    {
      id: "picture-in-picture",
      title: "Picture-in-Picture",
      subtitle: "Float the active video in an always-on-top mini player",
      execute: () => {
        if (activeTab) api.pip(activeTab.id);
      },
    },
    {
      id: "media-toggle",
      title: "Play / Pause Media",
      subtitle: "Toggle audio/video playback in the active tab",
      execute: () => {
        if (activeTab) api.mediaToggle(activeTab.id);
      },
    },
    {
      id: "paste-go",
      title: "Paste and Go",
      subtitle: "Open the URL or search currently on your clipboard",
      execute: () => {
        void navigator.clipboard.readText().then((text) => {
          const v = text.trim();
          if (v) store.openUrl(v);
        });
      },
    },
    {
      id: "add-search-engine",
      title: "Add Search Engine…",
      subtitle: "A key plus a URL containing %s — then use !key or Tab-to-search",
      execute: () =>
        store.openPalette("prompt", {
          title: "Add search engine",
          placeholder: "yt https://www.youtube.com/results?search_query=%s",
          action: (value) => {
            const v = value.trim();
            const sp = v.search(/\s/);
            if (sp < 0) return;
            const key = v.slice(0, sp).trim().replace(/^!/, "");
            const url = v.slice(sp + 1).trim();
            if (!key || !url.includes("%s")) {
              window.alert("Enter a key, then a URL containing %s for the query.");
              return;
            }
            let home = url;
            try {
              home = new URL(url).origin;
            } catch {
              /* keep raw url as home */
            }
            store.addCustomEngine(key, home, url);
          },
        }),
    },
    {
      id: "remove-search-engine",
      title: "Remove Search Engine…",
      subtitle: "Delete one of your custom search engines by key",
      execute: () =>
        store.openPalette("prompt", {
          title: "Remove search engine",
          placeholder: "key",
          action: (value) => {
            const key = value.trim().replace(/^!/, "");
            if (key) store.removeCustomEngine(key);
          },
        }),
    },
    {
      id: "pin-tab",
      title: activeTab?.pinned ? "Unpin Tab" : "Pin Tab",
      subtitle: activeTab?.pinned ? undefined : "Pinned tabs can't be closed",
      execute: () => {
        if (activeTab) store.pinTab(activeTab.id, !activeTab.pinned);
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
      id: "search-downloads",
      title: "Search Downloads",
      subtitle: "Enter opens the file, in-progress items open their folder",
      execute: () => store.openPalette("downloads"),
    },
    {
      id: "install-extension",
      title: "Install Extension (Load Unpacked)…",
      subtitle: "Pick a folder containing manifest.json — loads into every workspace",
      execute: () => void api.addExtension(),
    },
    {
      id: "install-extension-cws",
      title: "Install Extension from Chrome Web Store…",
      subtitle: "Paste a Web Store URL — content-script extensions work best",
      execute: () =>
        store.openPalette("prompt", {
          title: "Web Store URL or extension id",
          placeholder: "https://chromewebstore.google.com/detail/…",
          action: (value) => {
            if (!value.trim()) return;
            void api.addExtensionFromUrl(value.trim()).then((result) => {
              if (!result.ok && result.error) window.alert(`Install failed: ${result.error}`);
            });
          },
        }),
    },
    {
      id: "manage-extensions",
      title: "Manage Extensions",
      subtitle: "List installed extensions, Enter removes one",
      execute: () => store.openPalette("extensions"),
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
      id: "toggle-blocker",
      title: state.blockerEnabled ? "Disable Content Blocker" : "Enable Content Blocker",
      subtitle: "Blocks common tracker and ad hosts across all workspaces",
      execute: () => {
        void api.toggleBlocker().then((r) => store.setBlockerEnabled(r.enabled));
      },
    },
    {
      id: "change-theme",
      title: "Change Theme",
      subtitle: "Pick two colors for a gradient, Arc-style",
      execute: () => store.setThemePickerOpen(true),
    },
    {
      id: "reset-theme",
      title: "Reset Theme to Default",
      execute: () => store.setTheme(null),
    },
    {
      id: "set-default-browser",
      title: "Set as Default Browser",
      subtitle: "Register Minimal Browser, then open the system default-apps settings",
      execute: () => void api.setDefaultBrowser(),
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
