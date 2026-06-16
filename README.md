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

## Releases & auto-update

Releases are automated through GitHub Actions. The app updates itself the way Discord does: new
versions download silently in the background, then a **green ↓ arrow** appears in the top bar —
click it to restart into the update.

**Cut a release** (builds the Windows installer and publishes it to GitHub Releases):

```sh
npm version patch        # bumps package.json + creates a git tag (use minor/major as needed)
git push --follow-tags   # pushing the vX.Y.Z tag triggers .github/workflows/release.yml
```

The workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) builds on a per-OS
matrix (Windows `.exe` and Linux `.AppImage`/`.deb` today; macOS is a commented-out matrix entry
ready to enable once an Apple signing cert is available). Each OS builds its own installer with
`electron-builder --publish never`, then a single `publish` job attaches them all — plus the
`latest*.yml` update manifests — to one GitHub Release for the tag. Splitting build from publish
avoids electron-builder's duplicate-release race. Installed copies read the manifest from GitHub
Releases (`build.publish` in [package.json](package.json)) to detect updates.

Builds are currently **unsigned** — Windows SmartScreen shows an "unknown publisher" prompt on the
first manual install, but auto-update still works because each release is verified by its SHA512.
Every push/PR also runs a typecheck + build via [.github/workflows/ci.yml](.github/workflows/ci.yml).

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
- **Find in page** — `Ctrl+F` opens a find bar with live match counts; `Enter`/`Shift+Enter` cycle.
- **Address-bar bangs** — `!gh zustand`, `!npm`, `!mdn`, `!so`, `!yt`, `!w`, `!g`, `!d` jump straight
  to site searches.
- **Pinned tabs** — pin a tab (hover button or palette) and it moves to a per-workspace Pinned
  list that survives restarts and can't be closed; `Ctrl+W` only removes it from the layout.
- **Tab suspension** — background tabs idle 15+ minutes release their Chromium view (shown with a
  ☾ icon) and reload on click; audio-playing tabs are never suspended.
- **Downloads** — tracked across all sessions, progress indicator in the top bar, searchable in
  the palette (Enter opens the file).
- **Workspace session isolation** — each workspace has its own cookies/logins via a persistent
  Chromium partition (`persist:ws-<id>`).
- **Gradient themes** — "Change Theme" in the palette: pick two colors (presets or custom) and
  the window chrome becomes an Arc-style gradient. Persisted.
- **Startup animation** — full-window intro using your theme colors; any key skips it.

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
