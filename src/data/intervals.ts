import type { Source } from './types.ts';

export type TimeUnit = 'second' | 'minute' | 'hour';
export type CalendarUnit = 'day' | 'week' | 'month';
export type Unit = TimeUnit | CalendarUnit;

/** Zaman dilimi: birim + adet. Ör. {unit:'minute', span:45} = 45 dakika. */
export interface Interval {
  unit: Unit;
  span: number;
}

const TIME_SEC: Record<TimeUnit, number> = { second: 1, minute: 60, hour: 3600 };

export function isTimeUnit(u: Unit): u is TimeUnit {
  return u === 'second' || u === 'minute' || u === 'hour';
}

/** Saniye/dakika/saat dilimlerinin saniye cinsinden uzunluğu. */
export function spanSeconds(i: Interval): number {
  if (!isTimeUnit(i.unit)) throw new Error(`spanSeconds: takvim birimi (${i.unit})`);
  return TIME_SEC[i.unit] * i.span;
}

export function sameInterval(a: Interval, b: Interval): boolean {
  if (isTimeUnit(a.unit) && isTimeUnit(b.unit)) return spanSeconds(a) === spanSeconds(b);
  return a.unit === b.unit && a.span === b.span;
}

const KEY_SUFFIX: Record<Unit, string> = { second: 's', minute: 'm', hour: 'h', day: 'D', week: 'W', month: 'M' };
const SUFFIX_UNIT: Record<string, Unit> = { s: 'second', m: 'minute', h: 'hour', D: 'day', W: 'week', M: 'month' };
const SHORT_TR: Record<Unit, string> = { second: 'sn', minute: 'dk', hour: 'sa', day: 'G', week: 'H', month: 'A' };
const LONG_TR: Record<Unit, string> = { second: 'saniye', minute: 'dakika', hour: 'saat', day: 'gün', week: 'hafta', month: 'ay' };

/** Kayıt anahtarı: "45m", "4h", "1D", "1W", "3M", "5s". */
export function intervalKey(i: Interval): string {
  return `${i.span}${KEY_SUFFIX[i.unit]}`;
}

export function parseIntervalKey(key: string): Interval | null {
  const m = /^(\d+)([smhDWM])$/.exec(key);
  if (!m) return null;
  const unit = SUFFIX_UNIT[m[2]];
  const span = Number(m[1]);
  if (!unit || !Number.isInteger(span)) return null;
  const i = { unit, span };
  return isValidInterval(i) ? i : null;
}

/** Kısa etiket: "45dk", "4sa", "1G", "1H", "3A", "5sn". */
export function intervalLabel(i: Interval): string {
  return `${i.span}${SHORT_TR[i.unit]}`;
}

/** Uzun etiket: "45 dakika", "1 hafta". */
export function intervalLongLabel(i: Interval): string {
  return `${i.span} ${LONG_TR[i.unit]}`;
}

/** Özel dilim girişi için sınırlar. */
export const SPAN_LIMITS: Record<Unit, number> = { second: 59, minute: 1439, hour: 24, day: 365, week: 52, month: 36 };

export function isValidInterval(i: Interval): boolean {
  return Number.isInteger(i.span) && i.span >= 1 && i.span <= SPAN_LIMITS[i.unit];
}

/** Menüde listelenen hazır dilimler. */
export const PRESET_GROUPS: { title: string; items: Interval[] }[] = [
  {
    title: 'Saniye (yalnızca kripto)',
    items: [1, 5, 15, 30].map((span) => ({ unit: 'second' as const, span })),
  },
  {
    title: 'Dakika',
    items: [1, 3, 5, 15, 30, 45].map((span) => ({ unit: 'minute' as const, span })),
  },
  {
    title: 'Saat',
    items: [1, 2, 3, 4, 6, 8, 12].map((span) => ({ unit: 'hour' as const, span })),
  },
  {
    title: 'Gün / Hafta / Ay',
    items: [
      { unit: 'day', span: 1 },
      { unit: 'day', span: 3 },
      { unit: 'week', span: 1 },
      { unit: 'month', span: 1 },
      { unit: 'month', span: 3 },
      { unit: 'month', span: 12 },
    ],
  },
];

export const DEFAULT_FAVORITES: string[] = ['1m', '5m', '15m', '1h', '4h', '1D', '1W', '1M'];

// ---- Kaynakların doğrudan verdiği dilimler ----
// Binance: 1s 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M
const BINANCE_TIME_NATIVE = [1, 60, 180, 300, 900, 1800, 3600, 7200, 14400, 21600, 28800, 43200];
const BINANCE_DAY_NATIVE = [1, 3];
/** Vadesiz piyasada saniye mumu yok */
const FUTURES_TIME_NATIVE = BINANCE_TIME_NATIVE.filter((n) => n >= 60);
// Yahoo: 1m 2m 5m 15m 30m 60m 1d 1wk 1mo  (90m bilerek yok: 60m'nin geçmişi çok daha uzun)
const YAHOO_TIME_NATIVE = [60, 120, 300, 900, 1800, 3600];

function secondsToInterval(sec: number): Interval {
  if (sec % 3600 === 0) return { unit: 'hour', span: sec / 3600 };
  if (sec % 60 === 0) return { unit: 'minute', span: sec / 60 };
  return { unit: 'second', span: sec };
}

/**
 * İstenen dilim için kaynaktan çekilecek "taban" dilimi seçer: hedefi tam bölen en büyük
 * doğal dilim. Taban hedefle aynı değilse mumlar birleştirilir (aggregate.ts).
 * Kaynak bu dilimi hiç veremiyorsa null (ör. Yahoo'da saniye).
 */
export function chooseBase(target: Interval, source: Source): Interval | null {
  if (isTimeUnit(target.unit)) {
    const s = spanSeconds(target);
    const natives = source === 'BINANCE' ? BINANCE_TIME_NATIVE : source === 'BINANCEF' ? FUTURES_TIME_NATIVE : YAHOO_TIME_NATIVE;
    const fits = natives.filter((n) => s % n === 0);
    if (fits.length === 0) return null;
    return secondsToInterval(Math.max(...fits));
  }
  if (target.unit === 'day') {
    const natives = source === 'YAHOO' ? [1] : BINANCE_DAY_NATIVE;
    const best = Math.max(...natives.filter((n) => target.span % n === 0));
    return { unit: 'day', span: best };
  }
  return { unit: target.unit, span: 1 };
}

export function binanceIntervalString(base: Interval): string {
  switch (base.unit) {
    case 'second':
      return `${base.span}s`;
    case 'minute':
      return `${base.span}m`;
    case 'hour':
      return `${base.span}h`;
    case 'day':
      return `${base.span}d`;
    case 'week':
      return '1w';
    case 'month':
      return '1M';
  }
}

export function yahooIntervalString(base: Interval): string {
  switch (base.unit) {
    case 'second':
      throw new Error('Yahoo saniye verisi vermiyor');
    case 'minute':
      return `${base.span}m`;
    case 'hour':
      return `${base.span * 60}m`;
    case 'day':
      return '1d';
    case 'week':
      return '1wk';
    case 'month':
      return '1mo';
  }
}

/** Yahoo'nun taban dilime göre izin verdiği geçmiş (gün). null = sınırsız. */
export function yahooHistoryDays(base: Interval): number | null {
  if (base.unit === 'minute' && base.span === 1) return 7;
  if (base.unit === 'minute') return 59;
  if (base.unit === 'hour') return 729;
  return null;
}
