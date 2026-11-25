import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barEnd, formatRemaining } from '../src/chart/countdown.ts';

test('mum bitişi: dakika, saat, gün, ay', () => {
  const t = Date.UTC(2026, 0, 31, 0, 0);
  assert.equal(barEnd(t, { type: 'minute', span: 15 }), t + 15 * 60_000);
  assert.equal(barEnd(t, { type: 'hour', span: 4 }), t + 4 * 3_600_000);
  assert.equal(barEnd(t, { type: 'day', span: 1 }), t + 86_400_000);
  assert.equal(barEnd(Date.UTC(2026, 0, 1), { type: 'month', span: 1 }), Date.UTC(2026, 1, 1));
});

test('kalan süre biçimi', () => {
  assert.equal(formatRemaining(59_000), '00:59');
  assert.equal(formatRemaining(4 * 60_000 + 5_000), '04:05');
  assert.equal(formatRemaining(3_600_000 + 65_000), '1:01:05');
  assert.equal(formatRemaining(3 * 86_400_000 + 4 * 3_600_000), '3g 04sa');
  assert.equal(formatRemaining(-5), '00:00');
});
