import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseBase,
  intervalKey,
  intervalLabel,
  parseIntervalKey,
  PRESET_GROUPS,
  yahooIntervalString,
  binanceIntervalString,
  type Interval,
} from '../src/data/intervals.ts';

const k = (i: Interval | null) => (i ? intervalKey(i) : null);
const P = (key: string) => {
  const i = parseIntervalKey(key);
  assert.ok(i, key);
  return i;
};

test('Binance: doğal dilim varsa onu, yoksa tam bölen en büyüğünü seçer', () => {
  assert.equal(k(chooseBase(P('45m'), 'BINANCE')), '15m');
  assert.equal(k(chooseBase(P('4h'), 'BINANCE')), '4h');
  assert.equal(k(chooseBase(P('3h'), 'BINANCE')), '1h');
  assert.equal(k(chooseBase(P('5s'), 'BINANCE')), '1s');
  assert.equal(k(chooseBase(P('7m'), 'BINANCE')), '1m');
  assert.equal(k(chooseBase(P('3D'), 'BINANCE')), '3D');
  assert.equal(k(chooseBase(P('2D'), 'BINANCE')), '1D');
  assert.equal(k(chooseBase(P('3M'), 'BINANCE')), '1M');
});

test('Yahoo: saniye yok; saatler 60dk tabanından', () => {
  assert.equal(chooseBase(P('5s'), 'YAHOO'), null);
  assert.equal(k(chooseBase(P('4h'), 'YAHOO')), '1h');
  assert.equal(k(chooseBase(P('3h'), 'YAHOO')), '1h');
  assert.equal(k(chooseBase(P('3m'), 'YAHOO')), '1m');
  assert.equal(k(chooseBase(P('10m'), 'YAHOO')), '5m');
  assert.equal(k(chooseBase(P('2m'), 'YAHOO')), '2m');
  assert.equal(k(chooseBase(P('3D'), 'YAHOO')), '1D');
  assert.equal(k(chooseBase(P('2W'), 'YAHOO')), '1W');
});

test('tüm hazır dilimler en az bir kaynakta açılabilir', () => {
  for (const g of PRESET_GROUPS) {
    for (const i of g.items) {
      const b = chooseBase(i, 'BINANCE');
      assert.ok(b, intervalKey(i));
      binanceIntervalString(b);
      if (i.unit !== 'second') yahooIntervalString(chooseBase(i, 'YAHOO')!);
    }
  }
});

test('anahtar ve etiketler', () => {
  assert.equal(intervalLabel(P('45m')), '45dk');
  assert.equal(intervalLabel(P('4h')), '4sa');
  assert.equal(intervalLabel(P('1W')), '1H');
  assert.equal(intervalLabel(P('3M')), '3A');
  assert.equal(yahooIntervalString(P('1h')), '60m');
  assert.equal(binanceIntervalString(P('1M')), '1M');
  assert.equal(parseIntervalKey('0m'), null);
  assert.equal(parseIntervalKey('25h'), null);
  assert.equal(parseIntervalKey('abc'), null);
});
