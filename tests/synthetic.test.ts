import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineBars, SYNTHETICS, TROY_OUNCE_GRAMS } from '../src/data/synthetic.ts';

const bar = (timestamp: number, open: number, high: number, low: number, close: number, volume = 5) => ({ timestamp, open, high, low, close, volume });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('gram altın = ons × dolar/TL ÷ 31,1035', () => {
  const g = SYNTHETICS.GRAMALTIN;
  const [x] = combineBars([bar(1, 3000, 3000, 3000, 3110.34768)], [bar(1, 40, 40, 40, 50)], g.factor);
  near(x.close, (3110.34768 * 50) / TROY_OUNCE_GRAMS); // 5000 TL
  near(x.close, 5000);
});

test('aynı zamanda mum varsa bileşenlerin OHLC değerleri çarpılır', () => {
  const [x] = combineBars([bar(10, 2, 3, 1, 2.5)], [bar(10, 10, 12, 9, 11)], 1);
  assert.equal(x.open, 20);
  assert.equal(x.high, 36);
  assert.equal(x.low, 9);
  assert.equal(x.close, 27.5);
  assert.equal(x.volume, 5);
});

test('ikinci seride mum yoksa son bilinen kapanış kullanılır, öncesi atlanır', () => {
  const a = [bar(5, 1, 1, 1, 1), bar(10, 2, 2, 2, 2), bar(20, 3, 3, 3, 3)];
  const b = [bar(8, 9, 9, 9, 10)];
  const out = combineBars(a, b, 1);
  assert.deepEqual(
    out.map((x) => [x.timestamp, x.close]),
    [
      [10, 20],
      [20, 30],
    ],
  );
});
