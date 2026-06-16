import { useEffect, useMemo, useRef, useState } from "react";
import { useBrowserStore } from "./store";
import {
  api,
  BANG_LABELS,
  isExternalProtocol,
  normalizeUrl,
  parseBang,
} from "./api";
import { fuzzyScore } from "./fuzzy";
import type { BookmarkEntry, HistoryEntry } from "./types";

export type SuggestionKind =
  | "topHit"
  | "history"
  | "bookmark"
  | "tab"
  | "search"
  | "url"
  | "bang";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  subtitle?: string;
  /** Destination URL (for navigation rows and favicon resolution). */
  url?: string;
  /** Explicit favicon URL, when known (e.g. an open tab's favicon). */
  favicon?: string;
  run: () => void;
}

/** What the address bar should auto-fill while typing, plus where Enter goes. */
export interface InlineCompletion {
  /** Full display string to put in the input (typed prefix + completion). */
  value: string;
  /** The URL Enter / Tab should navigate to when this completion is shown. */
  url: string;
}

export interface AutocompleteResult {
  suggestions: Suggestion[];
  inlineCompletion: InlineCompletion | null;
}

const MAX_SUGGESTIONS = 8;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^[a-z]+:\/\//i, "").replace(/^www\./, "").split("/")[0];
  }
}

/** A stable de-dup key so the same page from different sources collapses. */
function normKey(url: string): string {
  return url
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function faviconFor(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=32`;
}

/** Heuristic mirror of normalizeUrl: does this input point at a page, not a search? */
function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes(" ")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t)) return true;
  if (t === "localhost" || /^localhost:\d+/.test(t)) return true;
  return t.includes(".");
}

interface LocalCandidate {
  kind: "history" | "bookmark" | "tab";
  title: string;
  url: string;
  favicon?: string;
  score: number;
  run: () => void;
}

/**
 * Address-bar autocomplete engine. Aggregates local sources (open tabs,
 * frecency-ranked history, bookmarks) synchronously and live Google search
 * suggestions asynchronously, then merges, de-duplicates and ranks them into a
 * single ordered list plus an inline-completion candidate.
 */
export function useAutocomplete(query: string, enabled: boolean): AutocompleteResult {
  const tabs = useBrowserStore((s) => s.tabs);
  const tabOrder = useBrowserStore((s) => s.tabOrder);
  const workspaces = useBrowserStore((s) => s.workspaces);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [searches, setSearches] = useState<string[]>([]);
  const reqId = useRef(0);

  // Bookmarks are small and rarely change while typing: load once per session.
  useEffect(() => {
    if (enabled) void api.listBookmarks().then(setBookmarks);
  }, [enabled]);

  // Async sources: frecency history + live Google suggestions. Both are
  // guarded by a monotonically increasing request id so stale responses
  // (slower network round-trips) never overwrite newer results.
  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || !trimmed) {
      setHistory([]);
      setSearches([]);
      return;
    }
    const id = ++reqId.current;
    const historyTimer = setTimeout(() => {
      void api.autocompleteHistory(trimmed).then((rows) => {
        if (reqId.current === id) setHistory(rows);
      });
    }, 60);
    const searchTimer = setTimeout(() => {
      void api.fetchSearchSuggestions(trimmed).then((list) => {
        if (reqId.current === id) setSearches(list);
      });
    }, 140);
    return () => {
      clearTimeout(historyTimer);
      clearTimeout(searchTimer);
    };
  }, [query, enabled]);

  return useMemo<AutocompleteResult>(() => {
    const q = query.trim();
    if (!enabled || !q) return { suggestions: [], inlineCompletion: null };

    const store = useBrowserStore.getState();
    const ql = q.toLowerCase();

    // --- Local candidates: open tabs, history, bookmarks ---
    const local: LocalCandidate[] = [];

    for (const ws of workspaces) {
      for (const tabId of tabOrder[ws.id] ?? []) {
        const tab = tabs[tabId];
        if (!tab || !tab.url || tab.url === "about:blank") continue;
        const score = fuzzyScore(q, `${tab.title} ${tab.url}`);
        if (score <= 0) continue;
        local.push({
          kind: "tab",
          title: tab.title || tab.url,
          url: tab.url,
          favicon: tab.favicon,
          score: score * 1.15,
          run: () => store.activateTab(tab.id),
        });
      }
    }

    for (const h of history) {
      const score = fuzzyScore(q, `${h.title} ${h.url}`);
      if (score <= 0) continue;
      local.push({
        kind: "history",
        title: h.title || h.url,
        url: h.url,
        score,
        run: () => store.openUrl(h.url),
      });
    }

    for (const b of bookmarks) {
      const score = fuzzyScore(q, `${b.title} ${b.url}`);
      if (score <= 0) continue;
      local.push({
        kind: "bookmark",
        title: b.title || b.url,
        url: b.url,
        score: score * 1.05,
        run: () => store.openUrl(b.url),
      });
    }

    // De-dup the same page across sources, keeping the highest-scoring one.
    const byKey = new Map<string, LocalCandidate>();
    for (const c of local) {
      const key = normKey(c.url);
      const existing = byKey.get(key);
      if (!existing || c.score > existing.score) byKey.set(key, c);
    }
    const localRanked = [...byKey.values()].sort((a, b) => b.score - a.score);

    // --- Top hit: bang > direct URL > best local match > search ---
    const out: Suggestion[] = [];
    const usedKeys = new Set<string>();
    const bang = parseBang(q);

    if (bang) {
      const label = BANG_LABELS[bang.key] ?? bang.key;
      out.push({
        id: "bang",
        kind: "bang",
        title: bang.query ? `Search ${label} for "${bang.query}"` : `Open ${label}`,
        subtitle: normalizeUrl(q),
        url: bang.bang.home,
        run: () => store.openUrl(q),
      });
    } else if (looksLikeUrl(q) && !isExternalProtocol(normalizeUrl(q))) {
      const url = normalizeUrl(q);
      out.push({
        id: "url",
        kind: "url",
        title: q,
        subtitle: `Visit ${url}`,
        url,
        favicon: faviconFor(url),
        run: () => store.openUrl(q),
      });
    } else if (localRanked.length > 0) {
      const top = localRanked[0];
      usedKeys.add(normKey(top.url));
      out.push({
        id: `top-${top.kind}`,
        kind: "topHit",
        title: top.title,
        subtitle: top.url,
        url: top.url,
        favicon: top.favicon ?? faviconFor(top.url),
        run: top.run,
      });
    } else {
      out.push({
        id: "search-top",
        kind: "search",
        title: q,
        subtitle: "Search the web",
        run: () => store.openUrl(q),
      });
    }

    // --- Remaining local matches ---
    for (const c of localRanked) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const key = normKey(c.url);
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      out.push({
        id: `${c.kind}-${key}`,
        kind: c.kind,
        title: c.title,
        subtitle: c.kind === "tab" ? "Switch to tab" : c.url,
        url: c.url,
        favicon: c.favicon ?? faviconFor(c.url),
        run: c.run,
      });
    }

    // --- Live search suggestions (skip ones we already showed / the query) ---
    const seenSearch = new Set<string>([ql]);
    for (const s of searches) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const key = s.toLowerCase().trim();
      if (!key || seenSearch.has(key)) continue;
      seenSearch.add(key);
      out.push({
        id: `search-${key}`,
        kind: "search",
        title: s,
        run: () => store.openUrl(s),
      });
    }

    // Guarantee a "search for what I typed" escape hatch when it wasn't the
    // top hit, so the dropdown always offers a plain web search.
    if (!bang && !looksLikeUrl(q) && out[0]?.kind !== "search") {
      out.push({
        id: "search-fallback",
        kind: "search",
        title: q,
        subtitle: "Search the web",
        run: () => store.openUrl(q),
      });
    }

    // --- Inline completion: complete to the domain of the best prefix match.
    // Domain-level (not full path) keeps the behavior predictable, matching
    // Firefox/Chrome: typing "you" fills "youtube.com", Enter visits the host.
    let inlineCompletion: InlineCompletion | null = null;
    if (!q.includes(" ")) {
      for (const c of localRanked) {
        const host = hostOf(c.url);
        if (host.toLowerCase().startsWith(ql) && host.length > q.length) {
          inlineCompletion = { value: q + host.slice(q.length), url: `https://${host}` };
          break;
        }
      }
    }

    return { suggestions: out.slice(0, MAX_SUGGESTIONS), inlineCompletion };
  }, [query, enabled, history, bookmarks, searches, tabs, tabOrder, workspaces]);
}
