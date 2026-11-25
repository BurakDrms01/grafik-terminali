import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseBase, oandaGranularity, parseIntervalKey, type Interval } from '../src/data/intervals.ts';
import {
  instrumentType,
  matchInstruments,
  parseCandles,
  parseInstruments,
  prevCloseOf,
  type OandaInstrument,
} from '../src/data/oandaLogic.ts';
import { displayTicker } from '../src/ui/format.ts';
import { Oanda } from '../server/oanda.ts';

const P = (k: string) => parseIntervalKey(k) as Interval;

const INSTRUMENTS_RAW = {
  instruments: [
    { name: 'XAG_USD', type: 'METAL', displayName: 'Silver', displayPrecision: 5 },
    { name: 'XAG_EUR', type: 'METAL', displayName: 'Silver/EUR', displayPrecision: 5 },
    { name: 'XAU_USD', type: 'METAL', displayName: 'Gold', displayPrecision: 3 },
    { name: 'EUR_USD', type: 'CURRENCY', displayName: 'EUR/USD', displayPrecision: 5 },
    { name: 'US30_USD', type: 'CFD', displayName: 'US Wall St 30', displayPrecision: 1, tags: [{ type: 'ASSET_CLASS', name: 'INDEX' }] },
    { name: 'NAS100_USD', type: 'CFD', displayName: 'US Nas 100', displayPrecision: 1, tags: [{ type: 'ASSET_CLASS', name: 'INDEX' }] },
    { name: 'DE30_EUR', type: 'CFD', displayName: 'Germany 30', displayPrecision: 1, tags: [{ type: 'ASSET_CLASS', name: 'INDEX' }] },
    { name: 'WTICO_USD', type: 'CFD', displayName: 'West Texas Oil', displayPrecision: 3, tags: [{ type: 'ASSET_CLASS', name: 'COMMODITY' }] },
  ],
};
const LIST: OandaInstrument[] = parseInstruments(INSTRUMENTS_RAW);

test('OANDA mumları: UNIX zaman, alış fiyatı, eksik satırlar atlanır', () => {
  const bars = parseCandles({
    candles: [
      { time: '1795620000.000000000', volume: 12, bid: { o: '38.10', h: '38.30', l: '38.00', c: '38.25' } },
      { time: '1795620060.000000000', volume: 3, mid: { o: '38.25', h: '38.40', l: '38.20', c: '38.35' } },
      { time: 'bozuk', bid: { o: '1', h: '1', l: '1', c: '1' } },
      { time: '1795620120.000000000' },
    ],
  });
  assert.deepEqual(bars, [
    [1795620000000, 38.1, 38.3, 38, 38.25, 12],
    [1795620060000, 38.25, 38.4, 38.2, 38.35, 3],
  ]);
  assert.deepEqual(parseCandles({}), []);
});

test('önceki gün kapanışı: son iki günlük mumdan öncekinin kapanışı', () => {
  assert.equal(prevCloseOf([[1, 0, 0, 0, 37.5, 0], [2, 0, 0, 0, 38.2, 0]]), 37.5);
  assert.equal(prevCloseOf([[1, 0, 0, 0, 37.5, 0]]), null);
});

test('araç türleri ve listesi', () => {
  assert.equal(LIST.length, 8);
  assert.equal(instrumentType(LIST.find((i) => i.name === 'EUR_USD')!), 'Döviz');
  assert.equal(instrumentType(LIST.find((i) => i.name === 'XAU_USD')!), 'Emtia');
  assert.equal(instrumentType(LIST.find((i) => i.name === 'WTICO_USD')!), 'Emtia');
  assert.equal(instrumentType(LIST.find((i) => i.name === 'US30_USD')!), 'Endeks');
  assert.equal(LIST.find((i) => i.name === 'XAU_USD')!.precision, 3);
});

test('OANDA araması: TradingView adları ve Türkçe aramalar', () => {
  const first = (q: string) => matchInstruments(LIST, q)[0]?.name;
  assert.equal(first('xagusd'), 'XAG_USD');
  assert.equal(first('XAG/USD'), 'XAG_USD');
  assert.equal(first('xag'), 'XAG_USD'); // ABD dolarlı önce
  assert.equal(first('gümüş'), 'XAG_USD');
  assert.equal(first('altın'), 'XAU_USD');
  assert.equal(first('USOIL'), 'WTICO_USD');
  assert.equal(first('us100'), 'NAS100_USD');
  assert.equal(first('GER40'), 'DE30_EUR'); // DE40 yoksa DE30
  assert.equal(first('us30'), 'US30_USD');
  assert.equal(first('eurusd'), 'EUR_USD');
  assert.deepEqual(matchInstruments(LIST, 'thyao'), []);
  assert.deepEqual(matchInstruments(LIST, '  '), []);
});

test('OANDA dilimleri ve gösterim', () => {
  assert.equal(oandaGranularity(P('5s')), 'S5');
  assert.equal(oandaGranularity(P('4h')), 'H4');
  assert.equal(oandaGranularity(P('1D')), 'D');
  assert.equal(oandaGranularity(P('1W')), 'W');
  assert.equal(oandaGranularity(P('1M')), 'M');
  assert.equal(oandaGranularity(chooseBase(P('3m'), 'OANDA')!), 'M1');
  assert.equal(oandaGranularity(chooseBase(P('45m'), 'OANDA')!), 'M15');
  assert.equal(oandaGranularity(chooseBase(P('3h'), 'OANDA')!), 'H3');
  assert.equal(chooseBase(P('1s'), 'OANDA'), null);
  assert.equal(displayTicker({ source: 'OANDA', ticker: 'XAG_USD' }), 'XAGUSD');
  assert.equal(displayTicker({ source: 'OANDA', ticker: 'NAS100_USD' }), 'NAS100USD');
});

// ---------- Sunucu modülü: sahte OANDA ile ----------

const TOKEN = 'f'.repeat(32) + '-' + 'e'.repeat(32);

function withFakeOanda(handler: (url: URL, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: URL; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('sunucu: anahtar doğrulanır, durumda ve dosya dışında hiçbir yerde görünmez', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-oanda-'));
  const fake = withFakeOanda((url) => {
    // Demo sunucusu reddeder, gerçek hesap sunucusu kabul eder.
    if (url.hostname === 'api-fxpractice.oanda.com') return { status: 401, body: { errorMessage: 'Insufficient authorization' } };
    return { body: { accounts: [{ id: '001-001-1234567-001' }] } };
  });
  try {
    const o = new Oanda(dir);
    assert.deepEqual(o.status(), { configured: false });
    const st = await o.configure(TOKEN);
    assert.deepEqual(st, { configured: true, env: 'live' });
    assert.ok(!JSON.stringify(o.status()).includes(TOKEN));
    assert.equal(fake.calls[0].auth, `Bearer ${TOKEN}`);
    assert.equal(o.sanitize(`hata ${TOKEN} burada`), 'hata *** burada');
    // Yeniden açılınca dosyadan okunur
    assert.deepEqual(new Oanda(dir).status(), { configured: true, env: 'live' });
    assert.ok(readFileSync(join(dir, 'oanda.json'), 'utf8').includes(TOKEN));
    o.remove();
    assert.deepEqual(new Oanda(dir).status(), { configured: false });
  } finally {
    fake.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sunucu: geçersiz anahtar biçimi OANDA’ya hiç gönderilmez', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-oanda-'));
  const fake = withFakeOanda(() => ({ body: {} }));
  try {
    await assert.rejects(new Oanda(dir).configure('kısa anahtar'), /benzemiyor/);
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sunucu: mum isteği parametreleri ve fiyatlar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-oanda-'));
  const fake = withFakeOanda((url) => {
    if (url.pathname === '/v3/accounts') return { body: { accounts: [{ id: 'A1' }] } };
    if (url.pathname.endsWith('/candles')) {
      return {
        body: {
          candles: [
            { time: '1795500000', volume: 1, bid: { o: '37', h: '38', l: '36', c: '37.5' } },
            { time: '1795586400', volume: 1, bid: { o: '37.5', h: '39', l: '37', c: '38.4' } },
          ],
        },
      };
    }
    if (url.pathname.endsWith('/pricing')) {
      return { body: { prices: [{ instrument: 'XAG_USD', time: '1795620000.5', bids: [{ price: '38.45' }] }] } };
    }
    return { status: 404, body: {} };
  });
  try {
    const o = new Oanda(dir);
    await o.configure(TOKEN);
    const bars = await o.candles('XAG_USD', 'M1', 5000, 1795620000000);
    assert.equal(bars.length, 2);
    const c = fake.calls.find((x) => x.url.pathname === '/v3/instruments/XAG_USD/candles')!;
    assert.equal(c.url.searchParams.get('price'), 'B');
    assert.equal(c.url.searchParams.get('granularity'), 'M1');
    assert.equal(c.url.searchParams.get('to'), '1795619999.999');
    assert.equal(c.url.searchParams.get('weeklyAlignment'), 'Monday');

    const [q] = await o.quotes(['XAG_USD']);
    assert.deepEqual(q, { instrument: 'XAG_USD', price: 38.45, prevClose: 37.5, time: 1795620000500 });
    assert.equal(await o.price('XAG_USD'), 38.45);

    await assert.rejects(o.candles('XAG_USD;rm', 'M1', 10), /Geçersiz OANDA sembolü/);
    await assert.rejects(o.candles('XAG_USD', 'M7', 10), /Geçersiz mum dilimi/);
    // Hiçbir istekte anahtar adreste yer almaz
    assert.ok(fake.calls.every((x) => !x.url.href.includes(TOKEN)));
  } finally {
    fake.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
