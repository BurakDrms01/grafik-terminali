import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBars, parseYahooChart } from '../src/data/yahooParse.ts';
import { addRegularSessions, extendedPart, isOvernightSession, type RegularSessions } from '../src/data/session.ts';
import type { Bar } from '../src/data/types.ts';
import type { Interval } from '../src/data/intervals.ts';

const NY = 'America/New_York';
const H1: Interval = { unit: 'hour', span: 1 };
const M5: Interval = { unit: 'minute', span: 5 };
const t = (iso: string) => Date.parse(iso);
const bar = (iso: string, close = 1): Bar => ({ timestamp: t(iso), open: close, high: close, low: close, close, volume: 1 });

// 24 Kasım 2026 (EST, UTC−5): 09:00 ET = 14:00Z, 09:30 ET = 14:30Z, 16:00 ET = 21:00Z.
test('uzatılmış saatlikte 09:00 → 09:30 → 10:30 ve 15:30 → 16:00 mumları kaymaz', () => {
  const raw = ['13:00', '14:00', '14:30', '15:30', '20:30', '21:00', '22:00'].map((hm) => bar(`2026-11-24T${hm}:00Z`));
  const out = normalizeBars(raw, H1, NY, true);
  assert.deepEqual(
    out.map((b) => new Date(b.timestamp).toISOString().slice(11, 16)),
    ['13:00', '14:00', '14:30', '15:30', '20:30', '21:00', '22:00'],
  );
});

test('uzatılmış saatlikte "şu an" satırı (16:47:05) 16:00 mumuna birleşir', () => {
  const raw = [bar('2026-11-24T21:00:00Z', 1), bar('2026-11-24T21:47:05Z', 2)];
  const out = normalizeBars(raw, H1, NY, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].close, 2);
});

test('normal seansta yarım saatlik kayma eskisi gibi hizalanır', () => {
  const raw = [bar('2026-11-24T14:30:00Z', 1), bar('2026-11-24T15:00:00Z', 2)];
  const out = normalizeBars(raw, H1, NY, false);
  assert.equal(out.length, 1);
});

test('tradingPeriods.regular normal seans pencerelerine çevrilir (yalnızca uzatılmışta)', () => {
  const start = t('2026-11-27T14:30:00Z') / 1000;
  const end = t('2026-11-27T18:00:00Z') / 1000; // yarım gün: 13:00 ET kapanış
  const json = {
    chart: {
      result: [
        {
          meta: {
            symbol: 'AAPL',
            exchangeTimezoneName: NY,
            hasPrePostMarketData: true,
            tradingPeriods: { pre: [[]], regular: [[{ start, end, timezone: 'EST', gmtoffset: -18000 }]], post: [[]] },
          },
          timestamp: [start],
          indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] },
        },
      ],
      error: null,
    },
  };
  const ext = parseYahooChart(json, M5, true);
  assert.equal(ext.meta.hasPrePost, true);
  assert.deepEqual(ext.regular, [{ start: start * 1000, end: end * 1000 }]);
  assert.equal(parseYahooChart(json, M5, false).regular, undefined);
});

test('ön/son piyasa mumu ayırt edilir; yarım günde 13:00 sonrası son piyasadır', () => {
  const sessions: RegularSessions = new Map();
  addRegularSessions(sessions, [{ start: t('2026-11-27T14:30:00Z'), end: t('2026-11-27T18:00:00Z') }], NY);
  const m5 = 5 * 60000;
  // Bilinmeyen gün: varsayılan 09:30–16:00
  assert.equal(extendedPart(t('2026-11-24T14:25:00Z'), m5, sessions, NY), 'pre');
  assert.equal(extendedPart(t('2026-11-24T14:30:00Z'), m5, sessions, NY), null);
  assert.equal(extendedPart(t('2026-11-24T20:55:00Z'), m5, sessions, NY), null);
  assert.equal(extendedPart(t('2026-11-24T21:00:00Z'), m5, sessions, NY), 'post');
  // Yarım gün (Şükran Günü ertesi)
  assert.equal(extendedPart(t('2026-11-27T17:55:00Z'), m5, sessions, NY), null);
  assert.equal(extendedPart(t('2026-11-27T18:00:00Z'), m5, sessions, NY), 'post');
  // Yaz saati (EDT, UTC−4): 09:30 ET = 13:30Z
  assert.equal(extendedPart(t('2026-06-15T13:25:00Z'), m5, sessions, NY), 'pre');
  assert.equal(extendedPart(t('2026-06-15T13:30:00Z'), m5, sessions, NY), null);
  // Normal seansla kesişen 4 saatlik mum (08:00–12:00 ET) gölgelenmez
  assert.equal(extendedPart(t('2026-11-24T13:00:00Z'), 4 * 3600000, sessions, NY), null);
});

test('gece seansı: Pazar–Perşembe 20:00 → ertesi gün 04:00 (New York saati)', () => {
  const on = (iso: string) => isOvernightSession(t(iso));
  assert.equal(on('2026-11-25T07:20:00Z'), true); // Çarşamba 02:20 EST
  assert.equal(on('2026-11-24T15:00:00Z'), false); // Salı 10:00 normal seans
  assert.equal(on('2026-11-25T00:59:00Z'), false); // Salı 19:59 son piyasa
  assert.equal(on('2026-11-25T01:00:00Z'), true); // Salı 20:00
  assert.equal(on('2026-11-25T09:00:00Z'), false); // Çarşamba 04:00 ön piyasa
  assert.equal(on('2026-11-28T02:00:00Z'), false); // Cuma 21:00: hafta sonu gece seansı yok
  assert.equal(on('2026-11-28T08:00:00Z'), false); // Cumartesi 03:00
  assert.equal(on('2026-11-30T02:00:00Z'), true); // Pazar 21:00
  assert.equal(on('2026-11-30T08:00:00Z'), true); // Pazartesi 03:00
  assert.equal(on('2026-06-16T01:00:00Z'), true); // yaz saati: Pazartesi 21:00 EDT
});
