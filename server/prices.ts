// Sunucu tarafında alarm kontrolü için anlık fiyat: Yahoo (BIST, ABD, döviz, emtia), Binance (kripto,
// vadesiz emtialar) ve hesaplanan semboller (gram altın gibi).
import { syntheticOf } from '../src/data/synthetic.ts';
import { parseId } from '../src/data/types.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface YahooResult {
  meta?: { regularMarketPrice?: number; hasPrePostMarketData?: boolean };
  indicators?: { quote?: { close?: (number | null)[] }[] };
}

/**
 * Yahoo fiyatı. extended: ABD hisselerinde ön/son piyasa fiyatı da sayılır (uygulamadaki
 * "Uzatılmış" düğmesiyle aynı tercih); diğer sembollerde normal piyasa fiyatı.
 */
export async function yahooPrice(ticker: string, extended: boolean): Promise<number | null> {
  const query = extended ? 'interval=5m&range=1d&includePrePost=true' : 'interval=1d&range=1d';
  const json = (await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`, {
    'User-Agent': UA,
  })) as { chart?: { result?: YahooResult[] } };
  const r = json.chart?.result?.[0];
  if (!r) return null;
  if (extended && r.meta?.hasPrePostMarketData) {
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const c = closes[i];
      if (typeof c === 'number' && Number.isFinite(c)) return c;
    }
  }
  const p = r.meta?.regularMarketPrice;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

export async function binancePrice(ticker: string): Promise<number | null> {
  for (const host of BINANCE_HOSTS) {
    try {
      const j = (await getJson(`${host}/api/v3/ticker/price?symbol=${encodeURIComponent(ticker)}`)) as { price?: string };
      const p = Number(j.price);
      if (Number.isFinite(p)) return p;
    } catch {
      /* bölge engeli ya da geçici hata: yedek sunucuyu dene */
    }
  }
  return null;
}

/** Binance vadesiz piyasa (altın, gümüş, petrol… 7/24) son fiyatı. */
export async function binanceFuturesPrice(ticker: string): Promise<number | null> {
  const j = (await getJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(ticker)}`)) as { price?: string };
  const p = Number(j.price);
  return Number.isFinite(p) ? p : null;
}

/** Uygulamadaki sembol kimliğine ("YAHOO:AAPL", "BINANCE:BTCUSDT") göre güncel fiyat. */
export async function symbolPrice(symbolId: string, extended: boolean): Promise<number | null> {
  const p = parseId(symbolId);
  if (!p) return null;
  if (p.source === 'BINANCE') return binancePrice(p.ticker);
  if (p.source === 'BINANCEF') return binanceFuturesPrice(p.ticker);
  const syn = syntheticOf(p.ticker);
  if (syn) {
    const [a, b] = await Promise.all([yahooPrice(syn.a, false), yahooPrice(syn.b, false)]);
    return a !== null && b !== null ? a * b * syn.factor : null;
  }
  return yahooPrice(p.ticker, extended);
}
