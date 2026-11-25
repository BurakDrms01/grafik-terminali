import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSyncedKey, keepServerTriggers, planFirstSync, unionJson, type SyncEntry } from '../src/data/syncLogic.ts';
import { alertMessage } from '../src/ui/alertLogic.ts';
import { SyncStore } from '../server/store.ts';

const entry = (v: unknown, rev = 1): SyncEntry => ({ v: v === null ? null : JSON.stringify(v), rev });

test('cihaza özel kayıtlar eşitlenmez', () => {
  assert.equal(isSyncedKey('watchlist'), true);
  assert.equal(isSyncedKey('drawings.YAHOO:AAPL'), true);
  assert.equal(isSyncedKey('sidePanel'), false);
  assert.equal(isSyncedKey('last'), false);
  assert.equal(isSyncedKey(''), false);
});

test('liste birleştirme: önce sunucudakiler, yalnızca yerelde olanlar sona; kimlik varsa ona göre', () => {
  const server = JSON.stringify([{ id: 'a', price: 1 }, { id: 'b', price: 2 }]);
  const local = JSON.stringify([{ id: 'b', price: 99 }, { id: 'c', price: 3 }]);
  assert.deepEqual(JSON.parse(unionJson(server, local)!), [
    { id: 'a', price: 1 },
    { id: 'b', price: 2 },
    { id: 'c', price: 3 },
  ]);
  // Kimliksiz öğeler (çizimler) içeriğe göre
  const d1 = JSON.stringify([{ name: 'fib', points: [1] }]);
  const d2 = JSON.stringify([{ name: 'fib', points: [1] }, { name: 'line', points: [2] }]);
  assert.equal(JSON.parse(unionJson(d1, d2)!).length, 2);
  // Fark yoksa sunucu metni aynen döner; dizi değilse null
  assert.equal(unionJson(d2, d1), d2);
  assert.equal(unionJson('{"a":1}', '[]'), null);
});

test('ilk eşitleme: ayarlarda sunucu kazanır, çizim/alarm birleşir, yalnızca yerelde olanlar gönderilir', () => {
  const server = {
    watchlist: entry([{ id: 'YAHOO:AAPL' }]),
    theme: entry('dark'),
    'drawings.X': entry([{ name: 'fib' }]),
    alerts: entry([{ id: 'a1' }]),
    old: entry(null),
  };
  const local = {
    watchlist: JSON.stringify([{ id: 'YAHOO:XU100.IS' }]),
    theme: JSON.stringify('light'),
    'drawings.X': JSON.stringify([{ name: 'line' }]),
    alerts: JSON.stringify([{ id: 'a1' }]),
    favorites: JSON.stringify(['1m']),
    old: JSON.stringify(1),
    sidePanel: JSON.stringify('none'),
  };
  const plan = planFirstSync(server, local);
  assert.equal(plan.writes.watchlist, server.watchlist.v);
  assert.equal(plan.writes.theme, server.theme.v);
  assert.deepEqual(JSON.parse(plan.writes['drawings.X']), [{ name: 'fib' }, { name: 'line' }]);
  assert.equal(plan.writes.alerts, server.alerts.v);
  assert.deepEqual(plan.dirty.sort(), ['drawings.X', 'favorites', 'old']);
});

test('sunucunun tetiklediği alarm, eski listeyle gelen güncellemede korunur', () => {
  const stale = JSON.stringify([
    { id: 'a1', price: 10, triggeredAt: null, triggerPrice: null },
    { id: 'a2', price: 20, triggeredAt: null, triggerPrice: null },
  ]);
  const fixed = JSON.parse(keepServerTriggers(stale, { a1: { at: 123, price: 10.5 } }));
  assert.deepEqual(fixed[0], { id: 'a1', price: 10, triggeredAt: 123, triggerPrice: 10.5 });
  assert.equal(fixed[1].triggeredAt, null);
  assert.equal(keepServerTriggers(stale, {}), stale);
});

test('sunucu deposu: sürüm yalnızca değişince artar, since ve dosyaya kalıcılık', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-store-'));
  try {
    const s = new SyncStore(dir);
    const seen: string[][] = [];
    s.onChange((k) => seen.push(k));
    assert.deepEqual(s.apply({ a: '1', b: '2' }), ['a', 'b']);
    assert.equal(s.rev, 2);
    assert.deepEqual(s.apply({ a: '1' }), []); // aynı değer
    assert.equal(s.rev, 2);
    s.apply({ b: null }); // silme
    assert.deepEqual(Object.keys(s.since(2)), ['b']);
    assert.equal(s.since(2).b.v, null);
    s.apply({ c: 'x' }, (_k, v) => v.toUpperCase());
    assert.equal(s.get('c'), 'X');
    assert.equal(seen.length, 3);
    // Yeniden açınca aynı durum
    const again = new SyncStore(dir);
    assert.equal(again.rev, 4);
    assert.equal(again.get('a'), '1');
    assert.equal(again.get('b'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Telegram alarm mesajı Türkçe biçimli', () => {
  const msg = alertMessage({ symbolName: 'THYAO', price: 320.5, dir: 'up' }, 321.25, 'https://ict-bot.example.ts.net');
  assert.equal(msg, '🔔 THYAO: ↑ 320,50\nFiyat seviyeye çıktı · son fiyat 321,25\nhttps://ict-bot.example.ts.net');
  assert.match(alertMessage({ symbolName: 'BTCUSDT', price: 58000, dir: 'down' }, 57990.12), /↓ 58\.000,00\nFiyat seviyeye indi · son fiyat 57\.990,12$/);
});

test('sunucu alarm görevi: tetikler, bir kez mesaj atar, eski listede tetiği korur', async () => {
  const { AlertWorker } = await import('../server/alerts.ts');
  const dir = mkdtempSync(join(tmpdir(), 'gt-alerts-'));
  try {
    const store = new SyncStore(dir);
    const sent: string[] = [];
    const tg = { linked: true, appUrl: '', send: async (t: string) => void sent.push(t), sanitize: (t: string) => t };
    let price = 99;
    const worker = new AlertWorker(store, tg, dir, async () => price);
    const now = Date.now();
    const alerts = [
      { id: 'up', symbolId: 'YAHOO:AAPL', symbolName: 'AAPL', price: 100, dir: 'up', createdAt: now, triggeredAt: null, triggerPrice: null },
      // Uygulamada az önce tetiklenmiş: mesaj gitmeli
      { id: 'recent', symbolId: 'YAHOO:X', symbolName: 'X', price: 5, dir: 'down', createdAt: now, triggeredAt: now - 60_000, triggerPrice: 4.9 },
      // Çok önce tetiklenmiş: sessizce geçilmeli
      { id: 'old', symbolId: 'YAHOO:Y', symbolName: 'Y', price: 5, dir: 'down', createdAt: 0, triggeredAt: 1000, triggerPrice: 4.9 },
    ];
    const stale = JSON.stringify(alerts);
    store.apply({ alerts: stale });

    await worker.check();
    assert.equal(sent.length, 1); // yalnızca "recent"
    assert.match(sent[0], /^🔔 X: ↓ 5,00/);

    price = 101;
    await worker.check();
    assert.equal(sent.length, 2);
    assert.match(sent[1], /^🔔 AAPL: ↑ 100,00\nFiyat seviyeye çıktı · son fiyat 101,00$/);
    const stored = JSON.parse(store.get('alerts')!);
    assert.equal(stored[0].triggerPrice, 101);
    assert.equal(typeof stored[0].triggeredAt, 'number');

    // Aynı alarm için ikinci mesaj yok
    await worker.check();
    assert.equal(sent.length, 2);

    // Telefondan eski liste gelirse (alarm "bekliyor"), tetik korunur
    const keep = (k: string, v: string) => (k === 'alerts' ? keepServerTriggers(v, worker.serverTriggers()) : v);
    store.apply({ alerts: stale }, keep);
    assert.equal(JSON.parse(store.get('alerts')!)[0].triggerPrice, 101);
    worker.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
