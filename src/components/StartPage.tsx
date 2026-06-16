import { useEffect, useRef, useState } from "react";
import { useBrowserStore } from "../store";
import { api, normalizeUrl } from "../api";
import type { HistoryEntry, WeatherNow } from "../types";

/** Map a WMO weather code to a glyph + short label. */
function describeWeather(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "☀", label: "Clear" };
  if (code === 1) return { icon: "🌤", label: "Mainly clear" };
  if (code === 2) return { icon: "⛅", label: "Partly cloudy" };
  if (code === 3) return { icon: "☁", label: "Overcast" };
  if (code === 45 || code === 48) return { icon: "🌫", label: "Fog" };
  if (code >= 51 && code <= 57) return { icon: "🌦", label: "Drizzle" };
  if (code >= 61 && code <= 67) return { icon: "🌧", label: "Rain" };
  if (code >= 71 && code <= 77) return { icon: "🌨", label: "Snow" };
  if (code >= 80 && code <= 82) return { icon: "🌦", label: "Showers" };
  if (code === 85 || code === 86) return { icon: "🌨", label: "Snow showers" };
  if (code === 95) return { icon: "⛈", label: "Thunderstorm" };
  if (code === 96 || code === 99) return { icon: "⛈", label: "Thunderstorm, hail" };
  return { icon: "🌡", label: "—" };
}

function greeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const seconds = now.toLocaleTimeString([], { second: "2-digit" });
  const date = now.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-end gap-1 font-light tabular-nums leading-none text-[#e6edf6]">
        <span className="text-[88px]">{time}</span>
        <span className="mb-3 text-[24px] text-[#566174]">{seconds}</span>
      </div>
      <div className="mt-2 text-[15px] tracking-wide text-[#8b96a8]">
        {greeting(now.getHours())} · {date}
      </div>
    </div>
  );
}

function Weather() {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void api.fetchWeather().then((w) => {
        if (!alive) return;
        if (w) setWeather(w);
        else setFailed(true);
      });
    };
    load();
    const timer = setInterval(load, 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (failed && !weather) return null;
  if (!weather) {
    return <div className="h-[34px] w-[150px] animate-pulse rounded-full bg-[var(--mb-surface)]" />;
  }

  const { icon, label } = describeWeather(weather.code);
  return (
    <div className="flex items-center gap-2 rounded-full bg-[var(--mb-surface)] px-4 py-1.5 text-[13px] text-[#aeb9cb]">
      <span className="text-[18px] leading-none">{icon}</span>
      <span className="font-medium text-[#dbe2ea]">{Math.round(weather.temperature)}°C</span>
      <span className="text-[#566174]">{label}</span>
      <span className="text-[#48536a]">· {weather.location}</span>
    </div>
  );
}

function SearchBox() {
  const openUrl = useBrowserStore((s) => s.openUrl);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    openUrl(v);
  };

  return (
    <div className="flex h-[46px] w-full items-center gap-3 rounded-2xl border border-[var(--mb-pane-border)] bg-[var(--mb-surface)] px-5 shadow-lg shadow-black/20 focus-within:border-[var(--mb-pane-active)]">
      <span className="text-[#566174]">⌕</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Search the web or enter an address"
        className="w-full bg-transparent text-[15px] text-[#dbe2ea] placeholder-[#566174] outline-none"
        spellCheck={false}
        autoComplete="off"
      />
      {value.trim() && (
        <span className="shrink-0 truncate text-[11px] text-[#48536a]">
          {normalizeUrl(value).slice(0, 40)}
        </span>
      )}
    </div>
  );
}

function RecentTabs() {
  const openUrl = useBrowserStore((s) => s.openUrl);
  const [recent, setRecent] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    void api.searchHistory("").then((entries) => {
      const seen = new Set<string>();
      const unique: HistoryEntry[] = [];
      for (const e of entries) {
        const host = hostOf(e.url);
        if (seen.has(host)) continue;
        seen.add(host);
        unique.push(e);
        if (unique.length >= 8) break;
      }
      setRecent(unique);
    });
  }, []);

  if (recent.length === 0) return null;

  return (
    <div className="w-full">
      <div className="mb-3 text-center text-[10px] font-semibold uppercase tracking-widest text-[#48536a]">
        Recent
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {recent.map((entry) => {
          const host = hostOf(entry.url);
          return (
            <button
              key={entry.url}
              onClick={() => openUrl(entry.url)}
              title={entry.title || entry.url}
              className="group flex items-center gap-2.5 rounded-xl border border-transparent bg-[var(--mb-surface)] px-3 py-2.5 text-left hover:border-[var(--mb-pane-border)] hover:bg-[var(--mb-hover)]"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--mb-selected)] text-[13px] font-semibold uppercase text-[var(--mb-accent)]">
                {host.charAt(0) || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-[#cdd6e4]">
                  {entry.title || host}
                </span>
                <span className="block truncate text-[11px] text-[#566174]">{host}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StartPage() {
  // The native view for this tab is suppressed by the parent Pane, so this DOM
  // is what the user sees for a new (about:blank) tab.
  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-[var(--mb-pane)] px-6">
      <div className="flex w-full max-w-[640px] flex-1 flex-col items-center justify-center gap-7 py-12">
        <Weather />
        <Clock />
        <SearchBox />
        <RecentTabs />
      </div>
    </div>
  );
}
