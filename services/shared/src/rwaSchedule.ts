const NY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    NY_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

/** 24/5 market-open rule: full New York weekdays, independent of cash-session hours. */
export function isRwaMarketOpen(nowMs = Date.now()): boolean {
  const weekday = nyParts(new Date(nowMs)).weekday;
  return weekday !== "Sat" && weekday !== "Sun";
}

function nyCloseEpoch(year: number, month: number, day: number): number {
  const center = Date.UTC(year, month - 1, day, 20, 0, 0);
  for (let delta = -3 * 3_600_000; delta <= 3 * 3_600_000; delta += 3_600_000) {
    const candidate = new Date(center + delta);
    const p = nyParts(candidate);
    if (Number(p.year) === year && Number(p.month) === month && Number(p.day) === day && p.hour === "16") {
      return Math.floor(candidate.getTime() / 1000);
    }
  }
  throw new Error(`unable to resolve America/New_York close for ${year}-${month}-${day}`);
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function observedFixedHoliday(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const end = new Date(Date.UTC(year, month, 0));
  return end.getUTCDate() - ((end.getUTCDay() - weekday + 7) % 7);
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function isUsExchangeHoliday(year: number, month: number, day: number): boolean {
  const key = dateKey(year, month, day);
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  return new Set([
    observedFixedHoliday(year, 1, 1),
    observedFixedHoliday(year + 1, 1, 1),
    dateKey(year, 1, nthWeekday(year, 1, 1, 3)),
    dateKey(year, 2, nthWeekday(year, 2, 1, 3)),
    dateKey(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate()),
    dateKey(year, 5, lastWeekday(year, 5, 1)),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    dateKey(year, 9, nthWeekday(year, 9, 1, 1)),
    dateKey(year, 11, nthWeekday(year, 11, 4, 4)),
    observedFixedHoliday(year, 12, 25),
  ]).has(key);
}

/** v1 excludes early-close expiries rather than changing their expiry hour. */
export function isUsEarlyCloseSession(year: number, month: number, day: number): boolean {
  return month === 11 && day === nthWeekday(year, 11, 4, 4) + 1;
}

export function rwaExpiries(count = 4, nowMs = Date.now()): number[] {
  const out: number[] = [];
  const cursor = new Date(nowMs);
  cursor.setUTCHours(12, 0, 0, 0);
  for (let index = 0; out.length < count && index < 60; index++) {
    const p = nyParts(cursor);
    const year = Number(p.year);
    const month = Number(p.month);
    const day = Number(p.day);
    if (
      p.weekday === "Fri" &&
      !isUsExchangeHoliday(year, month, day) &&
      !isUsEarlyCloseSession(year, month, day)
    ) {
      const expiry = nyCloseEpoch(year, month, day);
      if (expiry * 1000 - nowMs > 24 * 3_600_000) out.push(expiry);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
