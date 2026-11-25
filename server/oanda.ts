// OANDA fiyatları: TradingView'daki OANDA:XAUUSD, OANDA:EURUSD, OANDA:NAS100USD gibi spot/CFD fiyatlar.
// Kullanıcının kişisel API anahtarı (ücretsiz demo hesaptan) yalnızca sunucudaki veri klasöründe durur;
// API yanıtlarında ve loglarda asla yer almaz. Tarayıcı mumları ve fiyatları bu sunucu üzerinden alır.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseCandles, parseInstruments, prevCloseOf, type CompactBar, type OandaInstrument } from '../src/data/oandaLogic.ts';
import { readJsonFile, writeJsonFile } from './store.ts';

// GT_OANDA_HOST: yalnızca test için yerel sahte OANDA sunucusu.
const TEST_HOST = process.env.GT_OANDA_HOST;
const HOSTS = {
  practice: TEST_HOST || 'https://api-fxpractice.oanda.com',
  live: TEST_HOST || 'https://api-fxtrade.oanda.com',
};
type Env = keyof typeof HOSTS;

interface OandaConfig {
  token: string;
  env: Env;
  accountId: string;
}

export interface OandaStatus {
  configured: boolean;
  /** practice: demo hesap, live: gerçek hesap */
  env?: Env;
}

export interface OandaQuote {
  instrument: string;
  price: number;
  prevClose: number | null;
  time: number;
}

const TOKEN_RE = /^[A-Za-z0-9-]{20,200}$/;
const INSTRUMENT_RE = /^[A-Z0-9]{2,12}_[A-Z0-9]{2,12}$/;
const GRANULARITIES = new Set(['S5', 'S10', 'S15', 'S30', 'M1', 'M2', 'M4', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H3', 'H4', 'H6', 'H8', 'H12', 'D', 'W', 'M']);
export const OANDA_MAX_COUNT = 5000;
const INSTRUMENTS_TTL = 6 * 3600_000;
const PREV_CLOSE_TTL = 15 * 60_000;

function checkInstrument(name: string): void {
  if (!INSTRUMENT_RE.test(name)) throw new Error('Geçersiz OANDA sembolü');
}

export class Oanda {
  private readonly file: string;
  private cfg: OandaConfig | null;
  private instrumentsCache: { at: number; list: OandaInstrument[] } | null = null;
  private readonly prevClose = new Map<string, { at: number; value: number | null }>();

  constructor(dir: string) {
    this.file = join(dir, 'oanda.json');
    this.cfg = readJsonFile<OandaConfig | null>(this.file, null);
  }

  get configured(): boolean {
    return this.cfg !== null;
  }

  status(): OandaStatus {
    return this.cfg ? { configured: true, env: this.cfg.env } : { configured: false };
  }

  /** Hata metinlerinde anahtar geçerse gizler. */
  sanitize(text: string): string {
    const t = this.cfg?.token;
    return t ? text.split(t).join('***') : text;
  }

  private async request(path: string, cfg: OandaConfig | null = this.cfg): Promise<unknown> {
    if (!cfg) throw new Error('OANDA bağlı değil. Sembol aramasındaki "OANDA" düğmesinden anahtarını ekle.');
    let res: Response;
    try {
      res = await fetch(HOSTS[cfg.env] + path, {
        headers: { Authorization: `Bearer ${cfg.token}`, 'Accept-Datetime-Format': 'UNIX' },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("OANDA'ya ulaşılamadı.");
    }
    if (res.status === 401 || res.status === 403) throw new Error('OANDA anahtarı geçersiz ya da iptal edilmiş.');
    if (!res.ok) {
      let msg = `OANDA hatası (${res.status})`;
      try {
        const body = (await res.json()) as { errorMessage?: string };
        if (body.errorMessage) msg = `OANDA: ${body.errorMessage}`;
      } catch {
        /* gövde JSON değil */
      }
      throw new Error(msg);
    }
    return res.json();
  }

  /** Anahtarı doğrular (demo, olmazsa gerçek hesap sunucusunda) ve kaydeder. */
  async configure(token: string): Promise<OandaStatus> {
    if (!TOKEN_RE.test(token)) throw new Error('Bu bir OANDA API anahtarına benzemiyor. Anahtarın tamamını kopyaladığından emin ol.');
    let lastError: unknown = null;
    for (const env of ['practice', 'live'] as const) {
      try {
        const j = (await this.request('/v3/accounts', { token, env, accountId: '' })) as { accounts?: { id?: string }[] };
        const accountId = j.accounts?.[0]?.id;
        if (!accountId) throw new Error('Bu anahtara bağlı bir OANDA hesabı bulunamadı.');
        this.cfg = { token, env, accountId };
        writeJsonFile(this.file, this.cfg);
        this.instrumentsCache = null;
        this.prevClose.clear();
        return this.status();
      } catch (e) {
        lastError = e;
      }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(msg.split(token).join('***'));
  }

  remove(): void {
    this.cfg = null;
    this.instrumentsCache = null;
    this.prevClose.clear();
    rmSync(this.file, { force: true });
  }

  /** Hesabın işlem görebildiği tüm araçlar (forex, metal, endeks, emtia). */
  async instruments(): Promise<OandaInstrument[]> {
    const c = this.instrumentsCache;
    if (c && Date.now() - c.at < INSTRUMENTS_TTL) return c.list;
    const cfg = this.cfg;
    const raw = await this.request(`/v3/accounts/${encodeURIComponent(cfg?.accountId ?? '')}/instruments`);
    const list = parseInstruments(raw);
    this.instrumentsCache = { at: Date.now(), list };
    return list;
  }

  /**
   * Mumlar (alış fiyatı, TradingView'daki gibi). to verilirse o andan (dahil değil) önceki count mum.
   * Günlük mumlar New York 17:00'de, haftalıklar pazartesi başlar.
   */
  async candles(instrument: string, granularity: string, count: number, to?: number): Promise<CompactBar[]> {
    checkInstrument(instrument);
    if (!GRANULARITIES.has(granularity)) throw new Error('Geçersiz mum dilimi');
    const params = new URLSearchParams({
      price: 'B',
      granularity,
      count: String(Math.max(1, Math.min(OANDA_MAX_COUNT, Math.floor(count) || 1))),
      dailyAlignment: '17',
      alignmentTimezone: 'America/New_York',
      weeklyAlignment: 'Monday',
    });
    if (to !== undefined && Number.isFinite(to)) params.set('to', ((to - 1) / 1000).toFixed(3));
    return parseCandles(await this.request(`/v3/instruments/${instrument}/candles?${params}`));
  }

  private async prevCloseOf(instrument: string): Promise<number | null> {
    const c = this.prevClose.get(instrument);
    if (c && Date.now() - c.at < PREV_CLOSE_TTL) return c.value;
    const value = prevCloseOf(await this.candles(instrument, 'D', 2));
    this.prevClose.set(instrument, { at: Date.now(), value });
    return value;
  }

  /** Güncel alış fiyatları ve önceki günün kapanışı (izleme listesi ve alarmlar için). */
  async quotes(instruments: string[]): Promise<OandaQuote[]> {
    const list = [...new Set(instruments)].slice(0, 50);
    if (list.length === 0) return [];
    list.forEach(checkInstrument);
    const cfg = this.cfg;
    const raw = (await this.request(
      `/v3/accounts/${encodeURIComponent(cfg?.accountId ?? '')}/pricing?instruments=${list.join(',')}`,
    )) as { prices?: { instrument?: string; time?: string; bids?: { price?: string }[] }[] };
    const out: OandaQuote[] = [];
    for (const p of raw.prices ?? []) {
      const price = Number(p.bids?.[0]?.price);
      if (!p.instrument || !Number.isFinite(price)) continue;
      const prevClose = await this.prevCloseOf(p.instrument).catch(() => null);
      out.push({ instrument: p.instrument, price, prevClose, time: Math.round(Number(p.time) * 1000) || Date.now() });
    }
    return out;
  }

  /** Alarm kontrolü için tek fiyat. */
  async price(instrument: string): Promise<number | null> {
    const [q] = await this.quotes([instrument]);
    return q?.price ?? null;
  }
}
