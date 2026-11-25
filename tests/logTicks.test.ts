import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logTicks, tickDecimals } from '../src/chart/logTicks.ts';

const lg = Math.log10;

test('geniş aralıkta yuvarlak değerler ve sıfır yok', () => {
  // DOAS aylık: 0,70 – 415
  const ticks = logTicks(lg(0.6), lg(1300), 600, 30);
  assert.ok(ticks.length >= 6, ticks.join(' '));
  assert.ok(ticks.every((v) => v > 0));
  for (const v of [1, 10, 100, 1000]) assert.ok(ticks.includes(v), `${v} yok: ${ticks.join(' ')}`);
  // Hepsi 1, 2 veya 5'in katı gibi yuvarlak değerler
  for (const v of ticks) {
    const m = v / 10 ** Math.floor(lg(v) + 1e-9);
    assert.ok([1, 2, 3, 4, 5, 6, 7, 8, 9].some((x) => Math.abs(m - x) < 1e-9) || Number.isInteger(m * 10), `${v}`);
  }
});

test('etiketler birbirine minGap pikselden yakın değil', () => {
  const height = 500;
  const from = lg(3);
  const to = lg(4200);
  const ticks = logTicks(from, to, height, 32);
  const ys = ticks.map((v) => ((to - lg(v)) * height) / (to - from)).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 32 - 1e-6);
});

test('dar aralıkta (gün içi) yeterli sayıda çizgi', () => {
  const ticks = logTicks(lg(100), lg(102), 500, 30);
  assert.ok(ticks.length >= 5, ticks.join(' '));
  assert.ok(ticks.every((v) => v >= 100 && v <= 102));
  // Eşit adımlı
  const steps = ticks.slice(1).map((v, i) => Number((v - ticks[i]).toFixed(9)));
  assert.ok(steps.every((d) => d === steps[0]), steps.join(' '));
});

test('çok küçük fiyatlar (0,0001 civarı)', () => {
  const ticks = logTicks(lg(0.00008), lg(0.0003), 400, 30);
  assert.ok(ticks.length >= 3, ticks.join(' '));
  assert.ok(ticks.includes(0.0001) || ticks.includes(0.0002));
});

test('geçersiz aralık boş döner', () => {
  assert.deepEqual(logTicks(2, 2, 400, 30), []);
  assert.deepEqual(logTicks(1, 2, 0, 30), []);
});

test('ondalık basamak', () => {
  assert.equal(tickDecimals(100, 2), 2);
  assert.equal(tickDecimals(0.0005, 2), 4);
  assert.equal(tickDecimals(2.5, 0), 1);
});
