import path from "node:path";
import fs from "node:fs";

export interface WorkspaceRow {
  id: string;
  name: string;
  position: number;
  layout: string | null;
}

export interface TabRow {
  id: string;
  workspace_id: string;
  title: string;
  url: string;
  icon: string | null;
  position: number;
}

export interface HistoryRow {
  url: string;
  title: string;
  visited_at: number;
}

export interface BookmarkRow {
  id: number;
  title: string;
  url: string;
  folder: string | null;
}

export interface Snapshot {
  workspaces: WorkspaceRow[];
  tabs: TabRow[];
  settings: Record<string, string>;
}

export interface BrowserStore {
  load(): Snapshot;
  save(snapshot: Snapshot): void;
  addHistory(url: string, title: string): void;
  touchHistoryTitle(url: string, title: string): void;
  searchHistory(query: string): HistoryRow[];
  listBookmarks(): BookmarkRow[];
  addBookmark(b: { title: string; url: string; folder?: string }): void;
  removeBookmark(id: number): void;
}

class SqliteStore implements BrowserStore {
  private db: import("better-sqlite3").Database;

  constructor(dir: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require("better-sqlite3");
    this.db = new Database(path.join(dir, "browser.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        layout TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        icon TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        visited_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        folder TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  load(): Snapshot {
    const workspaces = this.db
      .prepare("SELECT id, name, position, layout FROM workspaces ORDER BY position")
      .all() as WorkspaceRow[];
    const tabs = this.db
      .prepare("SELECT id, workspace_id, title, url, icon, position FROM tabs ORDER BY position")
      .all() as TabRow[];
    const settings: Record<string, string> = {};
    for (const row of this.db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[]) {
      settings[row.key] = row.value;
    }
    return { workspaces, tabs, settings };
  }

  save(snapshot: Snapshot): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM workspaces").run();
      this.db.prepare("DELETE FROM tabs").run();
      const insWs = this.db.prepare(
        "INSERT INTO workspaces (id, name, position, layout) VALUES (?, ?, ?, ?)"
      );
      for (const w of snapshot.workspaces) insWs.run(w.id, w.name, w.position, w.layout);
      const insTab = this.db.prepare(
        "INSERT INTO tabs (id, workspace_id, title, url, icon, position) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const t of snapshot.tabs)
        insTab.run(t.id, t.workspace_id, t.title, t.url, t.icon, t.position);
      const insSetting = this.db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      );
      for (const [k, v] of Object.entries(snapshot.settings)) insSetting.run(k, v);
    });
    tx();
  }

  addHistory(url: string, title: string): void {
    // Skip if this exact URL was just recorded (e.g. reload spam)
    const last = this.db
      .prepare("SELECT url, visited_at FROM history ORDER BY id DESC LIMIT 1")
      .get() as { url: string; visited_at: number } | undefined;
    const now = Math.floor(Date.now() / 1000);
    if (last && last.url === url && now - last.visited_at < 5) return;
    this.db
      .prepare("INSERT INTO history (url, title, visited_at) VALUES (?, ?, ?)")
      .run(url, title ?? "", now);
  }

  touchHistoryTitle(url: string, title: string): void {
    this.db
      .prepare(
        "UPDATE history SET title = ? WHERE id = (SELECT id FROM history WHERE url = ? ORDER BY id DESC LIMIT 1)"
      )
      .run(title, url);
  }

  searchHistory(query: string): HistoryRow[] {
    const like = `%${query}%`;
    return this.db
      .prepare(
        `SELECT url, MAX(title) as title, MAX(visited_at) as visited_at
         FROM history
         WHERE url LIKE ? OR title LIKE ?
         GROUP BY url
         ORDER BY visited_at DESC
         LIMIT 25`
      )
      .all(like, like) as HistoryRow[];
  }

  listBookmarks(): BookmarkRow[] {
    return this.db
      .prepare("SELECT id, title, url, folder FROM bookmarks ORDER BY id DESC")
      .all() as BookmarkRow[];
  }

  addBookmark(b: { title: string; url: string; folder?: string }): void {
    const exists = this.db
      .prepare("SELECT id FROM bookmarks WHERE url = ?")
      .get(b.url);
    if (exists) return;
    this.db
      .prepare("INSERT INTO bookmarks (title, url, folder) VALUES (?, ?, ?)")
      .run(b.title, b.url, b.folder ?? null);
  }

  removeBookmark(id: number): void {
    this.db.prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
  }
}

/**
 * JSON-file fallback used when the better-sqlite3 native module cannot be
 * loaded (e.g. ABI mismatch before `npm run rebuild` has been run). Same
 * interface, same data shape, so the app always boots.
 */
class JsonStore implements BrowserStore {
  private file: string;
  private data: {
    workspaces: WorkspaceRow[];
    tabs: TabRow[];
    history: HistoryRow[];
    bookmarks: BookmarkRow[];
    settings: Record<string, string>;
    nextBookmarkId: number;
  };
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    this.file = path.join(dir, "browser-data.json");
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.data = {
        workspaces: [],
        tabs: [],
        history: [],
        bookmarks: [],
        settings: {},
        nextBookmarkId: 1,
      };
    }
  }

  private flush(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.data));
      } catch (err) {
        console.error("[db] failed to write json store:", err);
      }
    }, 250);
  }

  load(): Snapshot {
    return {
      workspaces: this.data.workspaces,
      tabs: this.data.tabs,
      settings: this.data.settings,
    };
  }

  save(snapshot: Snapshot): void {
    this.data.workspaces = snapshot.workspaces;
    this.data.tabs = snapshot.tabs;
    this.data.settings = { ...this.data.settings, ...snapshot.settings };
    this.flush();
  }

  addHistory(url: string, title: string): void {
    const now = Math.floor(Date.now() / 1000);
    const last = this.data.history[this.data.history.length - 1];
    if (last && last.url === url && now - last.visited_at < 5) return;
    this.data.history.push({ url, title: title ?? "", visited_at: now });
    if (this.data.history.length > 5000) this.data.history.splice(0, 1000);
    this.flush();
  }

  touchHistoryTitle(url: string, title: string): void {
    for (let i = this.data.history.length - 1; i >= 0; i--) {
      if (this.data.history[i].url === url) {
        this.data.history[i].title = title;
        break;
      }
    }
    this.flush();
  }

  searchHistory(query: string): HistoryRow[] {
    const q = query.toLowerCase();
    const seen = new Map<string, HistoryRow>();
    for (let i = this.data.history.length - 1; i >= 0; i--) {
      const h = this.data.history[i];
      if (!h.url.toLowerCase().includes(q) && !h.title.toLowerCase().includes(q)) continue;
      if (!seen.has(h.url)) seen.set(h.url, h);
      if (seen.size >= 25) break;
    }
    return [...seen.values()];
  }

  listBookmarks(): BookmarkRow[] {
    return [...this.data.bookmarks].reverse();
  }

  addBookmark(b: { title: string; url: string; folder?: string }): void {
    if (this.data.bookmarks.some((x) => x.url === b.url)) return;
    this.data.bookmarks.push({
      id: this.data.nextBookmarkId++,
      title: b.title,
      url: b.url,
      folder: b.folder ?? null,
    });
    this.flush();
  }

  removeBookmark(id: number): void {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
    this.flush();
  }
}

export function createStore(dir: string): BrowserStore {
  try {
    const store = new SqliteStore(dir);
    console.log("[db] using sqlite store");
    return store;
  } catch (err) {
    console.warn("[db] better-sqlite3 unavailable, falling back to JSON store:", err);
    return new JsonStore(dir);
  }
}
