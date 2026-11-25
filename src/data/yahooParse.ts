import type { Bar } from './types.ts';
import type { SessionWindow } from './session.ts';
import { type Interval, isTimeUnit, spanSeconds } from './intervals.ts';
import { localDay, monthIndex, weekIndex } from './tz.ts';

export interface YahooMeta {
  symbol: string;
  name: string;
  currency: string;
  exchangeName: string;
  instrumentType: string;
  timezone: string;
  /** UTC farkı, saniye */
  gmtoffset: number;
  /** Fiyatın ondalık basamağı */
  priceHint: number;
  price: number | null;
  /** Önceki kapanış: yalnızca range=1d isteklerinde güvenilir. */
  prevClose: number | null;
  marketTime: number | null;
  /** Ön/son piyasa verisi var mı (ABD hisseleri) */
  hasPrePost: boolean;
  /** Tüm seanslardaki son fiyat (gece seansında gece fiyatı). Yahoo gece mumu vermez, yalnızca bu fiyatı verir. */
  fullDayPrice: number | null;
}

export interface YahooChart {
  meta: YahooMeta;
  bars: Bar[];
  /** Uzatılmış seansla istendiyse günlerin normal seans pencereleri (tradingPeriods.regular). */
  regular?: SessionWindow[];
  /** Yahoo'nun satırını verip değerlerini boş (null) bıraktığı mumların zamanı (ms). */
  gaps?: number[];
}

interface RawQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
}

interface RawResult {
  meta?: Record<string, unknown>;
  timestamp?: number[];
  indicators?: { quote?: RawQuote[] };
}

interface RawChart {
  chart?: { result?: RawResult[] | null; error?: { code?: string; description?: string } | null };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function parseMeta(m: Record<string, unknown>): YahooMeta {
  return {
    symbol: str(m.symbol),
    name: str(m.longName, str(m.shortName, str(m.symbol))),
    currency: str(m.currency),
    exchangeName: str(m.fullExchangeName, str(m.exchangeName)),
    instrumentType: str(m.instrumentType),
    timezone: str(m.exchangeTimezoneName, 'UTC'),
    gmtoffset: num(m.gmtoffset) ?? 0,
    priceHint: num(m.priceHint) ?? 2,
    price: num(m.regularMarketPrice),
    prevClose: num(m.previousClose) ?? num(m.chartPreviousClose),
    marketTime: num(m.regularMarketTime),
    hasPrePost: m.hasPrePostMarketData === true,
    fullDayPrice: num(m.fulldayPrice),
  };
}

/** includePrePost=true yanıtında tradingPeriods = { pre, regular, post }: her biri gün başına [{ start, end }]. */
function parseRegularPeriods(tp: unknown): SessionWindow[] | undefined {
  const regular = (tp as { regular?: unknown } | null)?.regular;
  if (!Array.isArray(regular)) return undefined;
  const out: SessionWindow[] = [];
  for (const day of regular) {
    for (const p of Array.isArray(day) ? day : [day]) {
      const start = num((p as { start?: unknown })?.start);
      const end = num((p as { end?: unknown })?.end);
      if (start !== null && end !== null && end > start) out.push({ start: start * 1000, end: end * 1000 });
    }
  }
  return out;
}

/**
 * Yahoo v8/finance/chart yanıtını mumlara çevirir. Hata yanıtında istisna fırlatır.
 * extended: istek includePrePost=true ile yapıldı (ön/son piyasa mumları var).
 */
export function parseYahooChart(json: unknown, base: Interval, extended = false): YahooChart {
  const chart = (json as RawChart)?.chart;
  if (chart?.error) {
    throw new Error(chart.error.description || chart.error.code || 'Yahoo hatası');
  }
  const r = chart?.result?.[0];
  if (!r || !r.meta) throw new Error('Yahoo: boş yanıt');
  const meta = parseMeta(r.meta);

  const ts = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const raw: Bar[] = [];
  const gaps: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    if (open == null || high == null || low == null || close == null) {
      gaps.push(ts[i] * 1000);
      continue;
    }
    raw.push({
      timestamp: ts[i] * 1000,
      open,
      high,
      low,
      close,
      volume: q.volume?.[i] ?? 0,
    });
  }
  const regular = extended ? parseRegularPeriods(r.meta.tradingPeriods) : undefined;
  return { meta, bars: normalizeBars(raw, base, meta.timezone, extended), gaps, ...(regular ? { regular } : {}) };
}

/**
 * Yahoo BIST'te son günlerin günlük mumları boş (null) gelebiliyor; saatlik veri ise tam.
 * Boş günleri o günün saatlik mumlarından hesaplar (açılış, en yüksek, en düşük, kapanış, hacim).
 * Saatlik verisi olmayan günler (ör. henüz açılmamış bugün) atlanır.
 */
export function fillDailyGaps(daily: Bar[], gaps: number[], hourly: Bar[], timeZone: string): Bar[] {
  if (gaps.length === 0 || hourly.length === 0) return daily;
  const have = new Set(daily.map((b) => localDay(b.timestamp, timeZone)));
  const byDay = new Map<number, Bar[]>();
  for (const h of hourly) {
    const d = localDay(h.timestamp, timeZone);
    const list = byDay.get(d);
    if (list) list.push(h);
    else byDay.set(d, [h]);
  }
  const added: Bar[] = [];
  for (const t of gaps) {
    const d = localDay(t, timeZone);
    const hs = byDay.get(d);
    if (!hs || have.has(d)) continue;
    have.add(d);
    added.push({
      timestamp: t,
      open: hs[0].open,
      high: Math.max(...hs.map((x) => x.high)),
      low: Math.min(...hs.map((x) => x.low)),
      close: hs[hs.length - 1].close,
      volume: hs.reduce((s, x) => s + x.volume, 0),
    });
  }
  if (added.length === 0) return daily;
  return [...daily, ...added].sort((a, b) => a.timestamp - b.timestamp);
}

const HALF_HOUR_MS = 1800_000;

function sameCalendarBucket(a: number, b: number, unit: Interval['unit'], timeZone: string): boolean {
  const da = localDay(a, timeZone);
  const db = localDay(b, timeZone);
  if (unit === 'day') return da === db;
  if (unit === 'week') return weekIndex(da) === weekIndex(db);
  return monthIndex(a, timeZone) === monthIndex(b, timeZone);
}

function mergeInto(prev: Bar, b: Bar): void {
  if (b.high > prev.high) prev.high = b.high;
  if (b.low < prev.low) prev.low = b.low;
  prev.close = b.close;
  prev.volume += b.volume;
}

/**
 * Yahoo, piyasa açıkken son satırı "şu anki an" zamanıyla döndürür (ör. 5dk'da 17:38:05).
 * Bu satır ait olduğu muma birleştirilmezse grafik her yenilemede sahte yeni mum ekler.
 * - Gün içi: önceki mumun ızgarasına oturmayan satır, düştüğü muma birleştirilir
 *   ya da yeni mumun başlangıç zamanına hizalanır.
 * - Gün/hafta/ay: aynı yerel gün/hafta/ay içindeki ek satır o muma birleştirilir.
 * extended: uzatılmış seansta Yahoo her seansı kendi başlangıcından sayar (saatlikte 09:00, 09:30, 10:30…
 *   ve 15:30, 16:00, 17:00). Seans sınırları yarım saate denk geldiği için yarım saate oturan satır gerçektir.
 */
export function normalizeBars(raw: Bar[], base: Interval, timeZone: string, extended = false): Bar[] {
  const out: Bar[] = [];
  for (const b of raw) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ...b });
      continue;
    }
    if (b.timestamp <= prev.timestamp) {
      if (b.timestamp === prev.timestamp) out[out.length - 1] = { ...b };
      continue;
    }
    if (isTimeUnit(base.unit)) {
      const S = spanSeconds(base) * 1000;
      const diff = b.timestamp - prev.timestamp;
      const onSessionGrid = extended && b.timestamp % Math.min(S, HALF_HOUR_MS) === 0;
      if (diff % S !== 0 && !onSessionGrid) {
        const aligned = prev.timestamp + Math.floor(diff / S) * S;
        if (aligned === prev.timestamp) mergeInto(prev, b);
        else out.push({ ...b, timestamp: aligned });
        continue;
      }
      out.push({ ...b });
    } else if (sameCalendarBucket(prev.timestamp, b.timestamp, base.unit, timeZone)) {
      mergeInto(prev, b);
    } else {
      out.push({ ...b });
    }
  }
  return out;
}
