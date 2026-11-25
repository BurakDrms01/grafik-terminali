// KLineChart ile veri kaynakları arasındaki köprü: ilk yükleme, sola kaydırınca eski veri,
// istenen dilime birleştirme ve canlı güncelleme.
import type {
  DataLoader,
  DataLoaderGetBarsParams,
  DataLoaderSubscribeBarParams,
  KLineData,
  Period,
  SymbolInfo,
} from 'klinecharts';
import { aggregate, mergeBars, type DayStart } from './aggregate.ts';
import {
  binanceKlines,
  binanceSymbolMeta,
  KLINE_LIMIT,
  openStream,
  wsKlineToBar,
} from './binance.ts';
import {
  binanceIntervalString,
  chooseBase,
  intervalLongLabel,
  isTimeUnit,
  spanSeconds,
  type Interval,
} from './intervals.ts';
import { heikinAshi } from './heikin.ts';
import { addRegularSessions, extendedHours, isOvernightSession, type RegularSessions } from './session.ts';
import { localDay } from './tz.ts';
import { isBinance, type Bar, type Source, type SymbolDef } from './types.ts';
import { normalizeBars } from './yahooParse.ts';
import { yahooHistory, yahooMeta, yahooRecent } from './yahoo.ts';

/** Grafiğe verilen sembol bilgisi. ticker = uygulama kimliği ("BINANCE:BTCUSDT"). */
export interface ChartSymbol extends SymbolInfo {
  ticker: string;
  pricePrecision: number;
  volumePrecision: number;
  source: Source;
  rawTicker: string;
  name: string;
  exchange: string;
  timeZone: string;
  /** Ön/son piyasa verisi var mı (ABD hisseleri) */
  hasPrePost: boolean;
}

export interface FeedEvents {
  onLoading(loading: boolean): void;
  onError(message: string): void;
  /** Açık grafiğin son fiyatı (izleme listesi ve alarmlar için). */
  onPrice(symbolId: string, price: number): void;
  /** ABD gece seansındaki son fiyat; gece seansı değilse ya da bilinmiyorsa null. */
  onOvernightPrice(price: number | null): void;
}

interface Session {
  symbol: ChartSymbol;
  target: Interval;
  base: Interval;
  dayStart: DayStart;
  baseBars: Bar[];
  oldest: number | null;
  newest: number | null;
  exhausted: boolean;
  stop: (() => void) | null;
  /** Ön/son piyasa mumları yüklendi mi */
  extended: boolean;
  /** Günlerin normal seans pencereleri (uzatılmış seansta gölgelendirme için) */
  regular: RegularSessions;
}

/** Grafikte ön/son piyasa mumlarını ayırt etmek için gereken bilgi. */
export interface SessionShading {
  timeZone: string;
  regular: RegularSessions;
  /** Grafikteki mumun süresi (ms) */
  spanMs: number;
}

const TARGET_BARS = 600;
const MAX_PAGES = 10;
const YAHOO_LIVE_MS = 30000;
/** Canlı güncellemede yeniden birleştirilecek kuyruk (en büyük kova: 1439 adet 1dk mum). */
const TAIL_MARGIN = 1500;

export function intervalToPeriod(i: Interval): Period {
  return { type: i.unit, span: i.span };
}

export function periodToInterval(p: Period): Interval {
  if (p.type === 'year') return { unit: 'month', span: p.span * 12 };
  return { unit: p.type, span: p.span };
}

/** Sembol için ondalık basamak, saat dilimi gibi bilgileri toplar (grafiğe vermeden önce). */
export async function resolveSymbol(def: SymbolDef): Promise<ChartSymbol> {
  if (isBinance(def.source)) {
    const m = await binanceSymbolMeta(def.ticker, def.source === 'BINANCEF');
    return {
      ticker: def.id,
      pricePrecision: m.pricePrecision,
      volumePrecision: m.volumePrecision,
      source: def.source,
      rawTicker: def.ticker,
      name: def.name || `${m.baseAsset} / ${m.quoteAsset}`,
      exchange: def.exchange || 'Binance',
      timeZone: 'UTC',
      hasPrePost: false,
    };
  }
  const m = await yahooMeta(def.ticker);
  return {
    ticker: def.id,
    pricePrecision: Math.max(0, Math.min(8, m.priceHint)),
    volumePrecision: 0,
    source: 'YAHOO',
    rawTicker: def.ticker,
    name: def.name && def.name !== def.ticker ? def.name : m.name,
    exchange: def.exchange || m.exchangeName,
    timeZone: m.timezone,
    hasPrePost: m.hasPrePost,
  };
}

function bucketFactor(target: Interval, base: Interval): number {
  if (isTimeUnit(target.unit) && isTimeUnit(base.unit)) return spanSeconds(target) / spanSeconds(base);
  if (target.unit === base.unit) return target.span / base.span;
  return 1;
}

function pagesFor(target: Interval, base: Interval): number {
  const f = bucketFactor(target, base);
  if (f <= 1) return 1;
  return Math.max(1, Math.min(MAX_PAGES, Math.ceil((TARGET_BARS * f) / KLINE_LIMIT)));
}

function lowerBound(bars: Bar[], ts: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].timestamp < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Mum biçimi: normal ya da Heikin Ashi (veri dönüşümü gerektirir). */
export type BarStyle = 'normal' | 'heikin';

interface ReplayState {
  bars: Bar[];
  index: number;
  lastOut: Bar | null;
  cb: ((bar: KLineData) => void) | null;
}

/**
 * Bir sembolün verilen dilimdeki mumlarını grafikten bağımsız yükler (sembol karşılaştırma için).
 * minStart: Binance'te en az bu zamana kadar geriye sayfa yükle.
 */
export async function loadSeries(def: SymbolDef, target: Interval, minStart?: number): Promise<{ symbol: ChartSymbol; bars: Bar[] }> {
  const symbol = await resolveSymbol(def);
  const base = chooseBase(target, symbol.source);
  if (!base) throw new Error(`${intervalLongLabel(target)} bu sembolde yok.`);
  let baseBars: Bar[] = [];
  if (symbol.source === 'YAHOO') {
    baseBars = (await yahooHistory(symbol.rawTicker, base, symbol.timeZone, symbol.hasPrePost && extendedHours())).bars;
  } else {
    let end: number | undefined;
    const pages = Math.max(pagesFor(target, base), 1);
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await binanceKlines(symbol.rawTicker, base, { endTime: end, futures: symbol.source === 'BINANCEF' });
      baseBars = page.concat(baseBars);
      if (page.length < KLINE_LIMIT) break;
      const enough = minStart !== undefined ? page[0].timestamp <= minStart : i + 1 >= pages;
      if (enough) break;
      end = page[0].timestamp - 1;
    }
  }
  const bars = aggregate(baseBars, {
    target,
    base,
    timeZone: symbol.timeZone,
    dayStart: isBinance(symbol.source) ? 'midnight' : 'firstBar',
  });
  return { symbol, bars };
}

export class ChartFeed {
  private session: Session | null = null;
  private style: BarStyle = 'normal';
  private replay: ReplayState | null = null;
  private current: (() => { symbol: SymbolInfo | null; period: Period | null }) | null = null;

  constructor(private readonly events: FeedEvents) {}

  /** Grafiğin şu anki sembol/dilimini okuyan fonksiyon (eski isteklerin sonuçlarını atmak için). */
  attach(getCurrent: () => { symbol: SymbolInfo | null; period: Period | null }): void {
    this.current = getCurrent;
  }

  readonly loader: DataLoader = {
    getBars: (p) => this.getBars(p),
    subscribeBar: (p) => this.subscribe(p),
    unsubscribeBar: () => this.unsubscribe(),
  };

  /** Mum biçimini değiştirir; çağıran grafiği resetData() ile yeniden yüklemeli. */
  setBarStyle(style: BarStyle): void {
    this.style = style;
  }

  private out(bars: Bar[], prev?: Bar): Bar[] {
    return this.style === 'heikin' ? heikinAshi(bars, prev) : bars;
  }

  /** Grafikte görünen mumların dönüştürülmemiş (gerçek) hâli. */
  currentBars(): Bar[] {
    const s = this.session;
    if (!s) return [];
    const from = s.oldest ?? -Infinity;
    return this.aggregateSession(s, s.baseBars).filter((b) => b.timestamp >= from);
  }

  /** Ön/son piyasa mumları gösteriliyorsa gölgelendirme bilgisi; değilse null. */
  sessionShading(): SessionShading | null {
    const s = this.session;
    if (!s || !s.extended || !isTimeUnit(s.target.unit)) return null;
    return { timeZone: s.symbol.timeZone, regular: s.regular, spanMs: spanSeconds(s.target) * 1000 };
  }

  private emitOvernight(s: Session, price: number | null): void {
    if (this.session !== s) return;
    const on = s.symbol.hasPrePost && !this.replay && price !== null && isOvernightSession(Date.now());
    this.events.onOvernightPrice(on ? price : null);
  }

  /** Açık grafiğin gerçek son fiyatı (Heikin Ashi'de de gerçek kapanış). */
  lastClose(): number | null {
    const b = this.session?.baseBars;
    return b && b.length > 0 ? b[b.length - 1].close : null;
  }

  // ---------- Bar replay ----------

  get replaying(): boolean {
    return this.replay !== null;
  }

  /** Tekrar oynatmayı başlatır: index'e kadar olan mumlar gösterilir. Çağıran resetData() yapmalı. */
  startReplay(bars: Bar[], index: number): void {
    this.session?.stop?.();
    this.events.onOvernightPrice(null);
    this.replay = { bars, index: Math.max(0, Math.min(index, bars.length - 1)), lastOut: null, cb: null };
  }

  /** Bir sonraki mumu gösterir; sona gelindiyse false. */
  replayStep(): boolean {
    const r = this.replay;
    if (!r || r.index >= r.bars.length - 1) return false;
    r.index++;
    const raw = r.bars[r.index];
    const next = this.style === 'heikin' ? heikinAshi([raw], r.lastOut ?? undefined)[0] : raw;
    r.lastOut = next;
    r.cb?.(next as KLineData);
    return true;
  }

  replayPosition(): { index: number; total: number; timestamp: number } | null {
    const r = this.replay;
    if (!r) return null;
    return { index: r.index, total: r.bars.length, timestamp: r.bars[r.index]?.timestamp ?? 0 };
  }

  /** Tekrar oynatmadan çıkar; çağıran resetData() ile canlı veriye dönmeli. */
  stopReplay(): void {
    this.replay = null;
  }

  private isCurrent(symbol: SymbolInfo, period: Period): boolean {
    const c = this.current?.();
    return !!c && c.symbol === symbol && c.period === period;
  }

  private aggregateSession(s: Session, bars: Bar[]): Bar[] {
    return aggregate(bars, {
      target: s.target,
      base: s.base,
      timeZone: s.symbol.timeZone,
      dayStart: s.dayStart,
    });
  }

  private async loadBinancePages(
    s: Session,
    endTime: number | undefined,
  ): Promise<{ bars: Bar[]; exhausted: boolean }> {
    let all: Bar[] = [];
    let end = endTime;
    let exhausted = false;
    const pages = pagesFor(s.target, s.base);
    for (let i = 0; i < pages && this.session === s; i++) {
      const page = await binanceKlines(s.symbol.rawTicker, s.base, { endTime: end, futures: s.symbol.source === 'BINANCEF' });
      all = page.concat(all);
      if (page.length < KLINE_LIMIT) {
        exhausted = true;
        break;
      }
      end = page[0].timestamp - 1;
    }
    return { bars: all, exhausted };
  }

  private async getBars(p: DataLoaderGetBarsParams): Promise<void> {
    // setSymbol + setPeriod art arda çağrılınca ilk istek eskir; bir mikro görev bekleyip ele.
    await Promise.resolve();
    if (!this.isCurrent(p.symbol, p.period)) return;
    const r = this.replay;
    if (r) {
      if (p.type === 'init') {
        const shown = this.out(r.bars.slice(0, r.index + 1));
        r.lastOut = shown[shown.length - 1] ?? null;
        p.callback(shown as KLineData[], { forward: false, backward: false });
      } else {
        p.callback([], { forward: false, backward: false });
      }
      return;
    }
    if (p.type === 'init') return this.loadInit(p);
    if (p.type === 'forward') return this.loadOlder(p);
    p.callback([], { backward: false });
  }

  private async loadInit(p: DataLoaderGetBarsParams): Promise<void> {
    const symbol = p.symbol as ChartSymbol;
    const target = periodToInterval(p.period);
    const base = chooseBase(target, symbol.source);
    if (!base) {
      this.session = null;
      this.events.onError(`${intervalLongLabel(target)} grafiği bu sembolde yok (saniye verisi yalnızca kriptoda var).`);
      p.callback([], false);
      return;
    }
    const s: Session = {
      symbol,
      target,
      base,
      dayStart: isBinance(symbol.source) ? 'midnight' : 'firstBar',
      baseBars: [],
      oldest: null,
      newest: null,
      exhausted: false,
      stop: null,
      extended: symbol.source === 'YAHOO' && symbol.hasPrePost && extendedHours() && isTimeUnit(base.unit),
      regular: new Map(),
    };
    this.session = s;
    this.events.onOvernightPrice(null);
    this.events.onLoading(true);
    try {
      if (symbol.source === 'YAHOO') {
        const chart = await yahooHistory(symbol.rawTicker, base, symbol.timeZone, s.extended);
        s.baseBars = chart.bars;
        if (chart.regular) addRegularSessions(s.regular, chart.regular, symbol.timeZone);
        this.emitOvernight(s, chart.meta.fullDayPrice);
        s.exhausted = true;
      } else {
        const r = await this.loadBinancePages(s, undefined);
        s.baseBars = r.bars;
        s.exhausted = r.exhausted;
      }
      if (this.session !== s || !this.isCurrent(p.symbol, p.period)) return;

      let bars = this.aggregateSession(s, s.baseBars);
      // Daha eski veri varsa ilk kova eksik olabilir: göstermeyip sonraki yüklemede tamamla.
      if (!s.exhausted && bars.length > 1) bars = bars.slice(1);
      s.oldest = bars[0]?.timestamp ?? null;
      s.newest = bars[bars.length - 1]?.timestamp ?? null;
      if (bars.length === 0) this.events.onError('Bu dilimde veri bulunamadı.');
      p.callback(this.out(bars) as KLineData[], { forward: !s.exhausted, backward: false });
      const last = bars[bars.length - 1];
      if (last) this.events.onPrice(symbol.ticker, last.close);
    } catch (e) {
      if (this.session === s && this.isCurrent(p.symbol, p.period)) {
        this.events.onError(errorText(e));
        p.callback([], false);
      }
    } finally {
      if (this.session === s) this.events.onLoading(false);
    }
  }

  private async loadOlder(p: DataLoaderGetBarsParams): Promise<void> {
    const s = this.session;
    if (!s || s.exhausted || s.baseBars.length === 0 || s.symbol !== p.symbol) {
      p.callback([], { forward: false });
      return;
    }
    try {
      const r = await this.loadBinancePages(s, s.baseBars[0].timestamp - 1);
      if (this.session !== s || !this.isCurrent(p.symbol, p.period)) return;
      s.baseBars = r.bars.concat(s.baseBars);
      s.exhausted = r.exhausted;
      const oldest = s.oldest;
      let older = this.aggregateSession(s, s.baseBars).filter((b) => oldest === null || b.timestamp < oldest);
      if (!s.exhausted) older = older.slice(1);
      if (older.length > 0) s.oldest = older[0].timestamp;
      p.callback(this.out(older) as KLineData[], { forward: !s.exhausted });
    } catch (e) {
      if (this.session === s && this.isCurrent(p.symbol, p.period)) {
        this.events.onError(errorText(e));
        p.callback([], { forward: false });
      }
    }
  }

  private subscribe(p: DataLoaderSubscribeBarParams): void {
    if (this.replay) {
      // Tekrar oynatmada canlı veri yok: mumlar replayStep() ile tek tek gelir.
      this.replay.cb = p.callback;
      return;
    }
    const s = this.session;
    if (!s || s.symbol !== p.symbol || !this.isCurrent(p.symbol, p.period)) return;
    s.stop?.();

    const push = (incoming: Bar[]) => {
      if (this.session !== s || incoming.length === 0) return;
      let bars = incoming;
      if (s.symbol.source === 'YAHOO') {
        // "Şu an" satırı yeni günün ilk satırıysa önceki mumla birlikte hizala.
        const i = lowerBound(s.baseBars, incoming[0].timestamp);
        const ctx = i > 0 ? [s.baseBars[i - 1]] : [];
        bars = normalizeBars([...ctx, ...incoming], s.base, s.symbol.timeZone, s.extended);
      }
      const earliest = mergeBars(s.baseBars, bars);
      if (earliest === null) return;

      let idx = Math.max(0, lowerBound(s.baseBars, earliest) - TAIL_MARGIN);
      if (idx > 0) {
        const day = localDay(s.baseBars[idx].timestamp, s.symbol.timeZone);
        while (idx > 0 && localDay(s.baseBars[idx - 1].timestamp, s.symbol.timeZone) === day) idx--;
      }
      // Heikin Ashi zincirleme hesaplandığı için tüm seriden üretilir; normalde yalnızca kuyruk yeter.
      const agg =
        this.style === 'heikin'
          ? heikinAshi(this.aggregateSession(s, s.baseBars).filter((b) => b.timestamp >= (s.oldest ?? -Infinity)))
          : this.aggregateSession(s, s.baseBars.slice(idx));
      const from = s.newest ?? -Infinity;
      for (const b of agg) {
        if (b.timestamp >= from) {
          p.callback(b as KLineData);
          s.newest = b.timestamp;
        }
      }
      const lastBase = s.baseBars[s.baseBars.length - 1];
      if (lastBase) this.events.onPrice(s.symbol.ticker, lastBase.close);
    };

    if (isBinance(s.symbol.source)) {
      const ticker = s.symbol.rawTicker;
      const futures = s.symbol.source === 'BINANCEF';
      s.stop = openStream(
        `/ws/${ticker.toLowerCase()}@kline_${binanceIntervalString(s.base)}`,
        (msg) => {
          const b = wsKlineToBar(msg);
          if (b) push([b]);
        },
        () => {
          // Bağlantı koptuysa aradaki mumları doldur.
          binanceKlines(ticker, s.base, { limit: 200, futures }).then(push).catch(() => {});
        },
        futures,
      );
    } else {
      const tick = () => {
        yahooRecent(s.symbol.rawTicker, s.base, s.extended)
          .then((c) => {
            if (c.regular) addRegularSessions(s.regular, c.regular, s.symbol.timeZone);
            this.emitOvernight(s, c.meta.fullDayPrice);
            push(c.bars);
          })
          .catch(() => {});
      };
      const timer = setInterval(tick, YAHOO_LIVE_MS);
      s.stop = () => clearInterval(timer);
    }
  }

  private unsubscribe(): void {
    if (this.replay) this.replay.cb = null;
    this.session?.stop?.();
    if (this.session) this.session.stop = null;
  }
}
