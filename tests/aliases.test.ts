import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasMatches, normalizeQuery, probeCandidates } from '../src/data/aliases.ts';

test('TradingView adları Yahoo karşılıklarına eşlenir', () => {
  assert.equal(aliasMatches('xagusd')[0].ticker, 'SI=F');
  assert.equal(aliasMatches('XAUUSD')[0].ticker, 'GC=F');
  assert.equal(aliasMatches('us100')[0].ticker, '^NDX');
  assert.equal(aliasMatches('USOIL')[0].ticker, 'CL=F');
  assert.equal(aliasMatches('dxy')[0].ticker, 'DX-Y.NYB');
});

test('Türkçe karakterli aramalar çalışır', () => {
  assert.equal(normalizeQuery('Gümüş '), 'GUMUS');
  assert.equal(aliasMatches('gümüş')[0].ticker, 'SI=F');
  assert.equal(aliasMatches('altın')[0].ticker, 'GC=F');
  assert.equal(aliasMatches('xag/usd')[0].ticker, 'SI=F');
});

test('altı harfli döviz çiftleri =X sembolüne döner', () => {
  assert.equal(aliasMatches('eurusd')[0].ticker, 'EURUSD=X');
  assert.equal(aliasMatches('gbpjpy')[0].ticker, 'GBPJPY=X');
  assert.equal(aliasMatches('usdusd').length, 0);
});

test('baştan eşleşme ve boş sorgu', () => {
  assert.ok(aliasMatches('xa').some((d) => d.ticker === 'GC=F'));
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
