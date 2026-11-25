import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooChart } from '../src/data/yahooParse.ts';
import type { Interval } from '../src/data/intervals.ts';

const sec = (iso: string) => Date.parse(iso) / 1000;

function chart(
  rows: [string, number | null, number | null, number | null, number | null, number | null][],
  meta: Record<string, unknown> = {},
) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: 'TEST', gmtoffset: 0, exchangeTimezoneName: 'UTC', priceHint: 2, regularMarketPrice: 10, ...meta },
          timestamp: rows.map((r) => sec(r[0])),
          indicators: {
            quote: [
              {
                open: rows.map((r) => r[1]),
                high: rows.map((r) => r[2]),
                low: rows.map((r) => r[3]),
                close: rows.map((r) => r[4]),
                volume: rows.map((r) => r[5]),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

const M5: Interval = { unit: 'minute', span: 5 };
const H1: Interval = { unit: 'hour', span: 1 };
const iso = (ms: number) => new Date(ms).toISOString();

test('boş (null) satırlar atılır, boş hacim 0 olur', () => {
  const { bars } = parseYahooChart(
    chart([
      ['2026-11-23T14:30:00Z', 1, 2, 0.5, 1.5, 100],
      ['2026-11-23T14:35:00Z', null, null, null, null, null],
      ['2026-11-23T14:40:00Z', 1.5, 2, 1, 1.8, null],
    ]),
    M5,
  );
  assert.equal(bars.length, 2);
  assert.equal(bars[1].volume, 0);
});

test('piyasa açıkken gelen "şu an" satırı (17:38:05) 17:35 mumuna birleşir', () => {
  const { bars } = parseYahooChart(
    chart([
      ['2026-11-23T17:30:00Z', 348, 349, 347.5, 348.8, 163088],
      ['2026-11-23T17:35:00Z', 348.8, 349.0, 348.6, 348.82, 134679],
      ['2026-11-23T17:38:05Z', 348.76, 349.5, 348.1, 348.76, 0],
    ]),
    M5,
  );
  assert.equal(bars.length, 2);
  assert.equal(iso(bars[1].timestamp), '2026-11-23T17:35:00.000Z');
  assert.equal(bars[1].close, 348.76);
  assert.equal(bars[1].high, 349.5);
  assert.equal(bars[1].low, 348.1);
  assert.equal(bars[1].volume, 134679);
});

test('ızgara dışı satır yeni bir muma düşüyorsa mum başlangıcına hizalanır', () => {
  const { bars } = parseYahooChart(
    chart([
      ['2026-11-23T17:30:00Z', 1, 1, 1, 1, 1],
      ['2026-11-23T17:36:10Z', 2, 2, 2, 2, 0],
    ]),
    M5,
  );
  assert.deepEqual(
    bars.map((b) => iso(b.timestamp)),
    ['2026-11-23T17:30:00.000Z', '2026-11-23T17:35:00.000Z'],
  );
});

test('BIST saatlik: 18:00 kapanış satırı (15:00 UTC) 14:30 mumuna birleşir', () => {
  const { bars } = parseYahooChart(
    chart(
      [
        ['2026-11-23T13:30:00Z', 322, 323, 321, 322.25, 6778507],
        ['2026-11-23T14:30:00Z', 322.25, 322.5, 320, 320.5, 3970689],
        ['2026-11-23T15:00:00Z', 321, 321, 321, 321, 0],
      ],
      { gmtoffset: 10800, exchangeTimezoneName: 'Europe/Istanbul' },
    ),
    H1,
  );
  assert.equal(bars.length, 2);
  assert.equal(bars[1].close, 321);
  assert.equal(bars[1].volume, 3970689);
});

test('ertesi günün ilk mumu (gece boşluğu) doğru yerde kalır', () => {
  const { bars } = parseYahooChart(
    chart(
      [
        ['2026-11-23T14:30:00Z', 1, 1, 1, 1, 1],
        ['2026-11-24T06:30:00Z', 2, 2, 2, 2, 1],
      ],
      { gmtoffset: 10800, exchangeTimezoneName: 'Europe/Istanbul' },
    ),
    H1,
  );
  assert.equal(iso(bars[1].timestamp), '2026-11-24T06:30:00.000Z');
});

test('aylık: ay içindeki "bugün" satırı o ayın mumuna birleşir, hacim eklenir', () => {
  const { bars } = parseYahooChart(
    chart(
      [
        ['2026-10-01T04:00:00Z', 300, 350, 290, 344.63, 877798800],
        ['2026-11-01T04:00:00Z', 344, 360, 330, 342.56, 766084000],
        ['2026-11-23T17:38:09Z', 343, 349, 342, 348.71, 21865432],
      ],
      { gmtoffset: -18000, exchangeTimezoneName: 'America/New_York' },
    ),
    { unit: 'month', span: 1 },
  );
  assert.equal(bars.length, 2);
  assert.equal(bars[1].close, 348.71);
  assert.equal(bars[1].volume, 766084000 + 21865432);
  assert.equal(iso(bars[1].timestamp), '2026-11-01T04:00:00.000Z');
});

test('aynı zamanlı tekrar eden satır öncekinin yerine geçer', () => {
  const { bars } = parseYahooChart(
    chart([
      ['2026-11-23T10:00:00Z', 1, 1, 1, 1, 5],
      ['2026-11-23T10:00:00Z', 1, 2, 1, 2, 6],
    ]),
    M5,
  );
  assert.equal(bars.length, 1);
  assert.equal(bars[0].close, 2);
  assert.equal(bars[0].volume, 6);
});

test('meta: önceki kapanış yoksa chartPreviousClose kullanılır, ad longName', () => {
  const { meta } = parseYahooChart(
    chart([], { chartPreviousClose: 329, longName: 'Turk Hava Yollari', priceHint: 4, gmtoffset: 10800 }),
    M5,
  );
  assert.equal(meta.prevClose, 329);
  assert.equal(meta.name, 'Turk Hava Yollari');
  assert.equal(meta.priceHint, 4);
  assert.equal(meta.gmtoffset, 10800);
});

test('Yahoo hata yanıtı istisna fırlatır', () => {
  assert.throws(
    () => parseYahooChart({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }, M5),
    /No data found/,
  );
});

test('günlükte boş gelen günler saatlik mumlardan doldurulur', async () => {
  const { fillDailyGaps } = await import('../src/data/yahooParse.ts');
  const tz = 'Europe/Istanbul';
  const day = (d: number, h = 6.5) => Date.UTC(2026, 10, d, 0) + h * 3600_000; // 06:30 UTC = 09:30 TSİ
  const bar = (timestamp: number, open: number, high: number, low: number, close: number, volume = 10) => ({ timestamp, open, high, low, close, volume });
  const daily = [bar(day(20), 114.2, 114.2, 110.5, 111.2)];
  const hourly = [
    bar(day(20, 7), 114, 114.2, 112, 112),
    bar(day(23, 7), 111.2, 112, 111.2, 111.8),
    bar(day(23, 12), 111.8, 113.7, 111.5, 113.3),
    bar(day(23, 15.15), 113.9, 113.9, 113.9, 113.9),
  ];
  const out = fillDailyGaps(daily, [day(23), day(24)], hourly, tz);
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { timestamp: day(23), open: 111.2, high: 113.9, low: 111.2, close: 113.9, volume: 30 });
  // Zaten mumu olan gün değişmez
  assert.equal(fillDailyGaps(daily, [day(20)], hourly, tz).length, 1);
});
