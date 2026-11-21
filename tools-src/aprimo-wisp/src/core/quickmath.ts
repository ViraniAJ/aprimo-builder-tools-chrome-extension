// Wisp's QuickMath and TimeAnswer: tips, days until a date, unit conversions, arithmetic, the time and the date.
import { norm } from "./intents";

const LEADS = ["hey wisp ", "wisp ", "please ", "can you tell me ", "tell me ", "quick question "];
const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNumWord = (w: string) => w in ONES || w in TENS || w === "hundred" || w === "thousand" || (w.includes("-") && w.split("-").every((p) => p in ONES || p in TENS));

/** "twenty five point five" → "25.5"; "one hundred and two" → "102". */
export function wordsToDigits(text: string): string {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumWord(words[i])) { out.push(words[i]); i++; continue; }
    let total = 0, cur = 0;
    while (i < words.length && (isNumWord(words[i]) || (words[i] === "and" && i + 1 < words.length && isNumWord(words[i + 1]) && cur + total > 0))) {
      const w = words[i];
      if (w === "and") { i++; continue; }
      if (w === "hundred") cur = (cur || 1) * 100;
      else if (w === "thousand") { total += (cur || 1) * 1000; cur = 0; }
      else if (w.includes("-")) cur += w.split("-").reduce((s, p) => s + (ONES[p] ?? TENS[p] ?? 0), 0);
      else cur += ONES[w] ?? TENS[w] ?? 0;
      i++;
    }
    let n = String(total + cur);
    if (words[i] === "point" && words[i + 1] in ONES && ONES[words[i + 1]] < 10) { n += "." + ONES[words[i + 1]]; i += 2; }
    out.push(n);
  }
  return out.join(" ");
}

export function fmtNum(v: number): string {
  if (Math.abs(v - Math.round(v)) < 1e-9 && Math.abs(v) < 1e15) return Math.round(v).toLocaleString("en-US");
  return Number(v.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function clean(q: string): string {
  let t = norm(q).replace(/[?!]+$/, "").replace(/\.$/, "").trim();
  for (const l of LEADS) if (t.startsWith(l)) t = t.slice(l.length);
  return wordsToDigits(t);
}

// ── Tip ──
function tip(t: string): string | null {
  const m = t.match(/^(?:what(?:'s| is) )?(?:an? )?(?:(\d+(?:\.\d+)?) ?(?:%|percent) )?tip (?:on|for) \$?(\d+(?:\.\d+)?)(?: dollars| bucks)?$/);
  if (!m) return null;
  const pct = m[1] ?? "18";
  const bill = Number(m[2]);
  const amount = (bill * Number(pct)) / 100;
  const article = /^8/.test(pct) || pct === "11" || pct === "18" || /^(11|18)\./.test(pct) ? "An" : "A";
  return `${article} ${pct}% tip on $${fmtNum(bill)} is $${amount.toFixed(2)}, for a total of $${(bill + amount).toFixed(2)}.`;
}

// ── Days until ──
const HOLIDAYS: [string[], number, number][] = [
  [["christmas", "christmas day"], 12, 25],
  [["new year's", "new years", "new year's day", "new year"], 1, 1],
  [["halloween"], 10, 31],
  [["valentine's day", "valentines day"], 2, 14],
  [["independence day", "the fourth of july", "july 4th"], 7, 4],
];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function monthIndex(w: string): number { return MONTHS.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3) && w.length >= 3 && m.startsWith(w)); }

function daysUntil(t: string, now = new Date()): string | null {
  const m = t.match(/^how many days (?:until|till|to|before) (.+)$/);
  if (!m) return null;
  const what = m[1].replace(/(\d+)(st|nd|rd|th)/g, "$1").replace(/,/g, "").trim();
  let month = -1, day = -1, year: number | undefined;
  const h = HOLIDAYS.find(([names]) => names.includes(what));
  if (h) { month = h[1] - 1; day = h[2]; }
  else {
    const a = what.match(/^([a-z]+) (\d{1,2})(?: (\d{4}))?$/);
    const b = what.match(/^(\d{1,2}) ([a-z]+)$/);
    if (a && monthIndex(a[1]) >= 0) { month = monthIndex(a[1]); day = Number(a[2]); year = a[3] ? Number(a[3]) : undefined; }
    else if (b && monthIndex(b[2]) >= 0) { month = monthIndex(b[2]); day = Number(b[1]); }
    else return null;
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let target = new Date(year ?? now.getFullYear(), month, day);
  if (!year && target < today) target = new Date(now.getFullYear() + 1, month, day);
  const n = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (n === 0) return "That's today!";
  if (n < 0) return null;
  const label = target.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return `${n} day${n === 1 ? "" : "s"}, until ${label}.`;
}

// ── Conversions ──
type Dim = "length" | "mass" | "temp" | "volume" | "speed";
interface Unit { name: string; dim: Dim; toBase: (v: number) => number; fromBase: (v: number) => number }
const lin = (name: string, dim: Dim, f: number): Unit => ({ name, dim, toBase: (v) => v * f, fromBase: (v) => v / f });
const UNITS: [string[], Unit][] = [
  [["km", "kilometer", "kilometers", "kilometre", "kilometres"], lin("kilometers", "length", 1000)],
  [["m", "meter", "meters", "metre", "metres"], lin("meters", "length", 1)],
  [["cm", "centimeter", "centimeters", "centimetre", "centimetres"], lin("centimeters", "length", 0.01)],
  [["mm", "millimeter", "millimeters"], lin("millimeters", "length", 0.001)],
  [["mile", "miles", "mi"], lin("miles", "length", 1609.344)],
  [["foot", "feet", "ft"], lin("feet", "length", 0.3048)],
  [["inch", "inches", "in"], lin("inches", "length", 0.0254)],
  [["yard", "yards", "yd"], lin("yards", "length", 0.9144)],
  [["kg", "kilo", "kilos", "kilogram", "kilograms"], lin("kilograms", "mass", 1000)],
  [["g", "gram", "grams"], lin("grams", "mass", 1)],
  [["pound", "pounds", "lb", "lbs"], lin("pounds", "mass", 453.59237)],
  [["ounce", "ounces", "oz"], lin("ounces", "mass", 28.349523125)],
  [["stone", "stones"], lin("stone", "mass", 6350.29318)],
  [["celsius", "c", "centigrade"], { name: "degrees Celsius", dim: "temp", toBase: (v) => v, fromBase: (v) => v }],
  [["fahrenheit", "f"], { name: "degrees Fahrenheit", dim: "temp", toBase: (v) => ((v - 32) * 5) / 9, fromBase: (v) => (v * 9) / 5 + 32 }],
  [["liter", "liters", "litre", "litres", "l"], lin("liters", "volume", 1000)],
  [["milliliter", "milliliters", "ml"], lin("milliliters", "volume", 1)],
  [["cup", "cups"], lin("cups", "volume", 236.5882365)],
  [["gallon", "gallons", "gal"], lin("gallons", "volume", 3785.411784)],
  [["fluid ounce", "fluid ounces", "fl oz"], lin("fluid ounces", "volume", 29.5735295625)],
  [["tablespoon", "tablespoons", "tbsp"], lin("tablespoons", "volume", 14.78676478125)],
  [["teaspoon", "teaspoons", "tsp"], lin("teaspoons", "volume", 4.92892159375)],
  [["mph", "miles per hour"], lin("miles per hour", "speed", 0.44704)],
  [["km/h", "kph", "kilometers per hour", "kilometres per hour"], lin("kilometers per hour", "speed", 1 / 3.6)],
];
function unit(raw: string): Unit | null {
  const u = raw.trim().replace(/^degrees /, "");
  return UNITS.find(([names]) => names.includes(u))?.[1] ?? null;
}
function singular(name: string): string {
  if (name === "feet") return "foot";
  if (name === "inches") return "inch";
  if (name === "stone") return "stone";
  if (name === "miles per hour") return "mile per hour";
  if (name === "kilometers per hour") return "kilometer per hour";
  if (name.startsWith("degrees ")) return name.replace(/^degrees/, "degree");
  return name.replace(/s$/, "");
}
const numOf = (s: string) => (s === "a" || s === "an" || s === "one" ? 1 : Number(s));
function convert(t: string): string | null {
  const NUM = "(\\d+(?:\\.\\d+)?|a|an|one)", U = "([a-z/ ]+?)";
  let m = t.match(new RegExp(`^(?:convert |what's |what is |how much is )?${NUM} ${U} (?:to|in|into) ${U}$`));
  let amount: number, from: Unit | null, to: Unit | null;
  if (m) { amount = numOf(m[1]); from = unit(m[2]); to = unit(m[3]); }
  else {
    m = t.match(new RegExp(`^how many ${U} (?:are )?(?:in|is) ${NUM} ${U}$`));
    if (!m) return null;
    amount = numOf(m[2]); from = unit(m[3]); to = unit(m[1]);
  }
  if (!from || !to || from.dim !== to.dim || from === to) return null;
  const result = to.fromBase(from.toBase(amount));
  const r = Number(result.toPrecision(6));
  return `${fmtNum(amount)} ${amount === 1 ? singular(from.name) : from.name} is ${fmtNum(r)} ${Math.abs(r - 1) < 1e-9 ? singular(to.name) : to.name}.`;
}

// ── Arithmetic ──
const A_LEADS = ["what's ", "what is ", "whats ", "calculate ", "compute ", "how much is "];
const REPL: [RegExp, string][] = [
  [/multiplied by/g, "*"], [/divided by/g, "/"], [/to the power of/g, "^"], [/\btimes\b/g, "*"], [/\bplus\b/g, "+"], [/\bminus\b/g, "-"],
  [/\bover\b/g, "/"], [/(?<=\d\s*)x(?=\s*\d)/g, "*"], [/×/g, "*"], [/÷/g, "/"], [/\bsquared\b/g, "^2"], [/\bcubed\b/g, "^3"], [/\band\b/g, "+"],
];
class Calc {
  private i = 0;
  private s: string;
  constructor(s: string) { this.s = s; }
  parse(): number { const v = this.expr(); if (this.i < this.s.length) throw new Error("trailing"); return v; }
  private peek() { while (this.s[this.i] === " ") this.i++; return this.s[this.i]; }
  private expr(): number {
    let v = this.term();
    for (let c = this.peek(); c === "+" || c === "-"; c = this.peek()) { this.i++; v = c === "+" ? v + this.term() : v - this.term(); }
    return v;
  }
  private term(): number {
    let v = this.power();
    for (let c = this.peek(); c === "*" || c === "/"; c = this.peek()) {
      this.i++;
      const r = this.power();
      if (c === "/" && r === 0) throw new Error("div0");
      v = c === "*" ? v * r : v / r;
    }
    return v;
  }
  private power(): number {
    const b = this.unary();
    if (this.peek() === "^") { this.i++; const e = this.power(); if (Math.abs(e) > 64) throw new Error("exp"); return Math.pow(b, e); }
    return b;
  }
  private unary(): number {
    const c = this.peek();
    if (c === "-") { this.i++; return -this.unary(); }
    if (c === "√") { this.i++; const v = this.unary(); if (v < 0) throw new Error("sqrt"); return Math.sqrt(v); }
    if (c === "(") { this.i++; const v = this.expr(); if (this.peek() !== ")") throw new Error("paren"); this.i++; return v; }
    const m = this.s.slice(this.i).match(/^\d+(?:\.\d+)?|^\.\d+/);
    if (!m) throw new Error("num");
    this.i += m[0].length;
    return Number(m[0]);
  }
}
function sayExpr(e: string): string {
  return e.replace(/\*/g, " times ").replace(/\//g, " divided by ").replace(/\^/g, " to the power of ").replace(/√/g, "the square root of ").replace(/\+/g, " plus ").replace(/ -/g, " minus ").replace(/\s+/g, " ").trim();
}
function arithmetic(t: string): string | null {
  let e = t;
  for (const l of A_LEADS) if (e.startsWith(l)) e = e.slice(l.length);
  const pct = e.match(/^(\d+(\.\d+)?) ?(%|percent) of (\d+(\.\d+)?)$/);
  if (pct) return `${pct[1]}% of ${pct[4]} is ${fmtNum((Number(pct[1]) * Number(pct[4])) / 100)}.`;
  for (const [r, s] of REPL) e = e.replace(r, s);
  e = e.replace(/,/g, "").replace(/(the )?square root of/g, "√").trim();
  if (!/[+\-*/^√]/.test(e) || !/^[0-9.+\-*/^()√ ]+$/.test(e) || !/\d/.test(e)) return null;
  try {
    const v = new Calc(e.replace(/\s+/g, " ")).parse();
    if (!Number.isFinite(v)) return null;
    return `${sayExpr(e)} is ${fmtNum(v)}.`;
  } catch { return null; }
}

export function quickMath(q: string, now = new Date()): string | null {
  const t = clean(q);
  return tip(t) ?? daysUntil(t, now) ?? convert(t) ?? arithmetic(t);
}

// ── Time and date ──
const ZONES: [string, string[]][] = [
  ["America/New_York", ["new york", "nyc", "boston", "miami", "washington", "atlanta"]], ["America/Toronto", ["toronto"]],
  ["America/Chicago", ["chicago", "dallas", "austin", "houston"]], ["America/Denver", ["denver"]], ["America/Phoenix", ["phoenix"]],
  ["America/Los_Angeles", ["los angeles", "la", "san francisco", "seattle"]], ["America/Vancouver", ["vancouver"]],
  ["Pacific/Honolulu", ["honolulu", "hawaii"]], ["America/Mexico_City", ["mexico city"]], ["America/Sao_Paulo", ["sao paulo", "são paulo"]],
  ["America/Argentina/Buenos_Aires", ["buenos aires"]], ["Europe/London", ["london", "uk", "england"]], ["Europe/Dublin", ["dublin"]],
  ["Europe/Paris", ["paris", "france"]], ["Europe/Berlin", ["berlin", "germany"]], ["Europe/Madrid", ["madrid", "spain"]],
  ["Europe/Rome", ["rome", "italy"]], ["Europe/Amsterdam", ["amsterdam"]], ["Europe/Moscow", ["moscow"]], ["Europe/Istanbul", ["istanbul"]],
  ["Africa/Cairo", ["cairo"]], ["Africa/Lagos", ["lagos"]], ["Africa/Nairobi", ["nairobi"]], ["Africa/Johannesburg", ["johannesburg"]],
  ["Asia/Dubai", ["dubai"]], ["Asia/Karachi", ["karachi", "pakistan"]], ["Asia/Kolkata", ["india", "mumbai", "delhi", "new delhi", "bangalore"]],
  ["Asia/Bangkok", ["bangkok"]], ["Asia/Singapore", ["singapore"]], ["Asia/Jakarta", ["jakarta"]], ["Asia/Manila", ["manila"]],
  ["Asia/Hong_Kong", ["hong kong"]], ["Asia/Shanghai", ["beijing", "shanghai", "china"]], ["Asia/Seoul", ["seoul", "korea"]],
  ["Asia/Tokyo", ["tokyo", "japan"]], ["Australia/Sydney", ["sydney"]], ["Australia/Melbourne", ["melbourne"]], ["Australia/Perth", ["perth"]],
  ["Pacific/Auckland", ["auckland", "new zealand"]],
];
function zoneFor(place: string): string | null {
  const hit = ZONES.find(([, names]) => names.includes(place));
  if (hit) return hit[0];
  const suffix = "/" + place.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_");
  try {
    const all = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
    return all?.find((z) => z.endsWith(suffix)) ?? null;
  } catch { return null; }
}
const title = (s: string) => s.split(" ").map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");

export function timeAnswer(q: string, now = new Date()): string | null {
  const t = norm(q).replace(/[?.!]+$/, "").trim();
  const m = t.match(/^(?:hey wisp,? |wisp,? )?(?:what time is it|what's the time|what is the time|what's the time now|what time is it now|time check)(?: right now| now)?(?: in ([a-zãõ ]+))?$/);
  if (m) {
    const place = m[1] ? t.slice(t.lastIndexOf(" in ") + 4).trim() : "";
    const zone = place ? zoneFor(place) : undefined;
    if (place && !zone) return null;
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone ?? undefined });
    const dayThere = now.toLocaleDateString("en-US", { weekday: "long", timeZone: zone ?? undefined });
    const dayHere = now.toLocaleDateString("en-US", { weekday: "long" });
    return `It's ${time}${place ? ` in ${title(place)}` : ""}${dayThere !== dayHere ? `, ${dayThere}` : ""}.`;
  }
  if (/^(?:what's|what is) (?:the |today's )?date(?: today)?$|^what day is it(?: today)?$|^what's today$|^what is today$/.test(t)) {
    return `It's ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`;
  }
  return null;
}
