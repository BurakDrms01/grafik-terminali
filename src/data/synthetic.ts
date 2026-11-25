// Hesaplanan semboller: gram altın, gram gümüş, ons/TL. İki Yahoo serisinin çarpımından üretilir
// (TradingView'daki "GC1!*USDTRY/31.1035" gibi formüllerin karşılığı).
import type { Bar } from './types.ts';

/** 1 troy ons = 31,1034768 gram */
export const TROY_OUNCE_GRAMS = 31.1034768;

export interface SyntheticDef {
  ticker: string;
  name: string;
  /** Formül: a × b × factor */
  a: string;
  b: string;
  factor: number;
  priceHint: number;
}

export const SYNTHETICS: Record<string, SyntheticDef> = {
  GRAMALTIN: {
    ticker: 'GRAMALTIN',
    name: 'Gram altın (TL) · ons altın × dolar/TL ÷ 31,1035',
    a: 'GC=F',
    b: 'USDTRY=X',
    factor: 1 / TROY_OUNCE_GRAMS,
    priceHint: 2,
  },
  GRAMGUMUS: {
    ticker: 'GRAMGUMUS',
    name: 'Gram gümüş (TL) · ons gümüş × dolar/TL ÷ 31,1035',
    a: 'SI=F',
    b: 'USDTRY=X',
    factor: 1 / TROY_OUNCE_GRAMS,
    priceHint: 2,
  },
  XAUTRY: {
    ticker: 'XAUTRY',
    name: 'Ons altın (TL) · ons altın × dolar/TL',
    a: 'GC=F',
    b: 'USDTRY=X',
    factor: 1,
    priceHint: 0,
  },
  XAGTRY: {
    ticker: 'XAGTRY',
    name: 'Ons gümüş (TL) · ons gümüş × dolar/TL',
    a: 'SI=F',
    b: 'USDTRY=X',
    factor: 1,
    priceHint: 2,
  },
};

export function syntheticOf(ticker: string): SyntheticDef | undefined {
  return SYNTHETICS[ticker];
}

/**
 * İki seriyi zamana göre eşleyip çarpar. b'de aynı zamanda mum varsa onun açılış/yüksek/düşük/kapanışı,
 * yoksa son bilinen kapanışı kullanılır. b'nin hiç değeri olmayan baştaki mumlar atlanır.
 */
export function combineBars(a: Bar[], b: Bar[], factor: number): Bar[] {
  const out: Bar[] = [];
  let j = 0;
  let last: Bar | null = null;
  for (const x of a) {
    while (j < b.length && b[j].timestamp <= x.timestamp) last = b[j++];
    if (!last) continue;
    const same = last.timestamp === x.timestamp;
    const bo = same ? last.open : last.close;
    const bh = same ? last.high : last.close;
    const bl = same ? last.low : last.close;
    const bc = last.close;
    const open = x.open * bo * factor;
    const close = x.close * bc * factor;
    out.push({
      timestamp: x.timestamp,
      open,
      close,
      high: Math.max(x.high * bh * factor, open, close),
      low: Math.min(x.low * bl * factor, open, close),
      volume: x.volume,
    });
  }
  return out;
}
