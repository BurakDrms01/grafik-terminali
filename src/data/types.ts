/**
 * BINANCEF: Binance vadesiz (perpetual) piyasası: altın, gümüş, petrol gibi emtialar 7/24.
 * OANDA: forex/CFD fiyatları (TradingView'daki OANDA:XAUUSD gibi); kullanıcının API anahtarıyla sunucu üzerinden.
 */
export type Source = 'BINANCE' | 'BINANCEF' | 'OANDA' | 'YAHOO';

/** Binance'ten (spot ya da vadesiz) gelen, anlık akışı olan kaynak mı */
export function isBinance(source: Source): boolean {
  return source === 'BINANCE' || source === 'BINANCEF';
}

/** Uygulamadaki her sembolün tekil kimliği: "BINANCE:BTCUSDT" ya da "YAHOO:THYAO.IS". */
export interface SymbolDef {
  id: string;
  source: Source;
  ticker: string;
  name: string;
  exchange: string;
  type: string;
}

/** Tek bir mum. timestamp milisaniye (UTC). */
export interface Bar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  id: string;
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  time: number;
  /** Biliniyorsa fiyatın ondalık basamağı */
  precision?: number;
}

export function makeId(source: Source, ticker: string): string {
  return `${source}:${ticker}`;
}

export function parseId(id: string): { source: Source; ticker: string } | null {
  const i = id.indexOf(':');
  if (i < 0) return null;
  const source = id.slice(0, i);
  const ticker = id.slice(i + 1);
  if ((source !== 'BINANCE' && source !== 'BINANCEF' && source !== 'OANDA' && source !== 'YAHOO') || ticker.length === 0) return null;
  return { source, ticker };
}

export function makeQuote(
  id: string,
  price: number,
  prevClose: number | null,
  time: number,
  precision?: number,
): Quote {
  const change = prevClose !== null && prevClose !== 0 ? price - prevClose : null;
  const changePct = change !== null && prevClose ? (change / prevClose) * 100 : null;
  return { id, price, prevClose, change, changePct, time, precision };
}
