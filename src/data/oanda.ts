// OANDA fiyatları (TradingView'daki OANDA:XAUUSD, OANDA:EURUSD gibi): uygulamanın sunucusu üzerinden.
// API anahtarı yalnızca sunucuda durur; tarayıcı yalnızca /api/oanda/* adreslerini çağırır.
import { oandaGranularity, type Interval } from './intervals.ts';
import { instrumentName, instrumentType, matchInstruments, type CompactBar, type OandaInstrument } from './oandaLogic.ts';
import { makeId, makeQuote, type Bar, type Quote, type SymbolDef } from './types.ts';

const HEADERS = { 'Content-Type': 'application/json', 'X-GT-Client': '1' };
export const OANDA_LIMIT = 5000;

export async function oandaApi<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/oanda${path}`, {
      method,
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Sunucuya ulaşılamadı.');
  }
  if (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error('Bu kurulumda sunucu yok: OANDA fiyatları sunucuda çalışan sürümde kullanılabilir.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`);
  return data;
}

let configuredPromise: Promise<boolean> | null = null;
let instrumentsPromise: Promise<OandaInstrument[]> | null = null;

/** OANDA anahtarı sunucuya eklenmiş mi (sonuç sayfa açıkken saklanır). */
export function oandaConfigured(): Promise<boolean> {
  configuredPromise ??= oandaApi<{ configured: boolean }>('GET', '')
    .then((s) => s.configured)
    .catch(() => {
      configuredPromise = null;
      return false;
    });
  return configuredPromise;
}

/** Anahtar eklenince ya da kaldırılınca saklanan bilgiyi unut. */
export function resetOanda(): void {
  configuredPromise = null;
  instrumentsPromise = null;
}

export function oandaInstruments(): Promise<OandaInstrument[]> {
  instrumentsPromise ??= oandaApi<{ instruments: OandaInstrument[] }>('GET', '/instruments')
    .then((r) => r.instruments)
    .catch((e) => {
      instrumentsPromise = null;
      throw e;
    });
  return instrumentsPromise;
}

export async function oandaInstrument(name: string): Promise<OandaInstrument> {
  const i = (await oandaInstruments()).find((x) => x.name === name);
  if (!i) throw new Error(`OANDA'da ${name.replace('_', '')} bulunamadı.`);
  return i;
}

export function oandaDef(i: OandaInstrument): SymbolDef {
  return { id: makeId('OANDA', i.name), source: 'OANDA', ticker: i.name, name: instrumentName(i), exchange: 'OANDA', type: instrumentType(i) };
}

/** Arama: OANDA bağlı değilse boş. */
export async function oandaSearch(query: string, limit = 6): Promise<SymbolDef[]> {
  if (!(await oandaConfigured())) return [];
  return matchInstruments(await oandaInstruments(), query, limit).map(oandaDef);
}

const toBar = (b: CompactBar): Bar => ({ timestamp: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });

/** before verilirse o andan önceki mumlar (eskiye doğru sayfalama). */
export async function oandaCandles(instrument: string, base: Interval, opts: { before?: number; count?: number } = {}): Promise<Bar[]> {
  const params = new URLSearchParams({
    instrument,
    granularity: oandaGranularity(base),
    count: String(opts.count ?? OANDA_LIMIT),
  });
  if (opts.before !== undefined) params.set('to', String(opts.before));
  const r = await oandaApi<{ bars: CompactBar[] }>('GET', `/candles?${params}`);
  return r.bars.map(toBar);
}

export async function oandaQuotes(instruments: string[]): Promise<Quote[]> {
  if (instruments.length === 0) return [];
  const r = await oandaApi<{ quotes: { instrument: string; price: number; prevClose: number | null; time: number }[] }>(
    'GET',
    `/quotes?instruments=${instruments.map(encodeURIComponent).join(',')}`,
  );
  return r.quotes.map((q) => makeQuote(makeId('OANDA', q.instrument), q.price, q.prevClose, q.time));
}
