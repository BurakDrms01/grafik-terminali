// Heikin Ashi mumları: gürültüyü azaltan ortalama mumlar.
import type { Bar } from './types.ts';

/** Tüm seriyi Heikin Ashi'ye çevirir. prev verilirse ilk mum ona göre hesaplanır. */
export function heikinAshi(bars: Bar[], prev?: Bar): Bar[] {
  const out: Bar[] = [];
  let p = prev;
  for (const b of bars) {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = p ? (p.open + p.close) / 2 : (b.open + b.close) / 2;
    const ha: Bar = {
      ...b,
      open,
      close,
      high: Math.max(b.high, open, close),
      low: Math.min(b.low, open, close),
    };
    out.push(ha);
    p = ha;
  }
  return out;
}
