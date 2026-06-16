import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { selectVisibleTabIds, useBrowserStore } from "../store";
import type { Tab } from "../types";
import { useState } from "react";

export function Sidebar() {
  const sidebarOpen = useBrowserStore((s) => s.sidebarOpen);
  const workspaces = useBrowserStore((s) => s.workspaces);
  const activeWorkspaceId = useBrowserStore((s) => s.activeWorkspaceId);
  const tabOrder = useBrowserStore((s) => s.tabOrder[s.activeWorkspaceId] ?? []);
  const tabs = useBrowserStore((s) => s.tabs);
  const switchWorkspace = useBrowserStore((s) => s.switchWorkspace);
  const openPalette = useBrowserStore((s) => s.openPalette);
  const createWorkspace = useBrowserStore((s) => s.createWorkspace);
  const newTab = useBrowserStore((s) => s.newTab);
  const focusAddress = useBrowserStore((s) => s.focusAddress);

  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [tabsOpen, setTabsOpen] = useState(true);

  if (!sidebarOpen) return null;

  const pinnedIds = tabOrder.filter((id) => tabs[id]?.pinned);
  const unpinnedIds = tabOrder.filter((id) => !tabs[id]?.pinned);

  return (
    <aside className="flex w-[230px] shrink-0 flex-col border-r border-black/30 bg-[#0d1117]/40">
      {/* Workspaces */}
      <div className="px-3 pt-3">

        <div className="mb-1.5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setWorkspacesOpen((o) => !o)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[#48536a] hover:text-[#7d8799]"
            aria-expanded={workspacesOpen}
          >
            <span
              className={`inline-block text-[8px] transition-transform ${workspacesOpen ? "rotate-90" : ""}`}
            >
              ▸
            </span>
            Workspaces
          </button>
          <button
            title="New workspace"
            onClick={() =>
              openPalette("prompt", {
                title: "New workspace",
                placeholder: "Workspace name…",
                action: (v) => createWorkspace(v.trim() || "Untitled"),
              })
            }
            className="rounded px-1.5 text-[#566174] hover:bg-[var(--mb-hover)] hover:text-[#9aa6bb]"
          >
            +
          </button>
        </div>
        {workspacesOpen && <div className="flex flex-col gap-0.5">
          {workspaces.map((ws, i) => (
            <button
              key={ws.id}
              onClick={() => switchWorkspace(ws.id)}
              className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[13px] ${ws.id === activeWorkspaceId
                  ? "bg-[var(--mb-selected)] text-[#cdd6e4]"
                  : "text-[#7d8799] hover:bg-[var(--mb-surface)]"
                }`}
            >
              <span className="w-3 text-[10px] text-[#48536a]">{i < 9 ? i + 1 : ""}</span>
              <span className="truncate">{ws.name}</span>
            </button>
          ))}
        </div>}
      </div>

      {/* Pinned tabs: per-workspace, unclosable, always one click away */}
      {pinnedIds.length > 0 && (
        <div className="mt-4 px-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#48536a]">
            Pinned
          </div>
          <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {pinnedIds.map((tabId) => (
                <SidebarTab key={tabId} tabId={tabId} />
              ))}
            </div>
          </SortableContext>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
        <div className="mb-1.5 flex items-center justify-between">
        <button
            type="button"
            onClick={() => setTabsOpen((o) => !o)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[#48536a] hover:text-[#7d8799]"
            aria-expanded={tabsOpen}
          >
            <span
              className={`inline-block text-[8px] transition-transform ${tabsOpen ? "rotate-90" : ""}`}
            >
              ▶
            </span>
            Tabs
          </button>
          <button
            title="New tab (Ctrl+T)"
            onClick={() => {
              newTab();
              focusAddress();
            }}
            className="rounded px-1.5 text-[#566174] hover:bg-[var(--mb-hover)] hover:text-[#9aa6bb]"
          >
            +
          </button>
        </div>
        {tabsOpen && <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <SortableContext items={unpinnedIds} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {unpinnedIds.map((tabId) => (
                <SidebarTab key={tabId} tabId={tabId} />
              ))}
            </div>
          </SortableContext>
        </div>}
      </div>

      <div className="border-t border-black/30 px-3 py-2 text-[11px] text-[#48536a]">
        <kbd className="rounded bg-[var(--mb-surface)] px-1 py-0.5">Ctrl+K</kbd> command palette
      </div>
    </aside>
  );
}

function SidebarTab({ tabId }: { tabId: string }) {
  const tab = useBrowserStore((s) => s.tabs[tabId]) as Tab | undefined;
  const isVisible = useBrowserStore((s) => selectVisibleTabIds(s).includes(tabId));
  const isActive = useBrowserStore((s) => {
    const ws = s.activeWorkspaceId;
    const paneId = s.activePane[ws];
    if (!paneId) return false;
    const layout = s.layouts[ws];
    const find = (n: typeof layout): boolean => {
      if (!n) return false;
      if (n.type === "leaf") return n.id === paneId && n.tabId === tabId;
      return n.children.some(find);
    };
    return find(layout);
  });
  const activateTab = useBrowserStore((s) => s.activateTab);
  const closeTab = useBrowserStore((s) => s.closeTab);
  const pinTab = useBrowserStore((s) => s.pinTab);
  const toggleMute = useBrowserStore((s) => s.toggleMute);
  const openTabMenu = useBrowserStore((s) => s.openTabMenu);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabId,
  });

  if (!tab) return null;

  const groupColor = tab.group ? colorForGroup(tab.group) : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderLeft: groupColor ? `3px solid ${groupColor}` : undefined,
      }}
      title={tab.group ? `Group: ${tab.group}` : undefined}
      {...attributes}
      {...listeners}
      onClick={() => activateTab(tabId)}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        closeTab(tabId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openTabMenu(tabId, e.clientX, e.clientY);
      }}
      className={`group flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[13px] ${isDragging ? "opacity-40" : ""
        } ${isActive
          ? "bg-[var(--mb-selected)] text-[#dbe2ea]"
          : isVisible
            ? "bg-[var(--mb-selected-soft)] text-[#aeb9cb]"
            : "text-[#7d8799] hover:bg-[var(--mb-surface)]"
        }`}
    >
      {tab.loading ? (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border border-[#48536a] border-t-[var(--mb-accent)]" />
      ) : tab.suspended ? (
        <span
          title="Suspended (frees memory, reloads on click)"
          className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] text-[#48536a]"
        >
          ☾
        </span>
      ) : tab.favicon ? (
        <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-[#222b39]" />
      )}
      <span className={`min-w-0 flex-1 truncate ${tab.suspended ? "opacity-60" : ""}`}>
        {tab.title || tab.url}
      </span>
      {(tab.muted || tab.audible) && (
        <button
          title={tab.muted ? "Unmute tab" : "Mute tab"}
          onClick={(e) => {
            e.stopPropagation();
            toggleMute(tabId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`shrink-0 rounded px-1 text-[11px] hover:bg-[var(--mb-hover)] ${
            tab.muted ? "text-[#566174]" : "text-[var(--mb-accent)]"
          }`}
        >
          {tab.muted ? "🔇" : "🔊"}
        </button>
      )}
      <span className="hidden shrink-0 items-center group-hover:flex">
        <button
          title={tab.pinned ? "Unpin tab" : "Pin tab (unclosable)"}
          onClick={(e) => {
            e.stopPropagation();
            pinTab(tabId, !tab.pinned);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`rounded px-1 hover:bg-[var(--mb-hover)] ${
            tab.pinned ? "text-[#e0af68]" : "text-[#566174] hover:text-[#c5cedd]"
          }`}
        >
          ⊼
        </button>
        {!tab.pinned && (
          <button
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tabId);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="rounded px-1 text-[#566174] hover:bg-[var(--mb-hover)] hover:text-[#c5cedd]"
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

/** Deterministic color for a tab-group label, derived from its name. */
function colorForGroup(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 60%)`;
}
