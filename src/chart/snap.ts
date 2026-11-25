// Saf yardımcılar (kütüphaneden bağımsız, testi yapılabilir): piksele oturtma ve mıknatıs seçimi.

/** Zayıf mıknatısın yapışma mesafesi (piksel) */
export const WEAK_MAGNET_PX = 18;

type Coord = { x: number; y: number };
const r = Math.round;

export function snapLines(attrs: unknown): unknown {
  const one = (l: { coordinates?: Coord[] }) =>
    Array.isArray(l?.coordinates) && l.coordinates.length === 2
      ? { ...l, coordinates: l.coordinates.map((c) => ({ x: r(c.x), y: r(c.y) })) }
      : l;
  return Array.isArray(attrs) ? attrs.map(one) : one(attrs as { coordinates?: Coord[] });
}

export function snapRects(attrs: unknown): unknown {
  const one = (a: { x: number; y: number; width: number; height: number }) => {
    if (!a || typeof a.x !== 'number') return a;
    const x0 = r(a.x);
    const y0 = r(a.y);
    let w = r(a.x + a.width) - x0;
    let h = r(a.y + a.height) - y0;
    if (w === 0 && a.width !== 0) w = Math.sign(a.width);
    if (h === 0 && a.height !== 0) h = Math.sign(a.height);
    return { ...a, x: x0, y: y0, width: w, height: h };
  };
  return Array.isArray(attrs) ? attrs.map(one) : one(attrs as never);
}

export function snapPolygons(attrs: unknown): unknown {
  const one = (p: { coordinates?: Coord[] }) =>
    Array.isArray(p?.coordinates) ? { ...p, coordinates: p.coordinates.map((c) => ({ x: r(c.x), y: r(c.y) })) } : p;
  return Array.isArray(attrs) ? attrs.map(one) : one(attrs as { coordinates?: Coord[] });
}

export function snapTexts(attrs: unknown): unknown {
  const one = (t: { x: number; y: number }) => (t && typeof t.x === 'number' ? { ...t, x: r(t.x), y: r(t.y) } : t);
  return Array.isArray(attrs) ? attrs.map(one) : one(attrs as never);
}

/**
 * Mıknatısın yapıştıracağı fiyat: mumun A/Y/D/K değerlerinden imlece (piksel olarak) en yakını.
 * Güçlü mıknatıs her zaman yapıştırır; zayıf yalnızca WEAK_MAGNET_PX kadar yakınsa. Yapışmazsa null.
 */
export function magnetValue(
  k: { open: number; high: number; low: number; close: number },
  y: number,
  toPixel: (v: number) => number,
  strong: boolean,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const v of [k.high, k.low, k.open, k.close]) {
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(toPixel(v) - y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best !== null && (strong || bestD <= WEAK_MAGNET_PX) ? best : null;
}
