import { useState } from "react";
import type { Suggestion } from "../suggest";

interface Props {
  suggestions: Suggestion[];
  selected: number;
  query: string;
  onHover: (index: number) => void;
  onRun: (index: number) => void;
}

/** Dropdown shown under the address bar, styled after the Firefox awesomebar. */
export function AddressSuggestions({ suggestions, selected, query, onHover, onRun }: Props) {
  if (suggestions.length === 0) return null;
  return (
    <div
      className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-[var(--mb-pane-border)] bg-[var(--mb-modal)] py-1 shadow-2xl shadow-black/60"
      // Run before the input blur fires, so clicks register.
      onMouseDown={(e) => e.preventDefault()}
    >
      {suggestions.map((s, i) => (
        <Row
          key={s.id}
          suggestion={s}
          query={query}
          active={i === selected}
          big={s.kind === "topHit"}
          onMouseEnter={() => onHover(i)}
          onClick={() => onRun(i)}
        />
      ))}
    </div>
  );
}

function Row({
  suggestion,
  query,
  active,
  big,
  onMouseEnter,
  onClick,
}: {
  suggestion: Suggestion;
  query: string;
  active: boolean;
  big: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const showSubtitle = suggestion.subtitle && suggestion.subtitle !== suggestion.title;
  return (
    <button
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 text-left ${big ? "py-2" : "py-1.5"} ${
        active ? "bg-[var(--mb-selected)]" : ""
      }`}
    >
      <KindIcon suggestion={suggestion} big={big} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={`truncate ${big ? "text-[14px]" : "text-[13px]"} text-[#cdd6e4]`}
        >
          {highlight(suggestion.title, query)}
        </span>
        {showSubtitle && (
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#566174]">
            {suggestion.kind === "topHit" || suggestion.kind === "url" ? "— " : ""}
            {suggestion.subtitle}
          </span>
        )}
      </span>
      {suggestion.kind === "search" && (
        <span className="shrink-0 text-[11px] text-[#48536a]">Search</span>
      )}
      {suggestion.kind === "tab" && (
        <span className="shrink-0 text-[11px] text-[#9ece6a]">↹ tab</span>
      )}
    </button>
  );
}

function KindIcon({ suggestion, big }: { suggestion: Suggestion; big: boolean }) {
  const size = big ? "h-5 w-5" : "h-4 w-4";
  const box = `flex ${big ? "h-5 w-5" : "h-4 w-4"} shrink-0 items-center justify-center text-[#7d8799]`;

  if (suggestion.kind === "search" || suggestion.kind === "bang") {
    return (
      <span className={box}>
        <SearchGlyph />
      </span>
    );
  }
  if (suggestion.kind === "history") {
    return (
      <span className={box}>
        <ClockGlyph />
      </span>
    );
  }
  if (suggestion.kind === "bookmark") {
    return <span className={box}>★</span>;
  }
  if (suggestion.favicon) {
    return <Favicon src={suggestion.favicon} className={`${size} shrink-0 rounded-sm`} />;
  }
  return (
    <span className={box}>
      <GlobeGlyph />
    </span>
  );
}

/** Favicon with graceful fallback to a globe glyph when the image fails. */
function Favicon({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`${className} flex items-center justify-center text-[#7d8799]`}>
        <GlobeGlyph />
      </span>
    );
  }
  return <img src={src} alt="" className={className} onError={() => setFailed(true)} />;
}

/** Bold the first case-insensitive occurrence of the query within the text. */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-[#dbe2ea]">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 8h12M8 2c1.8 1.6 2.8 3.8 2.8 6S9.8 14.4 8 16M8 2C6.2 3.6 5.2 5.8 5.2 8s1 4.4 2.8 6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
