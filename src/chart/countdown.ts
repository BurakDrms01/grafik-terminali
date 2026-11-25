// Mum kapanışına geri sayım hesabı (fiyat eksenindeki son fiyat etiketinin altında gösterilir).
import type { Period } from 'klinecharts';

function addMonths(ts: number, months: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

/** Mumun kapanacağı an (ms). */
export function barEnd(ts: number, period: Period): number {
  const s = period.span;
  switch (period.type) {
    case 'second':
      return ts + s * 1000;
    case 'minute':
      return ts + s * 60_000;
    case 'hour':
      return ts + s * 3_600_000;
    case 'day':
      return ts + s * 86_400_000;
    case 'week':
      return ts + s * 7 * 86_400_000;
    case 'month':
      return addMonths(ts, s);
    case 'year':
      return addMonths(ts, s * 12);
  }
}

/** Kalan süre: "04:59", "1:04:59", "3g 04sa" */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const hh = Math.floor((total % 86400) / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}g ${p(hh)}sa`;
  if (hh > 0) return `${hh}:${p(mm)}:${p(ss)}`;
  return `${p(mm)}:${p(ss)}`;
}
