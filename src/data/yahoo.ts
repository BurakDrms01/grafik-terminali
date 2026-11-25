// Yahoo Finance: BIST, ABD hisseleri, endeksler, döviz, emtia. Vite proxy'si üzerinden (/yahoo).
import { fillDailyGaps, parseYahooChart, type YahooChart, type YahooMeta } from './yahooParse.ts';
import { type Interval, isTimeUnit, yahooHistoryDays, yahooIntervalString } from './intervals.ts';
import { combineBars, syntheticOf, type SyntheticDef } from './synthetic.ts';
import { localDayStartSec } from './tz.ts';
import { makeId, makeQuote, type Quote, type SymbolDef } from './types.ts';

const BASE = '/yahoo';
const MAX_PARALLEL = 4;

let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function getJson(path: string): Promise<unknown> {
  return limited(async () => {
    let res: Response;
    try {
      res = await fetch(BASE + path);
    } catch {
      throw new Error('Yahoo’ya ulaşılamadı (internet bağlantısını kontrol edin)');
    }
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* gövde JSON değil */
      }
      // Yahoo "bulunamadı" gibi hataları JSON olarak döndürür; ayrıştırıcı açıklamalı hata verir.
      if (body && typeof body === 'object' && 'chart' in body) return body;
      if (res.status === 429) throw new Error('Yahoo çok fazla istek dedi, biraz sonra tekrar deneyin');
      throw new Error(`Yahoo hatası (${res.status})`);
    }
    return res.json();
  });
}

const chartPath = (ticker: string, query: string) => `/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`;

/** Ön/son piyasa yalnızca gün içi dilimlerde istenir; günlük ve üstü her zaman normal seanstır. */
const wantsPrePost = (base: Interval, extended: boolean) => extended && isTimeUnit(base.unit);
const prePostQuery = (on: boolean) => (on ? '&includePrePost=true' : '');

const metaCache = new Map<string, YahooMeta>();

/** Hesaplanan sembolün bilgisi: saat dilimi vb. ilk bileşenden, ad ve ondalık tanımdan. */
function syntheticMeta(def: SyntheticDef, a: YahooMeta, b: YahooMeta): YahooMeta {
  const price = a.price !== null && b.price !== null ? a.price * b.price * def.factor : null;
  const prevClose = a.prevClose !== null && b.prevClose !== null ? a.prevClose * b.prevClose * def.factor : null;
  const meta: YahooMeta = {
    ...a,
    symbol: def.ticker,
    name: def.name,
    currency: 'TRY',
    exchangeName: 'Hesaplanan',
    instrumentType: 'FUTURE',
    priceHint: def.priceHint,
    price,
    prevClose,
    marketTime: Math.max(a.marketTime ?? 0, b.marketTime ?? 0) || null,
  };
  metaCache.set(def.ticker, meta);
  return meta;
}

/** Sembol bilgisi (ondalık, saat dilimi, ad) ve güncel fiyat. Tek küçük istek. */
export async function yahooQuote(ticker: string): Promise<{ meta: YahooMeta; quote: Quote | null }> {
  const syn = syntheticOf(ticker);
  if (syn) {
    const [qa, qb] = await Promise.all([yahooQuote(syn.a), yahooQuote(syn.b)]);
    const meta = syntheticMeta(syn, qa.meta, qb.meta);
    const quote =
      meta.price !== null ? makeQuote(makeId('YAHOO', ticker), meta.price, meta.prevClose, (meta.marketTime ?? 0) * 1000, meta.priceHint) : null;
    return { meta, quote };
  }
  const json = await getJson(chartPath(ticker, 'interval=1d&range=1d'));
  const { meta } = parseYahooChart(json, { unit: 'day', span: 1 });
  metaCache.set(ticker, meta);
  const id = makeId('YAHOO', ticker);
  const quote =
    meta.price !== null
      ? makeQuote(id, meta.price, meta.prevClose, (meta.marketTime ?? 0) * 1000, meta.priceHint)
      : null;
  return { meta, quote };
}

export async function yahooMeta(ticker: string): Promise<YahooMeta> {
  return metaCache.get(ticker) ?? (await yahooQuote(ticker)).meta;
}

/** Taban dilim için Yahoo'nun izin verdiği tüm geçmiş (tek istek). extended: ön/son piyasa dahil. */
export async function yahooHistory(ticker: string, base: Interval, timeZone: string, extended = false): Promise<YahooChart> {
  const syn = syntheticOf(ticker);
  if (syn) {
    const [ca, cb] = await Promise.all([yahooHistory(syn.a, base, timeZone, extended), yahooHistory(syn.b, base, timeZone, extended)]);
    return { meta: syntheticMeta(syn, ca.meta, cb.meta), bars: combineBars(ca.bars, cb.bars, syn.factor) };
  }
  const iv = yahooIntervalString(base);
  const days = yahooHistoryDays(base);
  const now = Math.floor(Date.now() / 1000);
  let period1 = 0;
  if (days !== null) {
    // Pencere yerel gece yarısından başlasın: ilk gün eksik kalmasın (4sa gibi birleştirmeler için).
    const start = (now - days * 86400 + 86400) * 1000;
    period1 = localDayStartSec(start, timeZone);
  }
  const ext = wantsPrePost(base, extended);
  const json = await getJson(chartPath(ticker, `interval=${iv}&period1=${period1}&period2=${now + 60}${prePostQuery(ext)}`));
  const chart = await withDailyGaps(ticker, parseYahooChart(json, base, ext), base, '1mo');
  metaCache.set(ticker, chart.meta);
  return chart;
}

/** Günlükte son 30 günde boş gelen mumları saatlik veriden doldurur (bkz. fillDailyGaps). */
async function withDailyGaps(ticker: string, chart: YahooChart, base: Interval, range: '5d' | '1mo'): Promise<YahooChart> {
  if (base.unit !== 'day' || base.span !== 1) return chart;
  const since = Date.now() - 31 * 86400_000;
  const gaps = (chart.gaps ?? []).filter((t) => t >= since);
  if (gaps.length === 0) return chart;
  try {
    const hourly = parseYahooChart(await getJson(chartPath(ticker, `interval=60m&range=${range}`)), { unit: 'hour', span: 1 });
    return { ...chart, bars: fillDailyGaps(chart.bars, gaps, hourly.bars, chart.meta.timezone) };
  } catch {
    return chart;
  }
}

/** Canlı güncelleme için son mumlar. */
export async function yahooRecent(ticker: string, base: Interval, extended = false): Promise<YahooChart> {
  const syn = syntheticOf(ticker);
  if (syn) {
    const [ca, cb] = await Promise.all([yahooRecent(syn.a, base, extended), yahooRecent(syn.b, base, extended)]);
    return { meta: syntheticMeta(syn, ca.meta, cb.meta), bars: combineBars(ca.bars, cb.bars, syn.factor) };
  }
  const iv = yahooIntervalString(base);
  let range = '1d';
  if (!isTimeUnit(base.unit)) range = base.unit === 'day' ? '5d' : base.unit === 'week' ? '1mo' : '3mo';
  const ext = wantsPrePost(base, extended);
  const json = await getJson(chartPath(ticker, `interval=${iv}&range=${range}${prePostQuery(ext)}`));
  return withDailyGaps(ticker, parseYahooChart(json, base, ext), base, '5d');
}

interface RawSearchQuote {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
  typeDisp?: string;
}

const SEARCH_TYPES = new Set(['EQUITY', 'ETF', 'INDEX', 'CURRENCY', 'CRYPTOCURRENCY', 'FUTURE']);
const TYPE_TR: Record<string, string> = {
  EQUITY: 'Hisse',
  ETF: 'ETF',
  INDEX: 'Endeks',
  CURRENCY: 'Döviz',
  CRYPTOCURRENCY: 'Kripto',
  FUTURE: 'Vadeli',
};

/** Arama boş dönünce sembolleri doğrudan dener (ör. arama dizininde olmayan BIST hisseleri). */
export async function yahooProbe(tickers: string[]): Promise<SymbolDef[]> {
  const res = await Promise.allSettled(tickers.map((t) => yahooMeta(t)));
  const out: SymbolDef[] = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const m = r.value;
    const ticker = m.symbol || tickers[i];
    if (out.some((d) => d.ticker === ticker)) return;
    out.push({
      id: makeId('YAHOO', ticker),
      source: 'YAHOO',
      ticker,
      name: m.name || ticker,
      exchange: m.exchangeName || '',
      type: TYPE_TR[m.instrumentType] ?? m.instrumentType ?? '',
    });
  });
  return out;
}

export async function yahooSearch(query: string): Promise<SymbolDef[]> {
  const json = (await getJson(
    `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0`,
  )) as { quotes?: RawSearchQuote[] };
  const out: SymbolDef[] = [];
  for (const q of json.quotes ?? []) {
    if (!q.symbol || !q.quoteType || !SEARCH_TYPES.has(q.quoteType)) continue;
    out.push({
      id: makeId('YAHOO', q.symbol),
      source: 'YAHOO',
      ticker: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange || '',
      type: TYPE_TR[q.quoteType] ?? q.typeDisp ?? q.quoteType,
    });
  }
  return out;
}
