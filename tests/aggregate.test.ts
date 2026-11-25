import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, mergeBars } from '../src/data/aggregate.ts';
import type { Bar } from '../src/data/types.ts';
import { tzOffsetSec } from '../src/data/tz.ts';

const T = (iso: string) => Date.parse(iso);
const bar = (iso: string, o: number, h: number, l: number, c: number, v = 1): Bar => ({
  timestamp: T(iso),
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
});

test('taban ve hedef aynıysa kopya döner', () => {
  const bars = [bar('2026-11-23T10:00:00Z', 1, 2, 0.5, 1.5)];
  const out = aggregate(bars, {
    target: { unit: 'hour', span: 1 },
    base: { unit: 'minute', span: 60 },
    timeZone: 'UTC',
    dayStart: 'midnight',
  });
  assert.deepEqual(out, bars);
  assert.notEqual(out[0], bars[0]);
});

test('BIST 1sa → 4sa: kovalar seans başından (günün ilk mumu) itibaren', () => {
  // Yahoo BIST saatlik mumları UTC 06:30'dan 14:30'a (9 mum), ertesi gün yine 06:30
  const day1 = [6, 7, 8, 9, 10, 11, 12, 13, 14].map((h, i) =>
    bar(`2026-11-23T${String(h).padStart(2, '0')}:30:00Z`, 100 + i, 101 + i, 99 + i, 100.5 + i, 10),
  );
  const day2 = [bar('2026-11-24T06:30:00Z', 200, 205, 195, 201, 7)];
  const out = aggregate([...day1, ...day2], {
    target: { unit: 'hour', span: 4 },
    base: { unit: 'hour', span: 1 },
    timeZone: 'Europe/Istanbul',
    dayStart: 'firstBar',
  });
  assert.deepEqual(
    out.map((b) => new Date(b.timestamp).toISOString()),
    ['2026-11-23T06:30:00.000Z', '2026-11-23T10:30:00.000Z', '2026-11-23T14:30:00.000Z', '2026-11-24T06:30:00.000Z'],
  );
  assert.deepEqual(out[0], { timestamp: T('2026-11-23T06:30:00Z'), open: 100, high: 104, low: 99, close: 103.5, volume: 40 });
  assert.equal(out[2].volume, 10);
  assert.equal(out[3].open, 200);
});

test('kripto 1dk → 7dk: gece yarısına hizalı, gün sınırında kova kesilir', () => {
  const mins = ['23:50', '23:54', '23:55', '23:59'].map((m) => bar(`2026-11-23T${m}:00Z`, 1, 1, 1, 1));
  const next = ['00:00', '00:06', '00:07'].map((m) => bar(`2026-11-24T${m}:00Z`, 2, 2, 2, 2));
  const out = aggregate([...mins, ...next], {
    target: { unit: 'minute', span: 7 },
    base: { unit: 'minute', span: 1 },
    timeZone: 'UTC',
    dayStart: 'midnight',
  });
  assert.deepEqual(
    out.map((b) => [new Date(b.timestamp).toISOString().slice(11, 16), b.volume]),
    [
      ['23:48', 2],
      ['23:55', 2],
      ['00:00', 2],
      ['00:07', 1],
    ],
  );
});

test('günlük → haftalık: pazartesi başlar, hafta sonu boşluğu sorun olmaz', () => {
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23'].map((d, i) =>
    bar(`${d}T06:30:00Z`, 10 + i, 20 + i, 5 + i, 11 + i, 100),
  );
  const out = aggregate(days, {
    target: { unit: 'week', span: 1 },
    base: { unit: 'day', span: 1 },
    timeZone: 'Europe/Istanbul',
    dayStart: 'firstBar',
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { timestamp: T('2026-11-16T06:30:00Z'), open: 10, high: 24, low: 5, close: 15, volume: 500 });
  assert.equal(out[1].timestamp, T('2026-11-23T06:30:00Z'));
});

test('aylık → 3 aylık: çeyreklere (Oca/Nis/Tem/Eki) hizalı', () => {
  // Yahoo aylık mumları yerel gece yarısında: kışın 05:00Z (EST), yazın 04:00Z (EDT)
  const months = ['01', '02', '03', '04', '05', '06', '07'].map((m, i) =>
    bar(`2026-${m}-01T${i < 3 ? '05' : '04'}:00:00Z`, i + 1, i + 2, i, i + 1.5, 1),
  );
  const out = aggregate(months, {
    target: { unit: 'month', span: 3 },
    base: { unit: 'month', span: 1 },
    timeZone: 'America/New_York',
    dayStart: 'firstBar',
  });
  assert.deepEqual(
    out.map((b) => [new Date(b.timestamp).toISOString().slice(0, 7), b.volume]),
    [
      ['2026-01', 3],
      ['2026-04', 3],
      ['2026-07', 1],
    ],
  );
});

test('mergeBars: son mumu değiştirir, yenisini ekler, aradakini bulur', () => {
  const list = [bar('2026-11-23T10:00:00Z', 1, 1, 1, 1), bar('2026-11-23T10:05:00Z', 2, 2, 2, 2)];
  const earliest = mergeBars(list, [
    bar('2026-11-23T10:00:00Z', 9, 9, 9, 9),
    bar('2026-11-23T10:05:00Z', 3, 3, 3, 3),
    bar('2026-11-23T10:10:00Z', 4, 4, 4, 4),
  ]);
  assert.equal(earliest, T('2026-11-23T10:00:00Z'));
  assert.deepEqual(
    list.map((b) => b.close),
    [9, 3, 4],
  );
  assert.equal(mergeBars(list, []), null);
});

test('saat dilimi farkı yaz/kış saatini bilir', () => {
  assert.equal(tzOffsetSec(T('2026-11-23T12:00:00Z'), 'Europe/Istanbul'), 10800);
  assert.equal(tzOffsetSec(T('2026-01-15T12:00:00Z'), 'America/New_York'), -18000);
  assert.equal(tzOffsetSec(T('2026-07-15T12:00:00Z'), 'America/New_York'), -14400);
  assert.equal(tzOffsetSec(T('2026-07-15T12:00:00Z'), 'UTC'), 0);
  assert.equal(tzOffsetSec(T('2026-07-15T12:00:00Z'), 'Gecersiz/Bolge'), 0);
});
