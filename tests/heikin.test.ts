import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heikinAshi } from '../src/data/heikin.ts';

const bar = (timestamp: number, open: number, high: number, low: number, close: number) => ({ timestamp, open, high, low, close, volume: 1 });

test('Heikin Ashi: kapanış OHLC ortalaması, açılış önceki HA gövdesinin ortası', () => {
  const ha = heikinAshi([bar(1, 10, 12, 9, 11), bar(2, 11, 14, 10, 13)]);
  assert.equal(ha[0].close, (10 + 12 + 9 + 11) / 4);
  assert.equal(ha[0].open, (10 + 11) / 2);
  assert.equal(ha[1].open, (ha[0].open + ha[0].close) / 2);
  assert.equal(ha[1].close, (11 + 14 + 10 + 13) / 4);
  assert.equal(ha[1].high, 14);
  assert.equal(ha[1].low, 10);
  assert.equal(ha[1].timestamp, 2);
  assert.equal(ha[1].volume, 1);
});

test('Heikin Ashi: önceki mum verilirse zincir ondan devam eder', () => {
  const all = heikinAshi([bar(1, 10, 12, 9, 11), bar(2, 11, 14, 10, 13), bar(3, 13, 15, 12, 12)]);
  const tail = heikinAshi([bar(3, 13, 15, 12, 12)], all[1]);
  assert.deepEqual(tail[0], all[2]);
});
