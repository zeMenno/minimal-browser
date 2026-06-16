import { useEffect } from "react";
import { useBrowserStore } from "../store";
import { api } from "../api";

/**
 * "What's playing" panel: lists every tab currently producing (or muted) audio
 * across all workspaces, with play/pause and mute controls plus jump-to-tab.
 * Opened from the TopBar media button; gated through overlay sync.
 */
export function MediaPanel() {
  const open = useBrowserStore((s) => s.mediaPanelOpen);
  const setOpen = useBrowserStore((s) => s.setMediaPanelOpen);
  const tabs = useBrowserStore((s) => s.tabs);
  const activateTab = useBrowserStore((s) => s.activateTab);
  const toggleMute = useBrowserStore((s) => s.toggleMute);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const mediaTabs = Object.values(tabs).filter((t) => t.audible || t.muted);

  return (
    <div
      className="fixed inset-0 z-[65]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="absolute right-3 top-11 w-[330px] overflow-hidden rounded-xl border border-[var(--mb-pane-border)] bg-[var(--mb-modal)] shadow-2xl shadow-black/60">
        <div className="border-b border-[var(--mb-pane-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#566174]">
          Media
        </div>
        {mediaTabs.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-[#566174]">
            No tabs are playing audio
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto py-1">
            {mediaTabs.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--mb-selected-soft)]"
              >
                {t.favicon ? (
                  <img src={t.favicon} alt="" className="h-4 w-4 shrink-0" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-sm bg-[var(--mb-surface)]" />
                )}
                <button
                  onClick={() => {
                    activateTab(t.id);
                    setOpen(false);
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[13px] text-[#cdd6e4]"
                  title={t.title || t.url}
                >
                  {t.title || t.url}
                </button>
                <button
                  title="Play / pause"
                  onClick={() => api.mediaToggle(t.id)}
                  className="shrink-0 rounded px-1.5 text-[13px] text-[#9aa6bb] hover:bg-[var(--mb-hover)] hover:text-[#dbe2ea]"
                >
                  ⏯
                </button>
                <button
                  title={t.muted ? "Unmute" : "Mute"}
                  onClick={() => toggleMute(t.id)}
                  className={`shrink-0 rounded px-1.5 text-[12px] hover:bg-[var(--mb-hover)] ${
                    t.muted ? "text-[#566174]" : "text-[var(--mb-accent)]"
                  }`}
                >
                  {t.muted ? "🔇" : "🔊"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
