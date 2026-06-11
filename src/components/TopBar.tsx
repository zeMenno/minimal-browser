import { useEffect, useRef, useState } from "react";
import { selectActiveTab, useBrowserStore } from "../store";
import { api } from "../api";

export function TopBar() {
  const activeTab = useBrowserStore(selectActiveTab);
  const focusAddressNonce = useBrowserStore((s) => s.focusAddressNonce);
  const sidebarOpen = useBrowserStore((s) => s.sidebarOpen);
  const toggleSidebar = useBrowserStore((s) => s.toggleSidebar);
  const openPalette = useBrowserStore((s) => s.openPalette);
  const openUrl = useBrowserStore((s) => s.openUrl);
  const workspaceName = useBrowserStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.name ?? ""
  );

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tabUrl = activeTab?.url ?? "";
  useEffect(() => {
    if (!focused) setValue(tabUrl === "about:blank" ? "" : tabUrl);
  }, [tabUrl, focused, activeTab?.id]);

  useEffect(() => {
    if (focusAddressNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusAddressNonce]);

  const navBtn =
    "flex h-7 w-7 items-center justify-center rounded text-[#7d8799] hover:bg-[#1a212c] hover:text-[#c5cedd] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div
      className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-[#161b24] bg-[#0b0e14] pl-2 pr-[145px]"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} className="flex items-center gap-1.5">
        <button title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar} className={navBtn}>
          {sidebarOpen ? "◧" : "◨"}
        </button>
        <button
          title="Back"
          disabled={!activeTab?.canGoBack}
          onClick={() => activeTab && api.goBack(activeTab.id)}
          className={navBtn}
        >
          ←
        </button>
        <button
          title="Forward"
          disabled={!activeTab?.canGoForward}
          onClick={() => activeTab && api.goForward(activeTab.id)}
          className={navBtn}
        >
          →
        </button>
        <button
          title="Reload (Ctrl+R)"
          disabled={!activeTab}
          onClick={() => activeTab && api.reload(activeTab.id)}
          className={navBtn}
        >
          ⟳
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center gap-2 w-full max-w-[calc(100%-400px)] mx-auto">
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex h-[26px] min-w-0 flex-1 items-center gap-2 rounded-md bg-[#141a23] px-3"
        >
          {activeTab?.loading && (
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[#48536a] border-t-[#7aa2f7]" />
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => {
              setFocused(true);
              e.target.select();
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                openUrl(value);
                inputRef.current?.blur();
              } else if (e.key === "Escape") {
                setValue(tabUrl === "about:blank" ? "" : tabUrl);
                inputRef.current?.blur();
              }
            }}
            placeholder={activeTab ? "Search or enter URL…" : "Press Ctrl+T to open a tab"}
            disabled={!activeTab}
            className="w-full mx-auto bg-transparent text-[13px] text-[#aeb9cb] placeholder-[#48536a] outline-none"
            spellCheck={false}
          />
          <button
            title="Bookmark (Ctrl+D)"
            onClick={() =>
              activeTab &&
              activeTab.url !== "about:blank" &&
              void api.addBookmark({ title: activeTab.title, url: activeTab.url })
            }
            className="shrink-0 text-[#48536a] hover:text-[#e0af68]"
          >
            ☆
          </button>
        </div>

        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} className="flex items-center gap-1.5">
          <button
            title="Command palette (Ctrl+K)"
            onClick={() => openPalette("all")}
            className="flex h-[26px] items-center gap-2 rounded-md bg-[#141a23] px-2.5 text-[12px] text-[#566174] hover:text-[#9aa6bb]"
          >
            <span className="max-w-[120px] truncate">{workspaceName}</span>
            <kbd className="rounded bg-[#1d2430] px-1 text-[10px]">⌃K</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
