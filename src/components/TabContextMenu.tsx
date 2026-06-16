import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBrowserStore } from "../store";
import { api } from "../api";

interface MenuItem {
  label: string;
  hint?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  onClick: () => void;
}

/**
 * Right-click menu for sidebar tabs. Rendered at the App level (like the
 * command palette) and driven by `store.tabMenu`. While it's open the overlay
 * sync hides the native views, so this DOM menu paints cleanly above the panes.
 */
export function TabContextMenu() {
  const menu = useBrowserStore((s) => s.tabMenu);
  const tab = useBrowserStore((s) => (menu ? s.tabs[menu.tabId] : undefined));
  const tabs = useBrowserStore((s) => s.tabs);
  // Select the stable tabOrder map (returning a fresh `[]` from a selector would
  // make zustand's snapshot change every render and trigger an update loop).
  const tabOrderMap = useBrowserStore((s) => s.tabOrder);
  const closeTabMenu = useBrowserStore((s) => s.closeTabMenu);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Clamp the menu inside the viewport once we know its measured size.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - width - 8);
    const y = Math.min(menu.y, window.innerHeight - height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTabMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeTabMenu]);

  if (!menu || !tab) return null;

  const store = useBrowserStore.getState();
  const run = (fn: () => void) => () => {
    closeTabMenu();
    fn();
  };
  const isStart = tab.url === "about:blank";
  const order = tabOrderMap[tab.workspaceId] ?? [];
  const idx = order.indexOf(menu.tabId);
  const otherCount = order.filter((id) => id !== menu.tabId && !tabs[id]?.pinned).length;
  const rightCount = order.slice(idx + 1).filter((id) => !tabs[id]?.pinned).length;

  const items: MenuItem[] = [
    {
      label: tab.muted ? "Unmute Tab" : "Mute Tab",
      hint: tab.audible && !tab.muted ? "♪" : undefined,
      onClick: run(() => store.toggleMute(menu.tabId)),
    },
    { label: "Reload", onClick: run(() => api.reload(menu.tabId)) },
    { label: "Duplicate", onClick: run(() => store.duplicateTab(menu.tabId)) },
    {
      label: tab.pinned ? "Unpin Tab" : "Pin Tab",
      onClick: run(() => store.pinTab(menu.tabId, !tab.pinned)),
    },
  ];

  if (!isStart) {
    items.push(
      {
        label: "Copy URL",
        onClick: run(() => void navigator.clipboard.writeText(tab.url)),
      },
      {
        label: "Bookmark",
        onClick: run(() => void api.addBookmark({ title: tab.title, url: tab.url })),
      },
    );
    if (!tab.poppedOut) {
      items.push({
        label: "Pop Out",
        onClick: run(() => store.popOutTab(menu.tabId)),
      });
    }
  }

  items.push({
    label: tab.group ? `Group: ${tab.group}` : "Set Group…",
    hint: tab.group ? "change" : undefined,
    separatorBefore: true,
    onClick: run(() =>
      store.openPalette("prompt", {
        title: tab.group ? `Group for "${tab.title}"` : "Add tab to group",
        placeholder: "Group name (empty to clear)",
        initial: tab.group ?? "",
        action: (value) => store.setTabGroup(menu.tabId, value.trim() || null),
      })
    ),
  });

  if (!tab.pinned) {
    items.push({
      label: "Close Tab",
      hint: "Ctrl+W",
      danger: true,
      separatorBefore: true,
      onClick: run(() => store.closeTab(menu.tabId)),
    });
  }
  if (otherCount > 0) {
    items.push({
      label: "Close Other Tabs",
      danger: true,
      separatorBefore: tab.pinned,
      onClick: run(() => store.closeOtherTabs(menu.tabId)),
    });
  }
  if (rightCount > 0) {
    items.push({
      label: "Close Tabs to the Right",
      danger: true,
      onClick: run(() => store.closeTabsToRight(menu.tabId)),
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeTabMenu();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        closeTabMenu();
      }}
    >
      <div
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        className="absolute min-w-[200px] overflow-hidden rounded-lg border border-[var(--mb-pane-border)] bg-[var(--mb-modal)] py-1 shadow-2xl shadow-black/60"
      >
        {items.map((item, i) => (
          <div key={i}>
            {item.separatorBefore && (
              <div className="my-1 border-t border-[var(--mb-pane-border)]" />
            )}
            <button
              onClick={item.onClick}
              className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--mb-selected)] ${
                item.danger ? "text-[#d98a8a] hover:text-[#f7768e]" : "text-[#cdd6e4]"
              }`}
            >
              <span>{item.label}</span>
              {item.hint && <span className="text-[11px] text-[#566174]">{item.hint}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
