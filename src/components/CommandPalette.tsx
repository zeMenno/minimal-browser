import { useEffect, useMemo, useRef, useState } from "react";
import { selectActiveTab, useBrowserStore } from "../store";
import { buildCommands } from "../commands";
import { fuzzyScore } from "../fuzzy";
import { api, normalizeUrl } from "../api";
import { tryCalculate } from "../calc";
import type { BookmarkEntry, DownloadEntry, ExtensionInfo, HistoryEntry } from "../types";

interface Item {
  id: string;
  title: string;
  subtitle?: string;
  hint?: string;
  kind:
    | "command"
    | "tab"
    | "history"
    | "bookmark"
    | "download"
    | "extension"
    | "url"
    | "search"
    | "calc";
  run: () => void;
}

const MODE_LABEL: Record<string, string> = {
  all: "Commands",
  tabs: "Tabs",
  tabsearch: "Search in Tabs",
  history: "History",
  bookmarks: "Bookmarks",
  downloads: "Downloads",
  extensions: "Extensions",
};

function downloadHint(d: DownloadEntry): string {
  if (d.state === "progressing") {
    return d.totalBytes > 0
      ? `${Math.round((d.receivedBytes / d.totalBytes) * 100)}%`
      : "downloading…";
  }
  return d.state;
}

export function CommandPalette() {
  const state = useBrowserStore();
  const { paletteOpen, paletteMode, palettePrompt, closePalette } = state;

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searches, setSearches] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [tabSearch, setTabSearch] = useState<{ tabId: string; snippet: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQuery(palettePrompt?.initial ?? "");
      setSelected(0);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      if (paletteMode === "all" || paletteMode === "bookmarks") {
        void api.listBookmarks().then(setBookmarks);
      }
      if (paletteMode === "downloads") {
        void api.listDownloads().then(setDownloads);
      }
      if (paletteMode === "extensions") {
        void api.listExtensions().then(setExtensions);
      }
    }
  }, [paletteOpen, paletteMode, palettePrompt]);

  // Async history search (debounced)
  useEffect(() => {
    if (
      !paletteOpen ||
      paletteMode === "prompt" ||
      paletteMode === "tabs" ||
      paletteMode === "tabsearch"
    )
      return;
    if (paletteMode === "all" && !query) {
      setHistory([]);
      return;
    }
    const timer = setTimeout(() => {
      void api.searchHistory(query).then(setHistory);
    }, 100);
    return () => clearTimeout(timer);
  }, [query, paletteOpen, paletteMode]);

  // Live web search suggestions, mirroring the address bar (debounced).
  useEffect(() => {
    if (!paletteOpen || paletteMode !== "all" || !query.trim()) {
      setSearches([]);
      return;
    }
    const timer = setTimeout(() => {
      void api.fetchSearchSuggestions(query).then(setSearches);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, paletteOpen, paletteMode]);

  // Full-text search across the content of open tabs (main runs the search).
  useEffect(() => {
    if (!paletteOpen || paletteMode !== "tabsearch") return;
    if (!query.trim()) {
      setTabSearch([]);
      return;
    }
    const timer = setTimeout(() => {
      void api.searchTabContent(query).then(setTabSearch);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, paletteOpen, paletteMode]);

  const items = useMemo<Item[]>(() => {
    if (!paletteOpen || paletteMode === "prompt") return [];
    const store = useBrowserStore.getState();
    const out: { item: Item; score: number }[] = [];
    const push = (item: Item, text: string, weight = 1) => {
      const score = fuzzyScore(query, text);
      if (score > 0) out.push({ item, score: score * weight });
    };

    if (paletteMode === "all") {
      for (const cmd of buildCommands(state)) {
        push(
          {
            id: cmd.id,
            title: cmd.title,
            subtitle: cmd.subtitle,
            hint: cmd.shortcut,
            kind: "command",
            run: cmd.execute,
          },
          cmd.title,
          1.2
        );
      }
    }

    if (paletteMode === "all" || paletteMode === "tabs") {
      const activeId = selectActiveTab(state)?.id;
      for (const ws of state.workspaces) {
        for (const tabId of state.tabOrder[ws.id] ?? []) {
          const tab = state.tabs[tabId];
          if (!tab) continue;
          const isCurrent = tab.id === activeId;
          // In dedicated tab-switcher mode, skip the tab you're already on.
          if (paletteMode === "tabs" && isCurrent) continue;
          const flags = [
            isCurrent ? "current" : null,
            tab.pinned ? "pinned" : null,
            tab.poppedOut ? "popped out" : null,
            tab.suspended ? "suspended" : null,
          ].filter(Boolean);
          push(
            {
              id: `tab-${tab.id}`,
              title: tab.title || tab.url,
              subtitle: `${ws.name} · ${tab.url}`,
              hint: flags.length ? flags.join(" · ") : undefined,
              kind: "tab",
              run: () => store.activateTab(tab.id),
            },
            `${tab.title} ${tab.url} ${ws.name}`,
            1.1
          );
        }
      }
    }

    if (paletteMode === "all" || paletteMode === "bookmarks") {
      for (const b of bookmarks) {
        push(
          {
            id: `bm-${b.id}`,
            title: b.title || b.url,
            subtitle: b.url,
            hint: "bookmark",
            kind: "bookmark",
            run: () => store.openUrl(b.url),
          },
          `${b.title} ${b.url}`
        );
      }
    }

    if (paletteMode === "downloads") {
      for (const d of downloads) {
        push(
          {
            id: `dl-${d.id}`,
            title: d.filename,
            subtitle: d.savePath || d.url,
            hint: downloadHint(d),
            kind: "download",
            run: () => {
              if (d.state === "completed") void api.openDownload(d.id);
              else if (d.savePath) void api.showDownload(d.id);
            },
          },
          `${d.filename} ${d.url}`
        );
      }
    }

    if (paletteMode === "extensions") {
      for (const ext of extensions) {
        push(
          {
            id: `ext-${ext.path}`,
            title: ext.name + (ext.version ? ` v${ext.version}` : ""),
            subtitle: ext.path,
            hint: "↵ remove",
            kind: "extension",
            run: () => void api.removeExtension(ext.path),
          },
          `${ext.name} ${ext.path}`
        );
      }
    }

    if (paletteMode === "tabsearch") {
      // Server-filtered already, so bypass fuzzy and keep main's ordering.
      for (const r of tabSearch) {
        const tab = store.tabs[r.tabId];
        if (!tab) continue;
        out.push({
          item: {
            id: `tabsearch-${r.tabId}`,
            title: tab.title || tab.url,
            subtitle: r.snippet,
            hint: "↵ open tab",
            kind: "tab",
            run: () => store.activateTab(r.tabId),
          },
          score: 1,
        });
      }
    }

    if ((paletteMode === "all" && query) || paletteMode === "history") {
      for (const h of history) {
        push(
          {
            id: `h-${h.url}`,
            title: h.title || h.url,
            subtitle: h.url,
            hint: "history",
            kind: "history",
            run: () => store.openUrl(h.url),
          },
          `${h.title} ${h.url}`,
          0.9
        );
      }
    }

    if (paletteMode === "all" && query.trim()) {
      const seen = new Set([query.trim().toLowerCase()]);
      for (const s of searches) {
        const key = s.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        push(
          {
            id: `s-${key}`,
            title: s,
            hint: "search",
            kind: "search",
            run: () => store.openUrl(s),
          },
          s,
          0.85
        );
      }
    }

    out.sort((a, b) => b.score - a.score);
    const items = out.slice(0, 40).map((x) => x.item);

    // Instant calculator / unit-conversion result, pinned to the top so Enter
    // copies it (e.g. "1234*5", "20 km to mi", "100 f in c").
    if (paletteMode === "all") {
      const result = tryCalculate(query);
      if (result) {
        items.unshift({
          id: "calc",
          title: `= ${result}`,
          subtitle: query.trim(),
          hint: "↵ copy",
          kind: "calc",
          run: () => void navigator.clipboard.writeText(result),
        });
      }
    }

    if (paletteMode === "all" && query.trim()) {
      items.push({
        id: "open-url",
        title: `Open "${query.trim()}"`,
        subtitle: normalizeUrl(query),
        kind: "url",
        run: () => store.openUrl(query),
      });
    }
    return items;
  }, [paletteOpen, paletteMode, query, state, history, searches, bookmarks, downloads, extensions, tabSearch]);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!paletteOpen) return null;

  const submit = () => {
    if (palettePrompt) {
      const action = palettePrompt.action;
      closePalette();
      action(query);
      return;
    }
    const item = items[selected];
    if (!item) return;
    // Mode-switching commands re-open the palette; close first so they win
    closePalette();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="w-[620px] max-w-[90vw] overflow-hidden rounded-xl border border-[var(--mb-pane-border)] bg-[var(--mb-modal)] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-[var(--mb-pane-border)] px-4">
          <span className="rounded bg-[var(--mb-selected)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--mb-accent)]">
            {palettePrompt ? palettePrompt.title : MODE_LABEL[paletteMode]}
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={
              palettePrompt?.placeholder ??
              (paletteMode === "tabs" ? "Jump to tab…" : "Type a command or URL…")
            }
            className="w-full bg-transparent py-3.5 text-[15px] text-[#dbe2ea] placeholder-[#566174] outline-none"
            spellCheck={false}
          />
        </div>

        {!palettePrompt && (
          <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5">
            {items.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-[#566174]">No results</div>
            )}
            {items.map((item, i) => (
              <button
                key={item.id}
                data-index={i}
                onMouseEnter={() => setSelected(i)}
                onClick={submit}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                  i === selected ? "bg-[var(--mb-selected)]" : ""
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.kind === "command"
                      ? "bg-[var(--mb-accent)]"
                      : item.kind === "tab"
                        ? "bg-[#9ece6a]"
                        : item.kind === "bookmark"
                          ? "bg-[#e0af68]"
                          : item.kind === "download"
                            ? "bg-[#bb9af7]"
                            : item.kind === "search"
                              ? "bg-[#7dcfff]"
                              : item.kind === "calc"
                                ? "bg-[#73daca]"
                                : "bg-[#565f89]"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-[#cdd6e4]">{item.title}</span>
                  {item.subtitle && (
                    <span className="block truncate text-xs text-[#566174]">{item.subtitle}</span>
                  )}
                </span>
                {item.hint && (
                  <span className="shrink-0 text-[11px] text-[#566174]">{item.hint}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 border-t border-[var(--mb-pane-border)] px-4 py-2 text-[11px] text-[#566174]">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
