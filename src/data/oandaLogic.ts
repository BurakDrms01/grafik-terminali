// OANDA verisinin saf kuralları: hem sunucu (server/oanda.ts) hem tarayıcı (src/data/oanda.ts) kullanır.
// OANDA bir forex/CFD aracı kurumudur; TradingView'daki OANDA:XAUUSD, OANDA:NAS100USD gibi fiyatlar buradan gelir.
import { normalizeQuery } from './aliases.ts';

export interface OandaInstrument {
  /** "XAG_USD", "NAS100_USD", "EUR_USD" */
  name: string;
  displayName: string;
  /** CURRENCY | METAL | CFD */
  type: string;
  /** CFD'lerde varlık sınıfı: COMMODITY | INDEX | BOND … */
  assetClass: string;
  precision: number;
}

/** Sıkıştırılmış mum: [zaman (ms), açılış, yüksek, düşük, kapanış, hacim] */
export type CompactBar = [number, number, number, number, number, number];

interface RawOhlc {
  o: string;
  h: string;
  l: string;
  c: string;
}
interface RawCandle {
  time?: string;
  volume?: number;
  bid?: RawOhlc;
  mid?: RawOhlc;
}

/** OANDA mum yanıtı (Accept-Datetime-Format: UNIX) → sıkıştırılmış mumlar, eskiden yeniye. */
export function parseCandles(raw: unknown): CompactBar[] {
  const list = (raw as { candles?: RawCandle[] })?.candles;
  if (!Array.isArray(list)) return [];
  const out: CompactBar[] = [];
  for (const c of list) {
    const p = c.bid ?? c.mid;
    const t = Math.round(Number(c.time) * 1000);
    if (!p || !Number.isFinite(t)) continue;
    const bar: CompactBar = [t, +p.o, +p.h, +p.l, +p.c, c.volume ?? 0];
    if (bar.slice(1, 5).every(Number.isFinite)) out.push(bar);
  }
  return out;
}

/**
 * Önceki günün kapanışı (değişim yüzdesi için): son iki günlük mumdan öncekinin kapanışı.
 * Hafta içi son mum bugünün (sürüyor), hafta sonu cumanın mumudur; ikisinde de doğru gün budur.
 */
export function prevCloseOf(daily: CompactBar[]): number | null {
  return daily.length >= 2 ? daily[daily.length - 2][4] : null;
}

interface RawInstrument {
  name?: string;
  displayName?: string;
  type?: string;
  displayPrecision?: number;
  tags?: { type?: string; name?: string }[];
}

export function parseInstruments(raw: unknown): OandaInstrument[] {
  const list = (raw as { instruments?: RawInstrument[] })?.instruments;
  if (!Array.isArray(list)) return [];
  return list
    .filter((i): i is RawInstrument & { name: string } => typeof i.name === 'string')
    .map((i) => ({
      name: i.name,
      displayName: i.displayName ?? i.name,
      type: i.type ?? '',
      assetClass: i.tags?.find((t) => t.type === 'ASSET_CLASS')?.name ?? '',
      precision: typeof i.displayPrecision === 'number' ? i.displayPrecision : 5,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Uygulamadaki tür adı (arama kategorileri için). */
export function instrumentType(i: Pick<OandaInstrument, 'type' | 'assetClass'>): string {
  if (i.type === 'CURRENCY') return 'Döviz';
  if (i.assetClass === 'CRYPTOCURRENCY') return 'Kripto';
  if (i.type === 'METAL' || i.assetClass === 'COMMODITY') return 'Emtia';
  return 'Endeks';
}

/** Sık kullanılanlar için Türkçe ad; diğerlerinde OANDA'nın adı. */
const TR_NAMES: Record<string, string> = {
  XAU_USD: 'Altın / ABD doları (spot)',
  XAG_USD: 'Gümüş / ABD doları (spot)',
  XPT_USD: 'Platin / ABD doları (spot)',
  XPD_USD: 'Paladyum / ABD doları (spot)',
  XCU_USD: 'Bakır',
  WTICO_USD: 'Ham petrol WTI',
  BCO_USD: 'Brent petrol',
  NATGAS_USD: 'Doğal gaz',
  US30_USD: 'Dow Jones 30',
  SPX500_USD: 'S&P 500',
  NAS100_USD: 'Nasdaq 100',
  US2000_USD: 'Russell 2000',
  DE30_EUR: 'Almanya 40 (DAX)',
  DE40_EUR: 'Almanya 40 (DAX)',
  UK100_GBP: 'İngiltere 100 (FTSE)',
  FR40_EUR: 'Fransa 40 (CAC)',
  JP225_USD: 'Japonya 225 (Nikkei)',
  EU50_EUR: 'Euro Stoxx 50',
  HK33_HKD: 'Hong Kong 33',
  USB10Y_USD: 'ABD 10 yıllık tahvil',
};

export function instrumentName(i: Pick<OandaInstrument, 'name' | 'displayName'>): string {
  return TR_NAMES[i.name] ?? i.displayName;
}

/** TradingView'da ve Türkçede alışılmış adlar → OANDA araç adları (ilk bulunan kullanılır). */
const TV_NAMES: Record<string, string[]> = {};
const tv = (keys: string, names: string) => keys.split(' ').forEach((k) => (TV_NAMES[k] = names.split(' ')));
tv('GOLD ALTIN ONS ONSALTIN XAU', 'XAU_USD');
tv('SILVER GUMUS ONSGUMUS XAG', 'XAG_USD');
tv('PLATINUM PLATIN XPT', 'XPT_USD');
tv('PALLADIUM PALADYUM XPD', 'XPD_USD');
tv('COPPER BAKIR XCUUSD', 'XCU_USD');
tv('USOIL WTI XTIUSD PETROL HAMPETROL CRUDE OIL', 'WTICO_USD');
tv('UKOIL BRENT XBRUSD', 'BCO_USD');
tv('NATGAS NGAS XNGUSD DOGALGAZ', 'NATGAS_USD');
tv('US30 DOW DJI DOWJONES', 'US30_USD');
tv('US500 SPX SPX500 SP500', 'SPX500_USD');
tv('US100 NAS100 NDX USTEC NASDAQ100', 'NAS100_USD');
tv('US2000 RUT RUSSELL2000', 'US2000_USD');
tv('GER40 GER30 DE40 DE30 DAX', 'DE40_EUR DE30_EUR');
tv('UK100 FTSE FTSE100', 'UK100_GBP');
tv('FRA40 CAC CAC40', 'FR40_EUR');
tv('JPN225 JP225 NI225 NIKKEI', 'JP225_USD');
tv('EU50 STOXX50', 'EU50_EUR');
tv('HK50 HK33 HSI', 'HK33_HKD');
tv('AUS200 ASX200', 'AU200_AUD');
tv('CHINA50 CN50', 'CN50_USD');
tv('US10Y', 'USB10Y_USD');

/**
 * Aramaya uyan OANDA araçları: önce tam ad (XAGUSD), sonra TradingView/Türkçe adı (USOIL, gümüş),
 * sonra ilk kısmı (XAG, US30), sonra baştan eşleşen ve adında geçenler. Eşit sırada ABD dolarlılar önce.
 */
export function matchInstruments(list: OandaInstrument[], query: string, limit = 6): OandaInstrument[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const tvNames = TV_NAMES[q] ?? [];
  const scored: { i: OandaInstrument; score: number }[] = [];
  for (const i of list) {
    const compact = i.name.replace(/_/g, '');
    let score: number;
    if (compact === q) score = 0;
    else if (tvNames.includes(i.name)) score = 1;
    else if (i.name.split('_')[0] === q) score = 2;
    else if (q.length >= 3 && compact.startsWith(q)) score = 3;
    else if (q.length >= 4 && normalizeQuery(i.displayName).includes(q)) score = 4;
    else continue;
    scored.push({ i, score: score * 2 + (i.name.endsWith('_USD') ? 0 : 1) });
  }
  scored.sort((a, b) => a.score - b.score || a.i.name.localeCompare(b.i.name));
  return scored.slice(0, limit).map((s) => s.i);
}
