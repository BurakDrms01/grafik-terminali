import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionPrice, normalizeFibSettings, retracementPrice } from '../src/chart/fib.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('düzeltme: 0 bitişte, 1 başlangıçta, 0,5 tam ortada (normal ölçek)', () => {
  close(retracementPrice(100, 200, 0, false), 200);
  close(retracementPrice(100, 200, 1, false), 100);
  close(retracementPrice(100, 200, 0.5, false), 150);
  close(retracementPrice(100, 200, 0.618, false), 138.2);
  close(retracementPrice(100, 200, 1.618, false), 38.2);
});

test('düzeltme: log ölçekte 0,5 geometrik ortadır (100→400 için 200)', () => {
  close(retracementPrice(100, 400, 0.5, true), 200);
  close(retracementPrice(100, 400, 0, true), 400);
  close(retracementPrice(100, 400, 1, true), 100);
  // log seviyeleri her zaman pozitif kalır; normal ölçekte 1,618 negatife düşebilir
  assert.ok(retracementPrice(100, 400, 1.618, true) > 0);
  assert.ok(retracementPrice(100, 400, 1.618, false) < 0);
});

test('log ölçek negatif/sıfır fiyatta normal hesaba döner', () => {
  close(retracementPrice(0, 100, 0.5, true), 50);
});

test('uzantı: A→B hareketi C den yansıtılır', () => {
  close(extensionPrice(100, 200, 150, 1, false), 250);
  close(extensionPrice(100, 200, 150, 1.618, false), 311.8);
  close(extensionPrice(100, 200, 150, 1, true), 300); // %100 artış C'den de %100
});

test('ayarlar: eksik alanlar varsayılanla tamamlanır, bozuk seviyeler atılır', () => {
  const s = normalizeFibSettings({ log: true, levels: [{ value: 0.5, color: '#fff', show: true }, { value: 'x' }] }, 'retracement');
  assert.equal(s.log, true);
  assert.equal(s.levels.length, 1);
  assert.equal(s.showPrices, true);
  assert.equal(normalizeFibSettings(null, 'extension').levels[0].value, 0);
});
