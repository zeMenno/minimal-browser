import { autoUpdater } from "electron-updater";

// ---------------------------------------------------------------------------
// Auto-update: thin wrapper around electron-updater that pulls new versions
// from this repo's GitHub Releases and tells the renderer how things are going,
// so the top bar can show a Discord-style "update ready" arrow. Releases are
// verified by the SHA512 in latest.yml, so this works without code signing.
// ---------------------------------------------------------------------------

type UpdateState = "available" | "downloading" | "ready" | "error";

export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  percent?: number;
}

type Sender = (channel: string, payload: UpdateStatus) => void;

// Re-check this often while the app stays open, so long-running sessions still
// pick up releases published after launch.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let wired = false;

function emit(send: Sender, status: UpdateStatus): void {
  send("update:status", status);
}

/** Quietly ask GitHub whether a newer release exists. Never throws. */
export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn("[updater] check failed:", err instanceof Error ? err.message : err);
  });
}

/** Restart into the downloaded update (the green-arrow click handler). */
export function quitAndInstall(): void {
  // isForceRunAfter=true so the app relaunches once the installer finishes.
  autoUpdater.quitAndInstall(false, true);
}

/**
 * Begin background update checks and forward progress to the renderer. Safe to
 * call once; subsequent calls are ignored. Caller guards on app.isPackaged.
 */
export function initUpdater(send: Sender): void {
  if (wired) return;
  wired = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    emit(send, { state: "available", version: info?.version });
  });
  autoUpdater.on("download-progress", (progress) => {
    emit(send, { state: "downloading", percent: Math.round(progress?.percent ?? 0) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    emit(send, { state: "ready", version: info?.version });
  });
  autoUpdater.on("error", (err) => {
    console.warn("[updater] error:", err instanceof Error ? err.message : err);
    emit(send, { state: "error" });
  });

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
