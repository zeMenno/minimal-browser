import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectActiveTab, useBrowserStore } from "../store";
import { api, knownEngines } from "../api";
import type { Tab } from "../types";
import { useAutocomplete } from "../suggest";
import { AddressSuggestions } from "./AddressSuggestions";

export function TopBar() {
  const activeTab = useBrowserStore(selectActiveTab);
  const focusAddressNonce = useBrowserStore((s) => s.focusAddressNonce);
  const sidebarOpen = useBrowserStore((s) => s.sidebarOpen);
  const toggleSidebar = useBrowserStore((s) => s.toggleSidebar);
  const openPalette = useBrowserStore((s) => s.openPalette);
  const openUrl = useBrowserStore((s) => s.openUrl);
  const setAddressOpen = useBrowserStore((s) => s.setAddressOpen);
  const workspaceName = useBrowserStore(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.name ?? ""
  );

  // `query` is what the user actually typed (drives suggestions); `display` is
  // what the input shows, which may include the selected inline-completion tail.
  const [query, setQuery] = useState("");
  const [display, setDisplay] = useState("");
  const [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const allowComplete = useRef(true);
  const completionActive = useRef(false);
  const pendingSel = useRef<[number, number] | null>(null);

  const { suggestions, inlineCompletion } = useAutocomplete(query, focused);
  const showDropdown = focused && query.trim().length > 0 && suggestions.length > 0;

  const tabUrl = activeTab?.url ?? "";
  useEffect(() => {
    if (!focused) {
      const v = tabUrl === "about:blank" ? "" : tabUrl;
      setQuery(v);
      setDisplay(v);
      completionActive.current = false;
    }
  }, [tabUrl, focused, activeTab?.id]);

  useEffect(() => {
    if (focusAddressNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusAddressNonce]);

  // The native page paints above the DOM, so the dropdown can only be seen
  // while the page view is hidden via the shared overlay mechanism.
  useEffect(() => {
    setAddressOpen(showDropdown);
  }, [showDropdown, setAddressOpen]);
  useEffect(() => () => setAddressOpen(false), [setAddressOpen]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Apply inline autocomplete: fill the input with the best prefix match and
  // select the appended tail, but never while the user is deleting.
  useEffect(() => {
    if (!focused) return;
    const valid =
      allowComplete.current &&
      inlineCompletion &&
      query.length > 0 &&
      inlineCompletion.value.toLowerCase().startsWith(query.toLowerCase()) &&
      inlineCompletion.value.length > query.length;
    if (valid && inlineCompletion) {
      setDisplay(inlineCompletion.value);
      completionActive.current = true;
      pendingSel.current = [query.length, inlineCompletion.value.length];
    } else if (completionActive.current) {
      setDisplay(query);
      completionActive.current = false;
    }
  }, [inlineCompletion, query, focused]);

  useLayoutEffect(() => {
    if (pendingSel.current && inputRef.current) {
      const [s, e] = pendingSel.current;
      pendingSel.current = null;
      try {
        inputRef.current.setSelectionRange(s, e);
      } catch {
        /* selection not applicable */
      }
    }
  });

  const acceptCompletion = (): boolean => {
    if (!completionActive.current || !inlineCompletion) return false;
    const v = inlineCompletion.value;
    allowComplete.current = false;
    completionActive.current = false;
    setQuery(v);
    setDisplay(v);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(v.length, v.length));
    return true;
  };

  const dismiss = () => {
    setFocused(false);
    setAddressOpen(false);
    inputRef.current?.blur();
  };

  const runSuggestion = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    dismiss();
    s.run();
  };

  const commit = () => {
    if (completionActive.current && inlineCompletion) {
      const url = inlineCompletion.url;
      dismiss();
      openUrl(url);
      return;
    }
    if (showDropdown && suggestions[selected]) {
      runSuggestion(selected);
      return;
    }
    dismiss();
    openUrl(query);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    const inputType = (e.nativeEvent as InputEvent).inputType ?? "";
    allowComplete.current = !inputType.startsWith("delete");
    completionActive.current = false;
    setQuery(v);
    setDisplay(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      allowComplete.current = false;
      if (completionActive.current) {
        completionActive.current = false;
        setDisplay(query);
      }
      if (showDropdown) setSelected((s) => Math.min(s + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      allowComplete.current = false;
      if (completionActive.current) {
        completionActive.current = false;
        setDisplay(query);
      }
      if (showDropdown) setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Tab") {
      if (completionActive.current) {
        e.preventDefault();
        acceptCompletion();
        return;
      }
      // Tab-to-search: a bare engine key ("gh") or a known engine's domain
      // ("github.com") scopes the next keystrokes to that engine's search.
      const token = query.trim().toLowerCase();
      if (token && !token.includes(" ")) {
        const engine = knownEngines().find(
          (en) => en.key === token || engineHostMatches(en.home, token)
        );
        if (engine) {
          e.preventDefault();
          const next = `!${engine.key} `;
          completionActive.current = false;
          setQuery(next);
          setDisplay(next);
        }
      }
    } else if (e.key === "ArrowRight") {
      const el = inputRef.current;
      if (completionActive.current && el && el.selectionEnd === display.length) {
        acceptCompletion();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      const v = tabUrl === "about:blank" ? "" : tabUrl;
      setQuery(v);
      setDisplay(v);
      completionActive.current = false;
      dismiss();
    }
  };

  const navBtn =
    "flex h-7 w-7 items-center justify-center rounded text-[#7d8799] hover:bg-[var(--mb-hover)] hover:text-[#c5cedd] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div
      className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-black/30 bg-transparent pl-2 pr-[145px]"
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
          className="relative min-w-0 flex-1"
        >
          <div className="flex h-[26px] items-center gap-2 rounded-md bg-[var(--mb-surface)] px-3">
            {activeTab?.loading && (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[#48536a] border-t-[var(--mb-accent)]" />
            )}
            <input
              ref={inputRef}
              value={display}
              onChange={onChange}
              onFocus={(e) => {
                setFocused(true);
                e.target.select();
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              placeholder={activeTab ? "Search or enter URL…" : "Press Ctrl+T to open a tab"}
              disabled={!activeTab}
              className="w-full mx-auto bg-transparent text-[13px] text-[#aeb9cb] placeholder-[#48536a] outline-none"
              spellCheck={false}
              autoComplete="off"
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
          {showDropdown && (
            <AddressSuggestions
              suggestions={suggestions}
              selected={selected}
              query={query}
              onHover={setSelected}
              onRun={runSuggestion}
            />
          )}
        </div>

        <FindBar activeTab={activeTab} />
        <ShieldIndicator activeTab={activeTab} />
        <DownloadIndicator />
        <UpdateIndicator />
        <MediaIndicator />

        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} className="flex items-center gap-1.5">
          <button
            title="Command palette (Ctrl+K)"
            onClick={() => openPalette("all")}
            className="flex h-[26px] items-center gap-2 rounded-md bg-[var(--mb-surface)] px-2.5 text-[12px] text-[#566174] hover:text-[#9aa6bb]"
          >
            <span className="max-w-[120px] truncate">{workspaceName}</span>
            <kbd className="rounded bg-[var(--mb-surface)] px-1 text-[10px]">⌃K</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/** True when `token` names the host of `home` (e.g. "github" / "github.com"). */
function engineHostMatches(home: string, token: string): boolean {
  try {
    const host = new URL(home).hostname.replace(/^www\./, "").toLowerCase();
    return host === token || host.split(".")[0] === token;
  } catch {
    return false;
  }
}

function MediaIndicator() {
  const hasMedia = useBrowserStore((s) =>
    Object.values(s.tabs).some((t) => t.audible || t.muted)
  );
  const mediaPanelOpen = useBrowserStore((s) => s.mediaPanelOpen);
  const setMediaPanelOpen = useBrowserStore((s) => s.setMediaPanelOpen);
  if (!hasMedia) return null;
  return (
    <button
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title="Media — what's playing"
      onClick={() => setMediaPanelOpen(!mediaPanelOpen)}
      className="flex h-[26px] shrink-0 items-center rounded-md bg-[var(--mb-surface)] px-2 text-[13px] text-[var(--mb-accent)] hover:text-[#dbe2ea]"
    >
      ♪
    </button>
  );
}

function ShieldIndicator({ activeTab }: { activeTab: Tab | null }) {
  const blockerEnabled = useBrowserStore((s) => s.blockerEnabled);
  const openPalette = useBrowserStore((s) => s.openPalette);
  const blocked = activeTab?.blocked ?? 0;
  if (!blockerEnabled || blocked === 0) return null;
  return (
    <button
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title={`${blocked} tracker${blocked > 1 ? "s" : ""} blocked on this page`}
      onClick={() => openPalette("all")}
      className="flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-[var(--mb-surface)] px-2 text-[12px] text-[#9ece6a] hover:text-[#b9e08c]"
    >
      <span>🛡</span>
      {blocked}
    </button>
  );
}

function DownloadIndicator() {
  const count = useBrowserStore((s) => s.activeDownloadCount);
  const openPalette = useBrowserStore((s) => s.openPalette);
  if (count === 0) return null;
  return (
    <button
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title={`${count} download${count > 1 ? "s" : ""} in progress`}
      onClick={() => openPalette("downloads")}
      className="flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-[var(--mb-surface)] px-2 text-[12px] text-[#bb9af7] hover:text-[#d7c5fb]"
    >
      <span className="animate-bounce">↓</span>
      {count}
    </button>
  );
}

interface UpdateStatus {
  state: "available" | "downloading" | "ready" | "error";
  version?: string;
  percent?: number;
}

/**
 * Discord-style update affordance: once a new version finishes downloading in
 * the background, a green download arrow appears here; clicking it restarts the
 * browser into the update. While downloading it shows a muted, animated arrow.
 */
function UpdateIndicator() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(
    () => api.on("update:status", (payload: UpdateStatus) => setStatus(payload)),
    []
  );

  // Nothing to show until an update is at least downloading; errors stay silent.
  if (!status || status.state === "available" || status.state === "error") return null;

  const ready = status.state === "ready";
  const title = ready
    ? `Update${status.version ? ` ${status.version}` : ""} ready — click to restart & install`
    : `Downloading update… ${status.percent ?? 0}%`;

  return (
    <button
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title={title}
      disabled={!ready}
      onClick={() => ready && api.installUpdate()}
      className="flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-[var(--mb-surface)] px-2 text-[12px] text-[#9ece6a] hover:text-[#b9e08c] disabled:cursor-default"
    >
      <span className={ready ? "" : "animate-bounce opacity-70"}>↓</span>
      {ready ? null : <span className="tabular-nums opacity-70">{status.percent ?? 0}%</span>}
    </button>
  );
}

function FindBar({ activeTab }: { activeTab: Tab | null }) {
  const findOpen = useBrowserStore((s) => s.findOpen);
  const setFindOpen = useBrowserStore((s) => s.setFindOpen);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ matches: number; active: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabId = activeTab?.id;

  useEffect(() => {
    if (findOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    } else {
      setResult(null);
    }
  }, [findOpen]);

  useEffect(
    () =>
      api.on("tab:found", (payload: { tabId: string; matches: number; active: number }) => {
        if (payload.tabId === tabId) {
          setResult({ matches: payload.matches, active: payload.active });
        }
      }),
    [tabId]
  );

  if (!findOpen || !tabId) return null;

  const close = () => {
    api.stopFind(tabId);
    setFindOpen(false);
    api.focusTab(tabId);
  };

  const search = (value: string) => {
    setText(value);
    if (value) api.find(tabId, value, true, false);
    else {
      api.stopFind(tabId);
      setResult(null);
    }
  };

  return (
    <div
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className="flex h-[26px] shrink-0 items-center gap-2 rounded-md border border-[var(--mb-pane-border)] bg-[var(--mb-surface)] px-2"
    >
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (text) api.find(tabId, text, !e.shiftKey, true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
        placeholder="Find in page…"
        className="w-[150px] bg-transparent text-[12.5px] text-[#aeb9cb] placeholder-[#48536a] outline-none"
        spellCheck={false}
      />
      <span className="shrink-0 text-[11px] tabular-nums text-[#566174]">
        {result ? `${result.active}/${result.matches}` : ""}
      </span>
      <button
        title="Previous (Shift+Enter)"
        onClick={() => text && api.find(tabId, text, false, true)}
        className="text-[#566174] hover:text-[#c5cedd]"
      >
        ↑
      </button>
      <button
        title="Next (Enter)"
        onClick={() => text && api.find(tabId, text, true, true)}
        className="text-[#566174] hover:text-[#c5cedd]"
      >
        ↓
      </button>
      <button title="Close (Esc)" onClick={close} className="text-[#566174] hover:text-[#c5cedd]">
        ×
      </button>
    </div>
  );
}
