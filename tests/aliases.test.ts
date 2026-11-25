import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasMatches, normalizeQuery, probeCandidates } from '../src/data/aliases.ts';

test('TradingView adları Yahoo karşılıklarına eşlenir', () => {
  // Spot metaller: önce 7/24 Binance vadesiz, ardından uzun geçmişli COMEX vadelisi
  assert.deepEqual(
    aliasMatches('xagusd').map((d) => d.id),
    ['BINANCEF:XAGUSDT', 'YAHOO:SI=F'],
  );
  assert.deepEqual(
    aliasMatches('XAUUSD').map((d) => d.id),
    ['BINANCEF:XAUUSDT', 'YAHOO:GC=F'],
  );
  assert.equal(aliasMatches('us100')[0].ticker, '^NDX');
  assert.equal(aliasMatches('USOIL')[0].ticker, 'CL=F');
  assert.equal(aliasMatches('dxy')[0].ticker, 'DX-Y.NYB');
  assert.equal(aliasMatches('ES1!')[0].ticker, 'ES=F');
  assert.equal(aliasMatches('NI225')[0].ticker, '^N225');
  assert.equal(aliasMatches('US02Y')[0].ticker, '2YY=F');
  assert.equal(aliasMatches('XU050')[0].ticker, 'XU050.IS');
  assert.equal(aliasMatches('XAGUSDT.P')[0].id, 'BINANCEF:XAGUSDT');
});

test('Türkçe karakterli aramalar çalışır', () => {
  assert.equal(normalizeQuery('Gümüş '), 'GUMUS');
  assert.equal(aliasMatches('gümüş')[0].ticker, 'XAGUSDT');
  assert.equal(aliasMatches('altın')[0].ticker, 'XAUUSDT');
  assert.equal(aliasMatches('xag/usd')[0].ticker, 'XAGUSDT');
  assert.equal(aliasMatches('buğday')[0].ticker, 'ZW=F');
  assert.equal(aliasMatches('İnşaat')[0].ticker, 'XINSA.IS');
});

test('altı harfli döviz çiftleri =X sembolüne döner', () => {
  assert.equal(aliasMatches('eurusd')[0].ticker, 'EURUSD=X');
  assert.equal(aliasMatches('gbpjpy')[0].ticker, 'GBPJPY=X');
  assert.equal(aliasMatches('usdusd').length, 0);
});

test('baştan eşleşme ve boş sorgu', () => {
  assert.ok(aliasMatches('xau').some((d) => d.ticker === 'GC=F'));
  // İki harfte baştan eşleşme yok: "AS" yazarken (ASELS) takma adlar araya girmesin
  assert.deepEqual(aliasMatches('as'), []);
  assert.ok(aliasMatches('kaka').length <= 3);
  assert.deepEqual(aliasMatches('   '), []);
});

test('doğrudan denenecek semboller', () => {
  assert.deepEqual(probeCandidates('sasa'), ['SASA.IS', 'SASA', 'SASA=X', 'SASA=F']);
  assert.deepEqual(probeCandidates('GC=F'), ['GC=F']);
  assert.deepEqual(probeCandidates('altın fiyatı'), []);
});

test('gram altın ve gram gümüş aramaları', () => {
  assert.equal(aliasMatches('gram altın')[0].ticker, 'GRAMALTIN');
  assert.equal(aliasMatches('gramaltin')[0].ticker, 'GRAMALTIN');
  assert.equal(aliasMatches('gram gümüş')[0].ticker, 'GRAMGUMUS');
  assert.ok(aliasMatches('altın').some((d) => d.ticker === 'GRAMALTIN'));
  assert.ok(aliasMatches('gram').some((d) => d.ticker === 'GRAMGUMUS'));
});
