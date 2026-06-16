import { useEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { LayoutNode, LeafNode, SplitNode, SplitSide } from "../types";
import { useBrowserStore } from "../store";
import { leaves } from "../layout";
import { api } from "../api";
import { StartPage } from "./StartPage";

export function SplitView() {
  const layout = useBrowserStore((s) => s.layouts[s.activeWorkspaceId] ?? null);

  if (!layout) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#566174]">
        <div className="text-lg">No open tabs</div>
        <div className="text-sm">
          Press <kbd className="rounded bg-[var(--mb-surface)] px-1.5 py-0.5 text-xs">Ctrl+T</kbd> for a new
          tab or <kbd className="rounded bg-[var(--mb-surface)] px-1.5 py-0.5 text-xs">Ctrl+K</kbd> for the
          command palette
        </div>
      </div>
    );
  }
  return <Node node={layout} />;
}

function Node({ node }: { node: LayoutNode }) {
  if (node.type === "leaf") return <Pane node={node} />;
  return <Split node={node} />;
}

function Split({ node }: { node: SplitNode }) {
  const setSizes = useBrowserStore((s) => s.setSizes);
  const setResizing = useBrowserStore((s) => s.setResizing);
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = node.dir === "row" ? rect.width : rect.height;
    const startPos = node.dir === "row" ? e.clientX : e.clientY;
    const startSizes = [...node.sizes];
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const pos = node.dir === "row" ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / total;
      const next = [...startSizes];
      const moved = Math.max(
        -startSizes[index] + 0.1,
        Math.min(startSizes[index + 1] - 0.1, delta)
      );
      next[index] = startSizes[index] + moved;
      next[index + 1] = startSizes[index + 1] - moved;
      setSizes(node.id, next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full min-h-0 min-w-0 ${node.dir === "row" ? "flex-row" : "flex-col"}`}
    >
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          {i > 0 && (
            <div
              onPointerDown={(e) => startDrag(i - 1, e)}
              className={`shrink-0 bg-transparent transition-colors hover:bg-[var(--mb-pane-active)] ${
                node.dir === "row" ? "w-[3px] cursor-col-resize" : "h-[3px] cursor-row-resize"
              }`}
            />
          )}
          <div style={{ flex: `${node.sizes[i]} 1 0%` }} className="flex min-h-0 min-w-0">
            <Node node={child} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Pane({ node }: { node: LeafNode }) {
  const tab = useBrowserStore((s) => s.tabs[node.tabId]);
  const isActive = useBrowserStore(
    (s) => s.activePane[s.activeWorkspaceId] === node.id
  );
  const dragging = useBrowserStore((s) => s.dragging);
  // Only split (multi-pane) layouts get a pane header with a close button; a
  // lone pane keeps the full-bleed look and is closed from the sidebar instead.
  const multiPane = useBrowserStore(
    (s) => leaves(s.layouts[s.activeWorkspaceId]).length > 1
  );
  const setActivePane = useBrowserStore((s) => s.setActivePane);
  const closePane = useBrowserStore((s) => s.closePane);
  const contentRef = useRef<HTMLDivElement>(null);
  const isStartPage = tab?.url === "about:blank";

  // Report the *content* rectangle (below any header) to the main process so it
  // can position the native WebContentsView. The header is plain DOM and must
  // stay uncovered, so it's excluded from these bounds. Re-runs when the header
  // appears/disappears (multiPane) so the view resizes to match.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !tab || isStartPage) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      api.setTabBounds(tab.id, {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [tab?.id, isStartPage, multiPane]);

  if (!tab) return null;

  return (
    <div
      className={`relative m-[2px] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border ${
        isActive ? "border-[var(--mb-pane-active)]" : "border-[var(--mb-pane-border)]"
      }`}
      onMouseDown={() => setActivePane(node.id)}
    >
      {multiPane && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--mb-pane-border)] bg-[var(--mb-pane)] px-2">
          {tab.favicon ? (
            <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0 opacity-80" />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-[var(--mb-surface)]" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#8b96a8]">
            {tab.title || tab.url}
          </span>
          <button
            title="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              closePane(node.id);
            }}
            className="shrink-0 rounded px-1.5 text-[13px] leading-none text-[#566174] hover:bg-[var(--mb-hover)] hover:text-[#c5cedd]"
          >
            ×
          </button>
        </div>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {isStartPage ? (
          <StartPage />
        ) : (
          /* Fallback content, visible whenever the native view is hidden
             (command palette open, drag in progress, divider resize) */
          <div
            ref={contentRef}
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--mb-pane)]"
          >
            {tab.favicon ? (
              <img src={tab.favicon} alt="" className="h-6 w-6 opacity-60" />
            ) : (
              <div className="h-6 w-6 rounded bg-[var(--mb-surface)]" />
            )}
            <div className="max-w-[80%] truncate text-sm text-[#8b96a8]">{tab.title || tab.url}</div>
            <div className="max-w-[80%] truncate text-xs text-[#48536a]">{tab.url}</div>
          </div>
        )}

        {dragging && <DropZones paneId={node.id} />}
      </div>
    </div>
  );
}

const ZONES: { zone: "center" | SplitSide; className: string }[] = [
  { zone: "center", className: "inset-[28%]" },
  { zone: "left", className: "left-0 top-0 bottom-0 w-[28%]" },
  { zone: "right", className: "right-0 top-0 bottom-0 w-[28%]" },
  { zone: "up", className: "top-0 left-[28%] right-[28%] h-[28%]" },
  { zone: "down", className: "bottom-0 left-[28%] right-[28%] h-[28%]" },
];

function DropZones({ paneId }: { paneId: string }) {
  return (
    <div className="absolute inset-0 z-10">
      {ZONES.map(({ zone, className }) => (
        <DropZone key={zone} paneId={paneId} zone={zone} className={className} />
      ))}
    </div>
  );
}

function DropZone({
  paneId,
  zone,
  className,
}: {
  paneId: string;
  zone: "center" | SplitSide;
  className: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `zone:${paneId}:${zone}` });
  return (
    <div
      ref={setNodeRef}
      className={`absolute rounded border-2 border-dashed transition-colors ${className} ${
        isOver ? "border-[var(--mb-accent)] bg-[var(--mb-accent)]/15" : "border-transparent"
      }`}
    />
  );
}
