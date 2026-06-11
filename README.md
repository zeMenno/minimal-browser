# MinimalBrowser

A minimalist, keyboard-first browser for developers. Tabs are data in a sidebar, workspaces act
like projects, splits behave like an IDE, and everything is reachable through a `Ctrl+K` command
palette.

## Stack

- **Electron** (Chromium engine, one native `WebContentsView` per tab)
- **React + TypeScript** renderer, bundled with **Vite**
- **TailwindCSS v4** styling
- **Zustand** state management
- **dnd-kit** drag & drop
- **SQLite** (better-sqlite3) persistence, with an automatic JSON-file fallback if the native
  module isn't built for the local Electron ABI

## Run it

```sh
npm install
npm run rebuild   # builds better-sqlite3 against Electron's ABI (downloads a prebuilt binary)
npm start         # production build + launch
```

Development mode (Vite dev server + HMR for the UI):

```sh
npm run dev
```

Other scripts: `npm run typecheck`, `npm run build`, `npm run smoke` (boots the app, logs renderer
console output, auto-quits).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Command palette |
| `Ctrl+P` | Quick tab switcher |
| `Ctrl+L` | Focus address bar |
| `Ctrl+T` / `Ctrl+W` | New / close tab |
| `Ctrl+Shift+T` | Reopen closed tab |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+D` | Bookmark current page |
| `Ctrl+R` | Reload |
| `Ctrl+1…9` | Switch workspace |
| `Alt+←/→/↑/↓` | Split current pane left/right/up/down |
| `F12` | DevTools for the current page |

Shortcuts work even while a webpage has focus (intercepted via `before-input-event` in the main
process).

## Features

- **Sidebar instead of tab strip** — tabs are a list, grouped per workspace, drag to reorder,
  collapsible with `Ctrl+B`.
- **Workspaces** — create/rename/delete via palette, switch with `Ctrl+1…9`, each workspace
  remembers its tabs, split layout and active pane across restarts.
- **Split views** — unlimited nesting (binary splits compose into grids), draggable dividers,
  drag a sidebar tab onto a pane's edge to split or onto its center to swap. Layouts persist.
- **Command palette** — fuzzy search over commands, open tabs, bookmarks and history; type
  anything else and "Open …" navigates or searches. Prompt mode handles inputs (e.g. naming a
  new workspace).
- **Command system** — every action is a `Command { id, title, execute }` in
  [src/commands.ts](src/commands.ts); shortcuts and the palette call the same store actions.
- **History & bookmarks** — recorded in SQLite by the main process, searchable from the palette.

## Architecture

```
electron/main.ts     window, WebContentsView per tab, bounds/visibility, history
                     recording, shortcut interception, IPC
electron/preload.ts  channel-whitelisted contextBridge API
electron/db.ts       SQLite store (workspaces/tabs/history/bookmarks/settings) + JSON fallback
src/store.ts         Zustand store: workspaces, tabs, split-layout trees, active pane
src/layout.ts        immutable layout-tree operations (split/remove/sanitize)
src/App.tsx          IPC event routing, view↔layout sync, shortcuts, persistence, dnd
src/components/      TopBar (address bar), Sidebar, SplitView (recursive panes), CommandPalette
```

The renderer DOM renders *below* native `WebContentsView`s, so each pane reports its rectangle
(ResizeObserver → IPC) and main positions the matching view over it. While modal UI is showing
(palette, drag, divider resize) all views are temporarily hidden and panes show a placeholder.

Data lives in `%APPDATA%/minimal-browser/browser.db`.

## Out of scope (per the V1 plan)

AI assistants, sync, cloud accounts, collaboration, extensions, mobile, themes, notes, easels,
team workspaces.
