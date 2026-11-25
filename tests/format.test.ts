import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTicker, parsePriceInput } from '../src/ui/format.ts';

test('fiyat girişi: Türkçe ve İngilizce yazımlar', () => {
  assert.equal(parsePriceInput('62.000,50'), 62000.5);
  assert.equal(parsePriceInput('62000,5'), 62000.5);
  assert.equal(parsePriceInput('62000.5'), 62000.5);
  assert.equal(parsePriceInput(' 321 '), 321);
  assert.equal(parsePriceInput(''), null);
  assert.equal(parsePriceInput('abc'), null);
  assert.equal(parsePriceInput('-5'), null);
});

test('fiyat girişi: belirsiz "62.000" güncel fiyata göre yorumlanır', () => {
  assert.equal(parsePriceInput('62.000', 61836), 62000); // BTC: binlik ayırıcı
  assert.equal(parsePriceInput('50.591', 50.59), 50.591); // USDTRY: ondalık
  assert.equal(parsePriceInput('1.234.567'), 1234567);
});

test('kısa sembol gösterimi', () => {
  assert.equal(displayTicker({ source: 'YAHOO', ticker: 'THYAO.IS' }), 'THYAO');
  assert.equal(displayTicker({ source: 'YAHOO', ticker: 'USDTRY=X' }), 'USDTRY');
  assert.equal(displayTicker({ source: 'YAHOO', ticker: 'GC=F' }), 'GC');
  assert.equal(displayTicker({ source: 'BINANCE', ticker: 'BTCUSDT' }), 'BTCUSDT');
  assert.equal(displayTicker({ source: 'BINANCEF', ticker: 'XAGUSDT' }), 'XAGUSDT.P');
  assert.equal(displayTicker({ source: 'YAHOO', ticker: 'DX-Y.NYB' }), 'DXY');
  assert.equal(displayTicker({ source: 'YAHOO', ticker: '^GSPC' }), 'GSPC');
});
