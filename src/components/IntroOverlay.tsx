import { useEffect, useState } from "react";
import { useBrowserStore } from "../store";

const WORD_A = "Minimal";
const WORD_B = "Browser";
const TAGLINE = "keyboard-first browsing";

/**
 * Full-window startup animation: drifting gradient nebulas, a staggered
 * wordmark reveal and a line sweep, then it dissolves into the app. Native
 * views stay hidden (overlay sync) until it finishes. Click or press any
 * key to skip.
 */
export function IntroOverlay() {
  const playing = useBrowserStore((s) => s.introPlaying);
  const theme = useBrowserStore((s) => s.theme);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const finish = useBrowserStore.getState().finishIntro;
    let done = false;
    const leave = (delay: number) => {
      if (done) return;
      done = true;
      setLeaving(true);
      window.setTimeout(finish, delay);
    };
    const leaveTimer = window.setTimeout(() => leave(700), 2100);
    const skip = () => leave(350);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.clearTimeout(leaveTimer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [playing]);

  if (!playing) return null;

  const colorA = theme?.a ?? "#7aa2f7";
  const colorB = theme?.b ?? "#bb9af7";
  let letterIndex = 0;
  const letter = (ch: string, extra: string) => (
    <span
      key={letterIndex}
      className={`inline-block ${extra}`}
      style={{
        animation: "intro-letter 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        animationDelay: `${0.25 + letterIndex++ * 0.045}s`,
      }}
    >
      {ch}
    </span>
  );

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#07090d] transition-all duration-700 ease-out ${
        leaving ? "pointer-events-none scale-110 opacity-0" : "opacity-100"
      }`}
    >
      {/* Drifting gradient nebulas */}
      <div
        className="absolute h-[120vmax] w-[120vmax] rounded-full opacity-30 blur-3xl"
        style={{
          background: `radial-gradient(circle at center, ${colorA} 0%, transparent 60%)`,
          animation: "intro-drift-a 6s ease-in-out infinite",
        }}
      />
      <div
        className="absolute h-[110vmax] w-[110vmax] rounded-full opacity-25 blur-3xl"
        style={{
          background: `radial-gradient(circle at center, ${colorB} 0%, transparent 60%)`,
          animation: "intro-drift-b 7s ease-in-out infinite",
        }}
      />

      <div className="relative flex flex-col items-center gap-5">
        <div className="select-none text-[clamp(40px,7vw,84px)] leading-none tracking-tight text-[#e6ecf5]">
          {WORD_A.split("").map((ch) => letter(ch, "font-extralight"))}
          {WORD_B.split("").map((ch) => letter(ch, "font-semibold"))}
        </div>

        <div
          className="h-px w-full origin-left"
          style={{
            background: `linear-gradient(90deg, transparent, ${colorA}, ${colorB}, transparent)`,
            animation: "intro-line 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.9s both",
          }}
        />

        <div
          className="select-none text-[13px] uppercase tracking-[0.5em] text-[#6b7689]"
          style={{ animation: "intro-letter 0.7s ease 1.25s both" }}
        >
          {TAGLINE}
        </div>
      </div>

      <div
        className="absolute bottom-8 select-none text-[11px] text-[#3c4555]"
        style={{ animation: "intro-letter 0.7s ease 1.6s both" }}
      >
        press any key to skip
      </div>
    </div>
  );
}
