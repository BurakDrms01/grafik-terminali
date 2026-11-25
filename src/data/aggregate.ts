import type { Bar } from './types.ts';
import { type Interval, isTimeUnit, sameInterval, spanSeconds } from './intervals.ts';
import { localDay, localDayStartSec, monthIndex, weekIndex } from './tz.ts';

/**
 * Gün içi kovaların başlangıcı:
 * - 'firstBar': o günün ilk mumu (borsalar: seans başından itibaren 4 saatlik vb.)
 * - 'midnight': yerel gece yarısı (7/24 işlem gören kripto)
 */
export type DayStart = 'firstBar' | 'midnight';

export interface AggregateOptions {
  target: Interval;
  base: Interval;
  /** Borsanın saat dilimi (ör. "Europe/Istanbul", "UTC"). Yerel gün/hafta/ay sınırları için. */
  timeZone: string;
  dayStart: DayStart;
}

/**
 * Küçük mumları büyük dilime birleştirir (ör. 1dk → 7dk, 1sa → 4sa, 1A → 3A).
 * Girdi zamana göre artan sırada olmalı. Taban ile hedef aynıysa kopyasını döndürür.
 */
export function aggregate(bars: Bar[], o: AggregateOptions): Bar[] {
  if (bars.length === 0 || sameInterval(o.target, o.base)) return bars.map((b) => ({ ...b }));

  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curKey = NaN;
  let anchorDay = NaN;
  let anchorSec = 0;

  for (const b of bars) {
    const day = localDay(b.timestamp, o.timeZone);
    let key: number;
    let ts: number;

    if (isTimeUnit(o.target.unit)) {
      const S = spanSeconds(o.target);
      const t = b.timestamp / 1000;
      if (o.dayStart === 'midnight') {
        anchorSec = localDayStartSec(b.timestamp, o.timeZone);
      } else if (day !== anchorDay) {
        anchorDay = day;
        anchorSec = t;
      }
      ts = (anchorSec + Math.floor((t - anchorSec) / S) * S) * 1000;
      key = ts;
    } else {
      const N = o.target.span;
      if (o.target.unit === 'day') key = Math.floor(day / N);
      else if (o.target.unit === 'week') key = Math.floor(weekIndex(day) / N);
      else key = Math.floor(monthIndex(b.timestamp, o.timeZone) / N);
      ts = b.timestamp;
    }

    if (cur !== null && key === curKey) {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume;
    } else {
      cur = { timestamp: ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      curKey = key;
      out.push(cur);
    }
  }
  return out;
}

/**
 * Sıralı mum listesine yeni/güncel mumları işler (aynı zaman → değiştir, yeni → ekle).
 * Değişen en eski mumun zamanını döndürür (hiçbiri değişmediyse null).
 */
export function mergeBars(target: Bar[], incoming: Bar[]): number | null {
  let earliest: number | null = null;
  for (const b of incoming) {
    const last = target[target.length - 1];
    if (!last || b.timestamp > last.timestamp) {
      target.push({ ...b });
    } else if (b.timestamp === last.timestamp) {
      target[target.length - 1] = { ...b };
    } else {
      let lo = 0;
      let hi = target.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = target[mid].timestamp;
        if (t === b.timestamp) {
          found = mid;
          break;
        }
        if (t < b.timestamp) lo = mid + 1;
        else hi = mid - 1;
      }
      if (found >= 0) target[found] = { ...b };
      else target.splice(lo, 0, { ...b });
    }
    if (earliest === null || b.timestamp < earliest) earliest = b.timestamp;
  }
  return earliest;
}
