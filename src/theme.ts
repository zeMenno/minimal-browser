export interface Theme {
  a: string;
  b: string;
}

/** Arc-style palette the picker offers for each gradient stop. */
export const THEME_PRESETS = [
  "#7aa2f7",
  "#bb9af7",
  "#ff007c",
  "#f7768e",
  "#ff9e64",
  "#e0af68",
  "#9ece6a",
  "#73daca",
  "#2ac3de",
  "#7dcfff",
  "#c0caf5",
  "#3d59a1",
];

/** Linear blend of two hex colors; t is the weight of `a`. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return b;
  const ch = (i: number) => Math.round(pa[i] * t + pb[i] * (1 - t));
  return `#${[ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The window-chrome gradient: theme colors toned down onto the dark base. */
export function chromeGradient(theme: Theme): string {
  const a = mixHex(theme.a, "#0b0e14", 0.3);
  const b = mixHex(theme.b, "#0b0e14", 0.3);
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

/** Full-strength gradient for previews and the intro. */
export function fullGradient(theme: Theme): string {
  return `linear-gradient(135deg, ${theme.a} 0%, ${theme.b} 100%)`;
}
