import { useEffect, useState } from "react";
import { useBrowserStore } from "../store";
import { api } from "../api";

/**
 * Modal shown when a page requests a sensitive permission (camera, mic,
 * location, …). Requests queue in the store; we show the oldest one. While it's
 * up the overlay sync hides the native views so this DOM modal is visible.
 */
export function PermissionPrompt() {
  const request = useBrowserStore((s) => s.permissionRequests[0]);
  const resolve = useBrowserStore((s) => s.resolvePermissionRequest);
  const [remember, setRemember] = useState(true);

  // Reset the remember toggle each time a new request comes to the front.
  useEffect(() => {
    setRemember(true);
  }, [request?.id]);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        api.respondPermission(request.id, false, false);
        resolve(request.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, resolve]);

  if (!request) return null;

  const respond = (granted: boolean) => {
    api.respondPermission(request.id, granted, remember);
    resolve(request.id);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 pt-[14vh]">
      <div className="w-[460px] max-w-[90vw] overflow-hidden rounded-xl border border-[var(--mb-pane-border)] bg-[var(--mb-modal)] shadow-2xl shadow-black/60">
        <div className="px-5 pt-5">
          <div className="text-[13px] text-[#cdd6e4]">
            <span className="font-semibold text-[var(--mb-accent)]">{request.origin}</span>{" "}
            wants to {request.label}.
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-[12px] text-[#8b96a8]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="accent-[var(--mb-accent)]"
            />
            Remember this decision for {request.origin}
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-[var(--mb-pane-border)] px-5 py-3">
          <button
            onClick={() => respond(false)}
            className="rounded-md px-3 py-1.5 text-[13px] text-[#aeb9cb] hover:bg-[var(--mb-surface)]"
          >
            Block
          </button>
          <button
            onClick={() => respond(true)}
            className="rounded-md bg-[var(--mb-selected)] px-3 py-1.5 text-[13px] font-medium text-[#dbe2ea] hover:bg-[var(--mb-hover)]"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
