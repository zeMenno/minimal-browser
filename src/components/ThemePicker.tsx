import { useEffect, useState } from "react";
import { useBrowserStore } from "../store";
import { THEME_PRESETS, fullGradient, type Theme } from "../theme";

/**
 * Arc-style theme picker: choose two colors (presets or custom) and the
 * window chrome becomes a gradient between them.
 */
export function ThemePicker() {
  const open = useBrowserStore((s) => s.themePickerOpen);
  const setOpen = useBrowserStore((s) => s.setThemePickerOpen);
  const theme = useBrowserStore((s) => s.theme);
  const setTheme = useBrowserStore((s) => s.setTheme);

  const [a, setA] = useState("#7aa2f7");
  const [b, setB] = useState("#bb9af7");
  const [slot, setSlot] = useState<"a" | "b">("a");

  useEffect(() => {
    if (open) {
      setA(theme?.a ?? "#7aa2f7");
      setB(theme?.b ?? "#bb9af7");
      setSlot("a");
    }
  }, [open, theme]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const draft: Theme = { a, b };
  const pick = (color: string) => {
    if (slot === "a") {
      setA(color);
      setSlot("b");
    } else {
      setB(color);
      setSlot("a");
    }
  };

  const slotBtn = (which: "a" | "b", color: string) => (
    <button
      onClick={() => setSlot(which)}
      className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 ${
        slot === which
          ? "border-[var(--mb-accent)] bg-[var(--mb-selected)]"
          : "border-[var(--mb-pane-border)] hover:bg-[var(--mb-hover)]"
      }`}
    >
      <span
        className="h-5 w-5 shrink-0 rounded-full border border-white/20"
        style={{ background: color }}
      />
      <span className="text-left">
        <span className="block text-[11px] uppercase tracking-wider text-[#566174]">
          Color {which.toUpperCase()}
        </span>
        <span className="block text-[12px] text-[#aeb9cb]">{color}</span>
      </span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-[440px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--mb-pane-border)] bg-[var(--mb-modal)] shadow-2xl shadow-black/60">
        <div className="h-20" style={{ background: fullGradient(draft) }} />
        <div className="flex flex-col gap-4 p-4">
          <div className="text-[13px] text-[#8b96a8]">
            Pick two colors — the window chrome blends them into a gradient.
          </div>

          <div className="flex gap-2">
            {slotBtn("a", a)}
            {slotBtn("b", b)}
          </div>

          <div className="grid grid-cols-6 gap-2">
            {THEME_PRESETS.map((color) => (
              <button
                key={color}
                title={color}
                onClick={() => pick(color)}
                className={`h-9 rounded-md border transition-transform hover:scale-110 ${
                  color === (slot === "a" ? a : b) ? "border-white/70" : "border-white/10"
                }`}
                style={{ background: color }}
              />
            ))}
          </div>

          <label className="flex items-center gap-2 text-[12px] text-[#8b96a8]">
            Custom color for slot {slot.toUpperCase()}:
            <input
              type="color"
              value={slot === "a" ? a : b}
              onChange={(e) => (slot === "a" ? setA(e.target.value) : setB(e.target.value))}
              className="h-7 w-10 cursor-pointer rounded border border-[var(--mb-pane-border)] bg-transparent"
            />
          </label>

          <div className="flex justify-between gap-2 pt-1">
            <button
              onClick={() => {
                setTheme(null);
                setOpen(false);
              }}
              className="rounded-md px-3 py-1.5 text-[13px] text-[#8b96a8] hover:bg-[var(--mb-hover)]"
            >
              Reset to default
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-1.5 text-[13px] text-[#8b96a8] hover:bg-[var(--mb-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setTheme(draft);
                  setOpen(false);
                }}
                className="rounded-md px-4 py-1.5 text-[13px] font-medium text-[#0b0e14]"
                style={{ background: fullGradient(draft) }}
              >
                Apply theme
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
