// Uzatılmış seans (ABD ön piyasa 04:00–09:30 ve son piyasa 16:00–20:00, New York saati).
// Yahoo gece seansını (20:00–04:00) vermez; o saatler grafikte boş kalır.
import { load, save } from '../store.ts';
import { localDay, tzOffsetSec } from './tz.ts';

let extended = load<boolean>('extendedHours', true);

/** Kullanıcının tercihi: gün içi grafiklerde ön/son piyasa mumları gösterilsin mi. */
export function extendedHours(): boolean {
  return extended;
}

export function setExtendedHours(on: boolean): void {
  extended = on;
  save('extendedHours', on);
}

const nyClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** ABD gece seansı (Pazar–Perşembe 20:00 → ertesi gün 04:00, New York saati) şu an mı. */
export function isOvernightSession(nowMs: number): boolean {
  const parts = nyClock.formatToParts(new Date(nowMs));
  const day = WEEKDAY[parts.find((p) => p.type === 'weekday')?.value ?? ''] ?? -1;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
  if (hour >= 20) return day >= 0 && day <= 4;
  if (hour < 4) return day >= 1 && day <= 5;
  return false;
}

/** Normal seans penceresi (ms, UTC). */
export interface SessionWindow {
  start: number;
  end: number;
}

/** Yerel gün → o günün normal seansı. Yahoo'nun tradingPeriods bilgisinden (yarım günler dahil). */
export type RegularSessions = Map<number, SessionWindow>;

export function addRegularSessions(target: RegularSessions, windows: SessionWindow[], timeZone: string): void {
  for (const w of windows) target.set(localDay(w.start, timeZone), w);
}

const DEFAULT_OPEN_MIN = 9 * 60 + 30;
const DEFAULT_CLOSE_MIN = 16 * 60;

/** Günün normal seansı: bilinmiyorsa 09:30–16:00 yerel saat. */
export function regularWindow(day: number, sessions: RegularSessions, timeZone: string): SessionWindow {
  const known = sessions.get(day);
  if (known) return known;
  const noonUtc = (day * 86400 + 12 * 3600) * 1000;
  const off = tzOffsetSec(noonUtc, timeZone);
  const base = (day * 86400 - off) * 1000;
  return { start: base + DEFAULT_OPEN_MIN * 60000, end: base + DEFAULT_CLOSE_MIN * 60000 };
}

/** 'pre' | 'post': mum tamamen normal seansın dışında; null: normal seansla kesişiyor. */
export function extendedPart(ts: number, spanMs: number, sessions: RegularSessions, timeZone: string): 'pre' | 'post' | null {
  const w = regularWindow(localDay(ts, timeZone), sessions, timeZone);
  if (ts + spanMs <= w.start) return 'pre';
  if (ts >= w.end) return 'post';
  return null;
}
