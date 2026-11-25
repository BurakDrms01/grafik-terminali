import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnetValue, snapLines, snapRects, WEAK_MAGNET_PX } from '../src/chart/snap.ts';

// Fiyat = piksel (ters): 100 → 0 px, 0 → 100 px (grafikte yukarı = küçük y)
const toPixel = (v: number) => 100 - v;
const candle = { open: 40, high: 60, low: 20, close: 50 };

test('Güçlü mıknatıs her zaman en yakın A/Y/D/K değerine yapışır', () => {
  assert.equal(magnetValue(candle, toPixel(95), toPixel, true), 60);
  assert.equal(magnetValue(candle, toPixel(44), toPixel, true), 40);
  assert.equal(magnetValue(candle, toPixel(0), toPixel, true), 20);
});

test('Zayıf mıknatıs yalnızca yakınsa yapışır, gövdenin ortasında zorla yapıştırmaz', () => {
  assert.equal(magnetValue(candle, toPixel(60) - (WEAK_MAGNET_PX - 1), toPixel, false), 60);
  assert.equal(magnetValue(candle, toPixel(60) - (WEAK_MAGNET_PX + 5), toPixel, false), null);
  // Uzun mumda gövde ortası: en yakın değer 20 px'ten uzak → yapışmaz
  const big = { open: 100, high: 150, low: 0, close: 50 };
  assert.equal(magnetValue(big, 300 - 75 * 2, (v) => 300 - v * 2, false), null);
});

test('Yatay çizgi tam piksele oturur (bulanık yarım piksel olmaz)', () => {
  const out = snapLines({ coordinates: [{ x: 0.4, y: 133.42 }, { x: 500.6, y: 133.42 }] }) as { coordinates: { x: number; y: number }[] };
  assert.deepEqual(out.coordinates, [{ x: 0, y: 133 }, { x: 501, y: 133 }]);
});

test('Dikdörtgen kenarları tam piksele oturur, 1 px fitil kaybolmaz', () => {
  assert.deepEqual(snapRects({ x: 10.4, y: 20.6, width: 1, height: 30.2 }), { x: 10, y: 21, width: 1, height: 30 });
  assert.deepEqual(snapRects({ x: 10.2, y: 20.4, width: 0.6, height: 0.3 }), { x: 10, y: 20, width: 1, height: 1 });
  const many = snapRects([{ x: 1.5, y: 1.5, width: 2, height: 2 }]) as unknown[];
  assert.equal(many.length, 1);
});
