// Binance açık piyasa verisi: anahtar gerekmez, anlık. Tarayıcıdan doğrudan çağrılır.
// Spot (kripto) ve vadesiz piyasa (futures: altın, gümüş, petrol gibi emtialar 7/24).
import { binanceIntervalString, type Interval } from './intervals.ts';
import { makeId, makeQuote, type Bar, type Quote, type SymbolDef } from './types.ts';

const REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const WS_HOSTS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];
const FUTURES_REST_HOSTS = ['https://fapi.binance.com'];
const FUTURES_WS_HOSTS = ['wss://fstream.binance.com/market'];
export const KLINE_LIMIT = 1000;

class BinanceApiError extends Error {}

let restHost = 0;

/** "/fapi/…" yolları vadesiz piyasa sunucusuna gider. */
async function rest(path: string): Promise<unknown> {
  const futures = path.startsWith('/fapi/');
  const hosts = futures ? FUTURES_REST_HOSTS : REST_HOSTS;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < hosts.length; attempt++) {
    const idx = futures ? attempt : (restHost + attempt) % hosts.length;
    try {
      const res = await fetch(hosts[idx] + path);
      if (res.status === 451 || res.status === 403) {
        lastError = new Error(`Binance erişimi engellendi (${res.status})`);
        continue; // bölge engeli: yedek sunucuyu dene
      }
      if (!res.ok) {
        let msg = `Binance hatası (${res.status})`;
        try {
          const body = (await res.json()) as { msg?: string };
          if (body.msg) msg = `Binance: ${body.msg}`;
        } catch {
          /* gövde JSON değil */
        }
        throw new BinanceApiError(msg);
      }
      if (!futures) restHost = idx;
      return await res.json();
    } catch (e) {
      if (e instanceof BinanceApiError) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Binance’e ulaşılamadı');
}

interface RawFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
}
interface RawSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: RawFilter[];
}

function decimalsOf(step: string | undefined, fallback: number): number {
  if (!step) return fallback;
  const n = Number(step);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const trimmed = step.includes('.') ? step.replace(/0+$/, '') : step;
  const dot = trimmed.indexOf('.');
  return dot < 0 ? 0 : trimmed.length - dot - 1;
}

export interface BinanceSymbolMeta {
  pricePrecision: number;
  volumePrecision: number;
  baseAsset: string;
  quoteAsset: string;
}

const metaCache = new Map<string, BinanceSymbolMeta>();

function toMeta(s: RawSymbol): BinanceSymbolMeta {
  const price = s.filters.find((f) => f.filterType === 'PRICE_FILTER');
  const lot = s.filters.find((f) => f.filterType === 'LOT_SIZE');
  return {
    pricePrecision: decimalsOf(price?.tickSize, 2),
    volumePrecision: Math.min(4, decimalsOf(lot?.stepSize, 2)),
    baseAsset: s.baseAsset,
    quoteAsset: s.quoteAsset,
  };
}

let futuresSymbols: Promise<RawSymbol[]> | null = null;

export async function binanceSymbolMeta(ticker: string, futures = false): Promise<BinanceSymbolMeta> {
  const key = futures ? `F:${ticker}` : ticker;
  const cached = metaCache.get(key);
  if (cached) return cached;
  if (futures) {
    // Vadesiz piyasada tek sembol sorgusu yok: liste bir kez indirilir.
    futuresSymbols ??= (rest('/fapi/v1/exchangeInfo') as Promise<{ symbols: RawSymbol[] }>)
      .then((j) => j.symbols)
      .catch((e) => {
        futuresSymbols = null;
        throw e;
      });
    const s = (await futuresSymbols).find((x) => x.symbol === ticker);
    if (!s) throw new Error(`Binance vadeli piyasada ${ticker} bulunamadı`);
    const meta = toMeta(s);
    metaCache.set(key, meta);
    return meta;
  }
  const json = (await rest(
    `/api/v3/exchangeInfo?symbol=${encodeURIComponent(ticker)}&showPermissionSets=false`,
  )) as { symbols?: RawSymbol[] };
  const s = json.symbols?.[0];
  if (!s) throw new Error(`Binance'te ${ticker} bulunamadı`);
  const meta = toMeta(s);
  metaCache.set(ticker, meta);
  return meta;
}

let allSymbols: Promise<RawSymbol[]> | null = null;

/** İlk aramada işlemdeki tüm paritelerin listesi bir kez indirilir (~2,5 MB). */
function loadAllSymbols(): Promise<RawSymbol[]> {
  if (!allSymbols) {
    allSymbols = (rest('/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false') as Promise<{
      symbols: RawSymbol[];
    }>)
      .then((j) => j.symbols.filter((s) => s.status === 'TRADING'))
      .catch((e) => {
        allSymbols = null;
        throw e;
      });
  }
  return allSymbols;
}

const QUOTE_RANK = ['USDT', 'TRY', 'USDC', 'FDUSD', 'BTC', 'ETH', 'EUR'];

export async function binanceSearch(query: string, limit = 10): Promise<SymbolDef[]> {
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!q) return [];
  const all = await loadAllSymbols();
  // TradingView'daki "BTCUSD" → Binance'te asıl işlem gören BTCUSDT (BTC/USD çifti çok sığ).
  const usdt = q.endsWith('USD') ? `${q}T` : null;
  const scored: { s: RawSymbol; score: number }[] = [];
  for (const s of all) {
    let score: number;
    if (s.symbol === q || s.symbol === usdt) score = 0;
    else if (s.baseAsset === q) score = 1;
    else if (s.symbol.startsWith(q)) score = 2;
    else if (s.baseAsset.startsWith(q)) score = 3;
    else continue;
    const qr = QUOTE_RANK.indexOf(s.quoteAsset);
    scored.push({ s, score: score * 100 + (qr < 0 ? 50 : qr) });
  }
  scored.sort((a, b) => a.score - b.score || a.s.symbol.localeCompare(b.s.symbol));
  return scored.slice(0, limit).map(({ s }) => {
    metaCache.set(s.symbol, toMeta(s));
    return {
      id: makeId('BINANCE', s.symbol),
      source: 'BINANCE' as const,
      ticker: s.symbol,
      name: `${s.baseAsset} / ${s.quoteAsset}`,
      exchange: 'Binance',
      type: 'Kripto',
    };
  });
}

type RawKline = [number, string, string, string, string, string, ...unknown[]];

function klineToBar(k: RawKline): Bar {
  return { timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
}

/** endTime verilirse o andan (dahil) önceki mumlar. futures: vadesiz piyasa. */
export async function binanceKlines(
  ticker: string,
  base: Interval,
  opts: { endTime?: number; limit?: number; futures?: boolean } = {},
): Promise<Bar[]> {
  const params = new URLSearchParams({
    symbol: ticker,
    interval: binanceIntervalString(base),
    limit: String(opts.limit ?? KLINE_LIMIT),
  });
  if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime));
  const rows = (await rest(`${opts.futures ? '/fapi/v1' : '/api/v3'}/klines?${params}`)) as RawKline[];
  return rows.map(klineToBar);
}

interface RawMiniTicker {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  closeTime: number;
}

/** Son 24 saatlik değişimle anlık fiyatlar. */
export async function binanceTickers(tickers: string[], futures = false): Promise<Quote[]> {
  if (tickers.length === 0) return [];
  if (futures) {
    // Vadesiz piyasada çoklu sembol sorgusu yok: sembol başına bir istek.
    const rows = await Promise.all(
      tickers.map((t) => rest(`/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(t)}`) as Promise<RawMiniTicker>),
    );
    return rows.map((r) => makeQuote(makeId('BINANCEF', r.symbol), +r.lastPrice, +r.openPrice, r.closeTime));
  }
  const rows = (await rest(
    `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(tickers))}&type=MINI`,
  )) as RawMiniTicker[];
  return rows.map((r) => makeQuote(makeId('BINANCE', r.symbol), +r.lastPrice, +r.openPrice, r.closeTime));
}

/**
 * Binance WebSocket akışı. Kopunca artan beklemeyle yeniden bağlanır; ana sunucu tekrar tekrar
 * başarısız olursa yedeğe geçer. Yeniden bağlanınca onReconnect çağrılır (kaçan veriyi doldurmak için).
 */
export function openStream(
  path: string,
  onMessage: (data: unknown) => void,
  onReconnect?: () => void,
  futures = false,
): () => void {
  const hosts = futures ? FUTURES_WS_HOSTS : WS_HOSTS;
  let ws: WebSocket | null = null;
  let closed = false;
  let failures = 0;
  let hostIdx = 0;
  let everOpened = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    const sock = new WebSocket(hosts[hostIdx % hosts.length] + path);
    ws = sock;
    sock.onopen = () => {
      failures = 0;
      if (everOpened) onReconnect?.();
      everOpened = true;
    };
    sock.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)));
      } catch {
        /* bozuk mesaj */
      }
    };
    sock.onerror = () => sock.close();
    sock.onclose = () => {
      if (closed || ws !== sock) return;
      failures++;
      if (failures % 3 === 0) hostIdx++;
      timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
    };
  };
  connect();

  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
    ws = null;
  };
}

interface RawWsKline {
  k?: { t: number; o: string; h: string; l: string; c: string; v: string };
}

export function wsKlineToBar(msg: unknown): Bar | null {
  const k = (msg as RawWsKline)?.k;
  if (!k) return null;
  return { timestamp: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
}

interface RawWsMiniTicker {
  data?: { s: string; c: string; o: string; E: number };
}

export function wsMiniTickerToQuote(msg: unknown, futures = false): Quote | null {
  const d = (msg as RawWsMiniTicker)?.data;
  if (!d) return null;
  return makeQuote(makeId(futures ? 'BINANCEF' : 'BINANCE', d.s), +d.c, +d.o, d.E);
}
