// Fibonacci seviyeleri: ayarlar ve fiyat hesabı (normal ve logaritmik).

export interface FibLevel {
  value: number;
  color: string;
  show: boolean;
}

export interface FibSettings {
  levels: FibLevel[];
  /** Seviyeleri logaritmik ölçeğe göre hesapla (yüzdesel/geometrik). */
  log: boolean;
  extendLeft: boolean;
  extendRight: boolean;
  showPrices: boolean;
  showLevels: boolean;
  /** Seviye etiketi: 0,618 ya da %61,8 */
  levelsAsPercent: boolean;
  labelSide: 'left' | 'right';
  background: boolean;
  /** Arka plan saydamlığı 0–1 */
  backgroundOpacity: number;
  trendLine: boolean;
  reverse: boolean;
}

const L = (value: number, color: string, show = true): FibLevel => ({ value, color, show });

export const DEFAULT_RETRACEMENT_LEVELS: FibLevel[] = [
  L(0, '#8f8a7f'),
  L(0.236, '#e0614f'),
  L(0.382, '#e58a3a'),
  L(0.5, '#4cb38a'),
  L(0.618, '#2fa59a'),
  L(0.786, '#5ba4c9'),
  L(1, '#8f8a7f'),
  L(1.272, '#b48ade', false),
  L(1.414, '#d97757', false),
  L(1.618, '#5b7fd9'),
  L(2, '#e0614f', false),
  L(2.272, '#e58a3a', false),
  L(2.414, '#4cb38a', false),
  L(2.618, '#e0614f'),
  L(3, '#5ba4c9', false),
  L(3.618, '#b48ade'),
  L(4.236, '#d9579a'),
  L(4.618, '#e9b44c', false),
];

export const DEFAULT_EXTENSION_LEVELS: FibLevel[] = [
  L(0, '#8f8a7f'),
  L(0.236, '#e0614f'),
  L(0.382, '#e58a3a'),
  L(0.5, '#4cb38a'),
  L(0.618, '#2fa59a'),
  L(0.786, '#5ba4c9'),
  L(1, '#8f8a7f'),
  L(1.272, '#b48ade', false),
  L(1.414, '#d97757', false),
  L(1.618, '#5b7fd9'),
  L(2, '#e0614f', false),
  L(2.618, '#e0614f'),
  L(3.618, '#b48ade', false),
  L(4.236, '#d9579a', false),
];

export function defaultFibSettings(kind: 'retracement' | 'extension'): FibSettings {
  return {
    levels: (kind === 'retracement' ? DEFAULT_RETRACEMENT_LEVELS : DEFAULT_EXTENSION_LEVELS).map((l) => ({ ...l })),
    log: false,
    extendLeft: false,
    extendRight: false,
    showPrices: true,
    showLevels: true,
    levelsAsPercent: false,
    labelSide: 'left',
    background: true,
    backgroundOpacity: 0.08,
    trendLine: true,
    reverse: false,
  };
}

/** Eksik alanları varsayılanlarla tamamlar (eski kayıtlar ve elle bozulmuş veri için). */
export function normalizeFibSettings(raw: unknown, kind: 'retracement' | 'extension'): FibSettings {
  const d = defaultFibSettings(kind);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<FibSettings>;
  const levels = Array.isArray(r.levels)
    ? r.levels
        .filter((l) => l && Number.isFinite(l.value))
        .map((l) => ({ value: Number(l.value), color: String(l.color || '#8f8a7f'), show: l.show !== false }))
    : d.levels;
  return { ...d, ...r, levels };
}

/**
 * Düzeltme seviyesi fiyatı. TradingView'daki gibi 0 seviyesi bitiş noktasında (end),
 * 1 seviyesi başlangıçta (start). log: seviyeler fiyatların logaritmasına göre (geometrik).
 */
export function retracementPrice(start: number, end: number, level: number, log: boolean): number {
  if (log && start > 0 && end > 0) return Math.exp(Math.log(end) + (Math.log(start) - Math.log(end)) * level);
  return end + (start - end) * level;
}

/** Trend tabanlı uzantı: A→B hareketi C noktasından seviye oranında yansıtılır. */
export function extensionPrice(a: number, b: number, c: number, level: number, log: boolean): number {
  if (log && a > 0 && b > 0 && c > 0) return c * Math.pow(b / a, level);
  return c + (b - a) * level;
}

export const FIB_TIME_SEQUENCE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
