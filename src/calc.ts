// Lightweight calculator + unit converter for the command palette and address
// bar. Pure, dependency-free, and deliberately conservative: it returns null
// for anything that isn't unambiguously a calculation so it never hijacks a
// plain search or URL.

const FUNCS: Record<string, (n: number) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log,
  log: (n) => Math.log10(n),
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

type Tok =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "id"; v: string }
  | { t: "paren"; v: "(" | ")" };

function tokenize(s: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.,_]/.test(s[j])) j++;
      const num = parseFloat(s.slice(i, j).replace(/[,_]/g, ""));
      if (isNaN(num)) return null;
      toks.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/%^".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      toks.push({ t: "paren", v: c });
      i++;
      continue;
    }
    return null; // unknown character → not a calculation
  }
  return toks;
}

/** Recursive-descent evaluator (no eval): + - * / % ^, unary ±, funcs, consts. */
class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  parse(): number {
    const v = this.expr();
    if (this.pos !== this.toks.length) throw new Error("trailing tokens");
    return v;
  }

  private eatOp(...ops: string[]): string | null {
    const t = this.toks[this.pos];
    if (t && t.t === "op" && ops.includes(t.v)) {
      this.pos++;
      return t.v;
    }
    return null;
  }

  private expr(): number {
    let v = this.term();
    let op: string | null;
    while ((op = this.eatOp("+", "-"))) {
      const r = this.term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.power();
    let op: string | null;
    while ((op = this.eatOp("*", "/", "%"))) {
      const r = this.power();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }

  private power(): number {
    const base = this.unary();
    if (this.eatOp("^")) return Math.pow(base, this.power()); // right-associative
    return base;
  }

  private unary(): number {
    const op = this.eatOp("+", "-");
    if (op) {
      const v = this.unary();
      return op === "-" ? -v : v;
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.toks[this.pos];
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") {
      this.pos++;
      return t.v;
    }
    if (t.t === "paren" && t.v === "(") {
      this.pos++;
      const v = this.expr();
      const close = this.toks[this.pos];
      if (!close || close.t !== "paren" || close.v !== ")") throw new Error("expected )");
      this.pos++;
      return v;
    }
    if (t.t === "id") {
      this.pos++;
      if (t.v in CONSTS) return CONSTS[t.v];
      const fn = FUNCS[t.v];
      if (fn) {
        const open = this.toks[this.pos];
        if (!open || open.t !== "paren" || open.v !== "(") throw new Error("expected (");
        this.pos++;
        const arg = this.expr();
        const close = this.toks[this.pos];
        if (!close || close.t !== "paren" || close.v !== ")") throw new Error("expected )");
        this.pos++;
        return fn(arg);
      }
      throw new Error(`unknown name ${t.v}`);
    }
    throw new Error("unexpected token");
  }
}

function formatNumber(n: number): string {
  const r = Math.round(n * 1e8) / 1e8;
  if (Number.isInteger(r)) return r.toLocaleString("en-US");
  return String(r);
}

interface Unit {
  dim: string;
  factor: number; // multiples of the dimension's base unit
}

const UNITS: Record<string, Unit> = {};
function reg(dim: string, factor: number, ...names: string[]): void {
  for (const n of names) UNITS[n] = { dim, factor };
}
// length (base: metre)
reg("len", 0.001, "mm", "millimeter", "millimeters");
reg("len", 0.01, "cm", "centimeter", "centimeters");
reg("len", 1, "m", "meter", "meters", "metre", "metres");
reg("len", 1000, "km", "kilometer", "kilometers");
reg("len", 0.0254, "in", "inch", "inches");
reg("len", 0.3048, "ft", "foot", "feet");
reg("len", 0.9144, "yd", "yard", "yards");
reg("len", 1609.344, "mi", "mile", "miles");
// mass (base: gram)
reg("mass", 0.001, "mg", "milligram", "milligrams");
reg("mass", 1, "g", "gram", "grams");
reg("mass", 1000, "kg", "kilogram", "kilograms");
reg("mass", 28.349523125, "oz", "ounce", "ounces");
reg("mass", 453.59237, "lb", "lbs", "pound", "pounds");
reg("mass", 1_000_000, "t", "tonne", "tonnes", "ton", "tons");
// data (base: byte)
reg("data", 1, "byte", "bytes");
reg("data", 1024, "kb", "kib", "kilobyte", "kilobytes");
reg("data", 1024 ** 2, "mb", "mib", "megabyte", "megabytes");
reg("data", 1024 ** 3, "gb", "gib", "gigabyte", "gigabytes");
reg("data", 1024 ** 4, "tb", "tib", "terabyte", "terabytes");
// time (base: second)
reg("time", 1, "s", "sec", "secs", "second", "seconds");
reg("time", 60, "min", "mins", "minute", "minutes");
reg("time", 3600, "h", "hr", "hrs", "hour", "hours");
reg("time", 86400, "day", "days");
reg("time", 604800, "week", "weeks");

const TEMP_ALIASES: Record<string, string> = {
  c: "c",
  celsius: "c",
  "°c": "c",
  f: "f",
  fahrenheit: "f",
  "°f": "f",
  k: "k",
  kelvin: "k",
};

function convertUnits(value: number, fromRaw: string, toRaw: string): number | null {
  const from = fromRaw.toLowerCase();
  const to = toRaw.toLowerCase();
  if (from in TEMP_ALIASES && to in TEMP_ALIASES) {
    const f = TEMP_ALIASES[from];
    const t = TEMP_ALIASES[to];
    const celsius = f === "c" ? value : f === "f" ? ((value - 32) * 5) / 9 : value - 273.15;
    return t === "c" ? celsius : t === "f" ? (celsius * 9) / 5 + 32 : celsius + 273.15;
  }
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return (value * a.factor) / b.factor;
}

/**
 * Returns a formatted result for arithmetic / unit-conversion input, or null if
 * the input isn't unambiguously a calculation.
 */
export function tryCalculate(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  // Unit conversion: "10 km to mi", "100 f in c", "2.5 GB to MB"
  const conv = text.match(/^(-?[\d.,]+)\s*(°?[a-zA-Z]+)\s+(?:to|in)\s+(°?[a-zA-Z]+)$/);
  if (conv) {
    const value = parseFloat(conv[1].replace(/,/g, ""));
    if (isNaN(value)) return null;
    const res = convertUnits(value, conv[2], conv[3]);
    return res === null ? null : `${formatNumber(res)} ${conv[3]}`;
  }

  // Arithmetic: require a digit, plus either an operator or a function/const
  // name, so plain numbers, IPs and words don't surface a result.
  if (!/\d/.test(text)) return null;
  if (!/[+\-*/%^()]/.test(text) && !/[a-z]/i.test(text)) return null;
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null; // looks like a URL

  const toks = tokenize(text);
  if (!toks || toks.length === 0) return null;
  try {
    const v = new Parser(toks).parse();
    if (typeof v !== "number" || !isFinite(v)) return null;
    return formatNumber(v);
  } catch {
    return null;
  }
}
