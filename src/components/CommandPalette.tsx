import { useEffect, useMemo, useRef, useState } from "react";
import { useBrowserStore } from "../store";
import { buildCommands } from "../commands";
import { fuzzyScore } from "../fuzzy";
import { api, normalizeUrl } from "../api";
import type { BookmarkEntry, HistoryEntry } from "../types";

interface Item {
  id: string;
  title: string;
  subtitle?: string;
  hint?: string;
  kind: "command" | "tab" | "history" | "bookmark" | "url";
  run: () => void;
}

const MODE_LABEL: Record<string, string> = {
  all: "Commands",
  tabs: "Tabs",
  history: "History",
  bookmarks: "Bookmarks",
};

export function CommandPalette() {
  const state = useBrowserStore();
  const { paletteOpen, paletteMode, palettePrompt, closePalette } = state;

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
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
    }
  }, [paletteOpen, paletteMode, palettePrompt]);

  // Async history search (debounced)
  useEffect(() => {
    if (!paletteOpen || paletteMode === "prompt" || paletteMode === "tabs") return;
    if (paletteMode === "all" && !query) {
      setHistory([]);
      return;
    }
    const timer = setTimeout(() => {
      void api.searchHistory(query).then(setHistory);
    }, 100);
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
      for (const ws of state.workspaces) {
        for (const tabId of state.tabOrder[ws.id] ?? []) {
          const tab = state.tabs[tabId];
          if (!tab) continue;
          push(
            {
              id: `tab-${tab.id}`,
              title: tab.title || tab.url,
              subtitle: `${ws.name} · ${tab.url}`,
              kind: "tab",
              run: () => store.activateTab(tab.id),
            },
            `${tab.title} ${tab.url}`,
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

    out.sort((a, b) => b.score - a.score);
    const items = out.slice(0, 40).map((x) => x.item);

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
  }, [paletteOpen, paletteMode, query, state, history, bookmarks]);

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
      <div className="w-[620px] max-w-[90vw] overflow-hidden rounded-xl border border-[#2a3340] bg-[#141a22] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-[#222a35] px-4">
          <span className="rounded bg-[#22304a] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#7aa2f7]">
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
                  i === selected ? "bg-[#1d2735]" : ""
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.kind === "command"
                      ? "bg-[#7aa2f7]"
                      : item.kind === "tab"
                        ? "bg-[#9ece6a]"
                        : item.kind === "bookmark"
                          ? "bg-[#e0af68]"
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

        <div className="flex items-center gap-4 border-t border-[#222a35] px-4 py-2 text-[11px] text-[#566174]">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
