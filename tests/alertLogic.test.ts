import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHits, directionFor, isHit, type Alert } from '../src/ui/alertLogic.ts';

const alert = (over: Partial<Alert>): Alert => ({
  id: 'a',
  symbolId: 'BINANCE:BTCUSDT',
  symbolName: 'BTCUSDT',
  price: 100,
  dir: 'up',
  createdAt: 0,
  triggeredAt: null,
  triggerPrice: null,
  ...over,
});

test('yön, kurulduğu andaki fiyata göre belirlenir', () => {
  assert.equal(directionFor(90, 100), 'up');
  assert.equal(directionFor(110, 100), 'down');
});

test('yukarı alarm seviyede ve üstünde, aşağı alarm seviyede ve altında tetiklenir', () => {
  assert.equal(isHit({ dir: 'up', price: 100 }, 99.99), false);
  assert.equal(isHit({ dir: 'up', price: 100 }, 100), true);
  assert.equal(isHit({ dir: 'up', price: 100 }, 130), true); // boşluklu yükseliş de yakalanır
  assert.equal(isHit({ dir: 'down', price: 100 }, 100.01), false);
  assert.equal(isHit({ dir: 'down', price: 100 }, 80), true);
});

test('yalnızca bu sembolün tetiklenmemiş alarmları döner', () => {
  const list = [
    alert({ id: '1' }),
    alert({ id: '2', triggeredAt: 5 }),
    alert({ id: '3', symbolId: 'YAHOO:THYAO.IS' }),
    alert({ id: '4', dir: 'down', price: 50 }),
  ];
  assert.deepEqual(
    collectHits(list, 'BINANCE:BTCUSDT', 101).map((a) => a.id),
    ['1'],
  );
});
