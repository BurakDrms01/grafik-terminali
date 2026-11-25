import { syntheticOf } from '../data/synthetic.ts';
import type { SymbolDef } from '../data/types.ts';

const precisions = new Map<string, number>();
const formatters = new Map<number, Intl.NumberFormat>();

export function setPrecision(id: string, precision: number): void {
  precisions.set(id, precision);
}

function guessPrecision(v: number): number {
  const a = Math.abs(v);
  if (a >= 1000) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 6;
  return 8;
}

function nf(p: number): Intl.NumberFormat {
  let f = formatters.get(p);
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: p, maximumFractionDigits: p });
    formatters.set(p, f);
  }
  return f;
}

/** Türkçe biçimli fiyat: 1.234,56 */
export function fmtPrice(v: number, id?: string): string {
  const p = (id !== undefined ? precisions.get(id) : undefined) ?? guessPrecision(v);
  return nf(p).format(v);
}

export function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${nf(2).format(v)}%`;
}

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type Kind = 'bist' | 'crypto' | 'fx' | 'us' | 'commodity';

/** Varlık türü: izleme listesindeki renkli nokta için. */
export function kindOf(def: Pick<SymbolDef, 'ticker' | 'source'>): Kind {
  if (def.source === 'YAHOO' && syntheticOf(def.ticker)) return 'commodity';
  if (def.source === 'BINANCEF') return 'commodity';
  if (def.source === 'BINANCE' || /-(USD|EUR|TRY)$/.test(def.ticker)) return 'crypto';
  if (def.ticker.endsWith('.IS')) return 'bist';
  if (def.ticker.endsWith('=X')) return 'fx';
  if (def.ticker.endsWith('=F')) return 'commodity';
  return 'us';
}

export const KIND_LABEL: Record<Kind, string> = {
  bist: 'Borsa İstanbul',
  crypto: 'Kripto',
  fx: 'Döviz',
  us: 'Yurt dışı borsa / endeks',
  commodity: 'Emtia',
};

/** Kısa gösterim: "THYAO.IS" → "THYAO", "USDTRY=X" → "USDTRY", "GC=F" → "GC". */
export function displayTicker(def: Pick<SymbolDef, 'ticker' | 'source'>): string {
  // Binance vadesiz sözleşmeler TradingView'daki gibi ".P" ile: "XAGUSDT.P"
  if (def.source === 'BINANCEF') return `${def.ticker}.P`;
  if (def.source !== 'YAHOO') return def.ticker;
  if (def.ticker === 'DX-Y.NYB') return 'DXY';
  return def.ticker.replace(/^\^/, '').replace(/\.IS$/, '').replace(/=X$/, '').replace(/=F$/, '');
}

/**
 * Fiyat girişi: "62.000,5", "62000,5", "62000.5" → 62000.5.
 * "62.000" gibi belirsiz yazımda (binlik mi ondalık mı?) güncel fiyata yakın olan yorum seçilir.
 */
export function parsePriceInput(text: string, reference?: number): number | null {
  const s = text.trim().replace(/\s/g, '');
  if (!s) return null;
  const valid = (n: number) => Number.isFinite(n) && n > 0;
  if (s.includes(',')) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return valid(n) ? n : null;
  }
  const asDecimal = Number(s);
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    const asThousands = Number(s.replace(/\./g, ''));
    if (reference && reference > 0) {
      const dist = (n: number) => Math.abs(Math.log(n / reference));
      return dist(asThousands) < dist(asDecimal) ? asThousands : asDecimal;
    }
    return asThousands;
  }
  return valid(asDecimal) ? asDecimal : null;
}
