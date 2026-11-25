// İzleme listesi ve alarmlar için ortak fiyat akışı.
// Kripto ve Binance vadesiz emtialar: Binance WebSocket (anlık). OANDA: birkaç saniyede bir (sunucu üzerinden).
// Diğerleri: Yahoo, dakikada bir yoklama.
import { binanceTickers, openStream, wsMiniTickerToQuote } from './binance.ts';
import { makeQuote, parseId, type Quote, type Source } from './types.ts';
import { oandaQuotes } from './oanda.ts';
import { yahooQuote } from './yahoo.ts';

const YAHOO_POLL_MS = 60000;
const OANDA_POLL_MS = 5000;

export class QuoteHub {
  private ids = new Set<string>();
  private quotes = new Map<string, Quote>();
  private listeners = new Set<(q: Quote) => void>();
  /** Binance spot ve vadesiz piyasa akışları (ayrı sunucular) */
  private readonly binance = {
    BINANCE: { key: '', stop: null as (() => void) | null },
    BINANCEF: { key: '', stop: null as (() => void) | null },
  };
  private yahooTimer: ReturnType<typeof setInterval> | null = null;
  private oandaTimer: ReturnType<typeof setInterval> | null = null;

  on(fn: (q: Quote) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get(id: string): Quote | undefined {
    return this.quotes.get(id);
  }

  /** Takip edilecek sembolleri ayarlar (izleme listesi + alarmı olanlar + açık grafik). */
  setSymbols(ids: string[]): void {
    const prev = this.ids;
    this.ids = new Set(ids);

    this.watchBinance('BINANCE');
    this.watchBinance('BINANCEF');

    const hasOanda = [...this.ids].some((id) => parseId(id)?.source === 'OANDA');
    if (hasOanda && [...this.ids].some((id) => !prev.has(id) && parseId(id)?.source === 'OANDA')) void this.pollOanda();
    if (hasOanda && this.oandaTimer === null) {
      this.oandaTimer = setInterval(() => {
        if (!document.hidden) void this.pollOanda();
      }, OANDA_POLL_MS);
    } else if (!hasOanda && this.oandaTimer !== null) {
      clearInterval(this.oandaTimer);
      this.oandaTimer = null;
    }

    const added = [...this.ids].filter((id) => !prev.has(id) && parseId(id)?.source === 'YAHOO');
    if (added.length > 0) void this.pollYahoo(added);
    if (this.yahooTimer === null) {
      this.yahooTimer = setInterval(() => {
        void this.pollYahoo([...this.ids].filter((id) => parseId(id)?.source === 'YAHOO'));
      }, YAHOO_POLL_MS);
    }
  }

  private watchBinance(source: Extract<Source, 'BINANCE' | 'BINANCEF'>): void {
    const tickers = [...this.ids]
      .map(parseId)
      .filter((p) => p?.source === source)
      .map((p) => p!.ticker)
      .sort();
    const state = this.binance[source];
    const key = tickers.join(',');
    if (key === state.key) return;
    state.key = key;
    state.stop?.();
    state.stop = null;
    if (tickers.length === 0) return;
    const futures = source === 'BINANCEF';
    const refresh = () => {
      binanceTickers(tickers, futures)
        .then((qs) => qs.forEach((q) => this.push(q)))
        .catch(() => {});
    };
    refresh();
    const streams = tickers.map((t) => `${t.toLowerCase()}@miniTicker`).join('/');
    state.stop = openStream(
      `/stream?streams=${streams}`,
      (msg) => {
        const q = wsMiniTickerToQuote(msg, futures);
        if (q) this.push(q);
      },
      refresh,
      futures,
    );
  }

  /** Açık grafikten gelen son fiyat: Yahoo sembollerinde yoklamayı beklemeden güncel tutar. */
  ingestPrice(id: string, price: number): void {
    if (!this.ids.has(id)) return;
    const prev = this.quotes.get(id);
    if (prev && prev.price === price) return;
    this.push(makeQuote(id, price, prev?.prevClose ?? null, Date.now()));
  }

  private async pollOanda(): Promise<void> {
    const tickers = [...this.ids]
      .map(parseId)
      .filter((p) => p?.source === 'OANDA')
      .map((p) => p!.ticker);
    try {
      (await oandaQuotes(tickers)).forEach((q) => this.push(q));
    } catch {
      /* OANDA bağlı değil ya da geçici hata */
    }
  }

  private async pollYahoo(ids: string[]): Promise<void> {
    await Promise.all(
      ids.map(async (id) => {
        const p = parseId(id);
        if (!p) return;
        try {
          const { quote } = await yahooQuote(p.ticker);
          if (quote) this.push(quote);
        } catch {
          /* tek sembolün hatası diğerlerini durdurmasın */
        }
      }),
    );
  }

  private push(q: Quote): void {
    if (!this.ids.has(q.id)) return;
    const prev = this.quotes.get(q.id);
    this.quotes.set(q.id, q);
    if (prev && prev.price === q.price && prev.prevClose === q.prevClose) return;
    this.listeners.forEach((fn) => fn(q));
  }
}
