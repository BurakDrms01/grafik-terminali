// Borsanın saat dilimine göre yerel gün/hafta/ay hesapları (yaz/kış saati dahil).

const DAY = 86400;
const dtfCache = new Map<string, Intl.DateTimeFormat | null>();
const offsetCache = new Map<string, number>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  let dtf = dtfCache.get(timeZone);
  if (dtf === undefined) {
    try {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      dtf = null; // bilinmeyen saat dilimi → UTC kabul edilir
    }
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** Verilen anda saat diliminin UTC farkı (saniye). Saat başına önbelleklenir. */
export function tzOffsetSec(tsMs: number, timeZone: string): number {
  if (!timeZone || timeZone === 'UTC' || timeZone === 'Etc/UTC' || timeZone === 'GMT') return 0;
  const hourStart = Math.floor(tsMs / 3600000) * 3600000;
  const key = `${timeZone}|${hourStart}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;

  const dtf = formatterFor(timeZone);
  let off = 0;
  if (dtf) {
    const parts = dtf.formatToParts(new Date(hourStart));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    off = Math.round((asUtc - hourStart) / 1000);
  }
  if (offsetCache.size > 200000) offsetCache.clear();
  offsetCache.set(key, off);
  return off;
}

/** 1970-01-01'den bu yana yerel gün numarası. */
export function localDay(tsMs: number, timeZone: string): number {
  return Math.floor((tsMs / 1000 + tzOffsetSec(tsMs, timeZone)) / DAY);
}

/** Yerel günün başlangıcı (UTC saniye). */
export function localDayStartSec(tsMs: number, timeZone: string): number {
  const off = tzOffsetSec(tsMs, timeZone);
  return Math.floor((tsMs / 1000 + off) / DAY) * DAY - off;
}

/** Pazartesi başlayan hafta numarası (1970-01-01 Perşembe = gün 0). */
export function weekIndex(day: number): number {
  return Math.floor((day + 3) / 7);
}

export function monthIndex(tsMs: number, timeZone: string): number {
  const d = new Date(tsMs + tzOffsetSec(tsMs, timeZone) * 1000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}
