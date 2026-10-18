/** Date helpers. Business dates are calendar dates in Indian Standard Time (Asia/Kolkata). */

export const IST = "Asia/Kolkata";

/** Today's date (YYYY-MM-DD) in IST. */
export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The IST calendar date of an instant. */
export function istDate(instant: Date | string): string {
  return istToday(new Date(instant));
}

function parts(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Add calendar months, clamping to the last day of the month (31 Aug + 6 → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400_000);
}

/** The n-th monthly billing date from an anchor, without day drift (anchor 31 Jan → 28 Feb → 31 Mar). */
export function nthMonthly(anchor: string, n: number): string {
  return addMonths(anchor, n);
}
